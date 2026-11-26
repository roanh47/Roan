import type { Event } from "../protocol/types.js";
import { formatStamp, sessionModel } from "./export-html.js";
import { readSessions, sessionEvents } from "./sessions.js";

/**
 * One conversation as a readable markdown file. Pure on the events, so the
 * shape is pinned by tests without a store or a disk.
 *
 * Photos ride the message events as base64; in the file they become
 * `attachments/<event id>` references — the caller writes the folder. Bare
 * urls the tools dropped become real links, the way the chat showed them.
 */

interface ImageOnEvent {
  readonly eventId: string;
  readonly mime: string;
  readonly data: string;
}

/** Turns `image/jpeg` into `jpg`, unknown mimes into `png`. */
export function attachmentExtension(mime: string): string {
  const clean = mime.toLowerCase().split(";")[0]?.trim() ?? "";
  if (clean === "image/jpeg" || clean === "image/jpg") return "jpg";
  if (clean === "image/webp") return "webp";
  if (clean === "image/gif") return "gif";
  return "png";
}

/** Every photo in one conversation, in chain order, ready to write. */
export function sessionAttachments(
  events: readonly Event[],
  session: string,
): { file: string; mime: string; data: string }[] {
  const found: { file: string; mime: string; data: string }[] = [];
  for (const message of sessionEvents(events, session)) {
    if (message.type !== "message") continue;
    const image = imageOnEvent(message);
    if (image === null) continue;
    found.push({ file: `${image.eventId}.${attachmentExtension(image.mime)}`, mime: image.mime, data: image.data });
  }
  return found;
}

function imageOnEvent(event: Event): ImageOnEvent | null {
  const data = event.data as { image?: unknown } | null | undefined;
  const image = data?.image as { mime?: unknown; data?: unknown } | null | undefined;
  if (
    typeof image?.mime !== "string" ||
    typeof image?.data !== "string" ||
    image.data.length === 0
  ) {
    return null;
  }
  return { eventId: event.id, mime: image.mime, data: image.data };
}

/** Bare urls become clickable, exactly like the chat rendered them. */
export function linkify(text: string): string {
  // Only outside existing markdown links: a `](url)` paren or a plain word
  // before the url means this one is already wired.
  return text.replace(/(^|[\s>])(https?:\/\/[^\s<>()]+)/g, (_all, lead: string, url: string) => `${lead}[${url}](${url})`);
}

export function sessionMarkdown(events: readonly Event[], session: string): string {
  const index = readSessions(events);
  const info = index.sessions.find((entry) => entry.id === session);
  // A title is one line: a newline in it would break the heading it rides.
  const title = (info?.title ?? "Conversation").replace(/\s+/g, " ").trim() || "Conversation";
  const lines: string[] = [`# ${title}`, ""];
  const turns = info?.messages ?? 0;
  const header: string[] = [];
  if (info !== undefined) header.push(`Started ${formatStamp(info.startedAt)}`);
  header.push(`${String(turns)} ${turns === 1 ? "turn" : "turns"}`);
  const model = sessionModel(events, session);
  if (model !== null) header.push(`model ${model}`);
  lines.push(`*${header.join(" · ")}*`, "");
  for (const message of sessionEvents(events, session)) {
    const data = message.data as { text?: unknown } | null;
    const text = typeof data?.text === "string" ? data.text.trim() : "";
    if (text.length === 0) continue;
    if (message.type === "message") {
      const image = imageOnEvent(message);
      lines.push("## Owner", "");
      if (image !== null) {
        lines.push(`![photo](attachments/${image.eventId}.${attachmentExtension(image.mime)})`, "");
      }
      lines.push(text, "");
    } else if (message.type === "assistant") {
      lines.push("## Roan", "", linkify(text), "");
    }
  }
  lines.push(`*${String(info?.messages ?? 0)} messages — exported from the chain.*`);
  return lines.join("\n");
}
