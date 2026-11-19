import type { Event } from "../protocol/types.js";
import { readSessions, sessionEvents } from "./sessions.js";

/**
 * One conversation as a readable markdown file. Pure on the events, so the
 * shape is pinned by tests without a store or a disk.
 */
export function sessionMarkdown(events: readonly Event[], session: string): string {
  const index = readSessions(events);
  const info = index.sessions.find((entry) => entry.id === session);
  const title = info?.title ?? "Conversation";
  const lines: string[] = [`# ${title}`, ""];
  for (const message of sessionEvents(events, session)) {
    const data = message.data as { text?: unknown } | null;
    const text = typeof data?.text === "string" ? data.text.trim() : "";
    if (text.length === 0) continue;
    if (message.type === "message") {
      lines.push(`## Owner`, "", text, "");
    } else if (message.type === "assistant") {
      lines.push(`## Roan`, "", text, "");
    }
  }
  lines.push(`*${String(info?.messages ?? 0)} messages — exported from the chain.*`);
  return lines.join("\n");
}
