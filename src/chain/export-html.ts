import type { Event } from "../protocol/types.js";
import { readSessions, sessionEvents } from "./sessions.js";

/**
 * One conversation as one self-contained HTML file.
 *
 * A shared file has to survive leaving the app: it carries its own styles,
 * makes no request of any kind, and runs no script. Everything that came from
 * a message — a title, a line of prose, a code fence, a link — is escaped
 * once, through `escapeHtml`, so a `<script>` in a message stays text that a
 * reader sees instead of code that a browser runs.
 *
 * Only the named session is rendered. Tool calls, tool results, env snapshots
 * and the rest of the chain are not part of a conversation someone shares, so
 * they never reach the page.
 */

/** How the document is stamped; omit `now` for byte-identical output. */
export interface ConversationHtmlOptions {
  /** Clock in epoch milliseconds for the "Exported" line. */
  readonly now?: number;
}

interface ImageOnEvent {
  readonly mime: string;
  readonly data: string;
}

interface Turn {
  asked: string | null;
  answering: string | null;
  photo: ImageOnEvent | null;
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** The only place a string becomes HTML. Every interpolation goes through it. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
}

/**
 * `2026-11-16 18:18 UTC`: one reading everywhere, in UTC so two machines
 * exporting the same chain produce the same line.
 */
export function formatStamp(ts: number): string {
  if (!Number.isFinite(ts)) return "";
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "";
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * The model this conversation ran on, when the chain recorded one. Newest
 * wins; nothing here guesses a name the chain never wrote down.
 */
export function sessionModel(events: readonly Event[], session: string): string | null {
  const owned = new Set(sessionEvents(events, session).map((event) => event.id));
  let model: string | null = null;
  for (const event of events) {
    const data = asRecord(event.data);
    const mine = event.type === "session" ? data?.["id"] === session : owned.has(event.id);
    if (!mine) continue;
    const name = data?.["model"];
    if (typeof name === "string" && name.trim().length > 0) model = name.trim();
  }
  return model;
}

function textOf(event: Event): string {
  const data = asRecord(event.data);
  const text = data?.["text"];
  return typeof text === "string" ? text.trim() : "";
}

function imageOnEvent(event: Event): ImageOnEvent | null {
  const data = asRecord(event.data);
  const image = asRecord(data?.["image"]);
  const mime = image?.["mime"];
  const payload = image?.["data"];
  if (typeof mime !== "string" || typeof payload !== "string" || payload.length === 0) return null;
  if (!mime.toLowerCase().startsWith("image/")) return null;
  return { mime, data: payload };
}

/** User turns with the answer that followed; an answer alone is its own turn. */
function turnsOf(events: readonly Event[], session: string): Turn[] {
  const turns: Turn[] = [];
  for (const event of sessionEvents(events, session)) {
    if (event.type === "message") {
      const photo = imageOnEvent(event);
      const text = textOf(event);
      // An empty message with no photo is nothing to share.
      if (text.length === 0 && photo === null) continue;
      turns.push({ asked: text, answering: null, photo });
      continue;
    }
    if (event.type !== "assistant") continue;
    const text = textOf(event);
    if (text.length === 0) continue;
    const last = turns[turns.length - 1];
    // An assistant line only joins an unanswered question; anything else is
    // the start of a new turn, never appended to an answer already there.
    if (last !== undefined && last.asked !== null && last.answering === null) last.answering = text;
    else turns.push({ asked: null, answering: text, photo: null });
  }
  return turns;
}

interface Block {
  readonly code: boolean;
  readonly lang: string;
  readonly body: string;
}

/** Splits on ``` fences; an unclosed fence stays code, which is the safe read. */
function splitBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let body: string[] = [];
  let lang = "";
  let inCode = false;
  for (const line of text.split(/\r?\n/)) {
    const fence = /^```\s*([A-Za-z0-9_+.-]*)\s*$/.exec(line);
    if (fence === null) {
      body.push(line);
      continue;
    }
    if (inCode) {
      blocks.push({ code: true, lang, body: body.join("\n") });
      inCode = false;
      lang = "";
    } else {
      if (body.length > 0) blocks.push({ code: false, lang: "", body: body.join("\n") });
      inCode = true;
      lang = fence[1] ?? "";
    }
    body = [];
  }
  blocks.push({ code: inCode, lang, body: body.join("\n") });
  return blocks;
}

/**
 * Escaped text with bare http(s) urls as anchors and the two markdown marks a
 * reply actually leans on — `code` and **bold** — as tags. Escaping happens
 * first, so the only markup in the result is the markup added here.
 */
function renderInline(text: string, escape: (value: string) => string): string {
  return text
    .split("\n")
    .map((line) =>
      escape(line)
        .replace(/`([^`\n]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
        .replace(
          /(^|[\s(])(https?:\/\/[^\s<>"']+)/g,
          (_all, lead: string, url: string) =>
            `${lead}<a href="${url}" rel="noopener noreferrer">${url}</a>`,
        ),
    )
    .join("<br>");
}

function renderMessage(text: string): string {
  const parts: string[] = [];
  for (const block of splitBlocks(text)) {
    if (block.code) {
      const klass = /^[A-Za-z0-9_+.-]{1,24}$/.test(block.lang)
        ? ` class="language-${escapeHtml(block.lang)}"`
        : "";
      parts.push(`<pre><code${klass}>${escapeHtml(block.body)}</code></pre>`);
      continue;
    }
    for (const paragraph of block.body.split(/\n{2,}/)) {
      const trimmed = paragraph.trim();
      if (trimmed.length === 0) continue;
      parts.push(`<p>${renderInline(trimmed, escapeHtml)}</p>`);
    }
  }
  return parts.join("\n");
}

const STYLE = `
:root {
  color-scheme: light;
  --bg: #f7f8f7;
  --paper: #ffffff;
  --ink: #16191c;
  --muted: #5c666b;
  --line: #e2e6e4;
  --accent: #17775a;
  --code-bg: #f1f4f2;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
.page { max-width: 46rem; margin: 0 auto; padding: 3rem 1.25rem 4rem; }
header { border-bottom: 2px solid var(--accent); padding-bottom: 1rem; margin-bottom: 2rem; }
h1 { font-size: 1.75rem; line-height: 1.25; margin: 0 0 .5rem; }
.meta { margin: 0; color: var(--muted); font-size: .875rem; }
.turn {
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: .75rem;
  padding: 1rem 1.25rem;
  margin: 0 0 1.25rem;
}
.turn h2 {
  font-size: .75rem;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--muted);
  margin: 0 0 .5rem;
}
.asked h2 { color: var(--accent); }
.answered { border-top: 1px solid var(--line); margin-top: .75rem; padding-top: .75rem; }
p { margin: 0 0 .75rem; overflow-wrap: anywhere; }
p:last-child { margin-bottom: 0; }
a { color: var(--accent); }
pre {
  background: var(--code-bg);
  border: 1px solid var(--line);
  border-radius: .5rem;
  padding: .75rem 1rem;
  overflow-x: auto;
  margin: 0 0 .75rem;
}
code { font: .875rem/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
img { max-width: 100%; border-radius: .5rem; display: block; margin: 0 0 .75rem; }
footer {
  margin-top: 2.5rem;
  padding-top: 1rem;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: .875rem;
}
@media print {
  body { background: #fff; }
  .turn { break-inside: avoid; }
}
`.trim();

function renderTurn(turn: Turn): string {
  const sections: string[] = [];
  const photo =
    turn.photo === null
      ? ""
      : `<img src="data:${escapeHtml(turn.photo.mime)};base64,${escapeHtml(turn.photo.data)}" alt="Photo">`;
  if (turn.asked !== null || photo.length > 0) {
    sections.push(
      `<section class="asked"><h2>Owner</h2>${photo}${renderMessage(turn.asked ?? "")}</section>`,
    );
  }
  if (turn.answering !== null) {
    sections.push(
      `<section class="answered"><h2>Roan</h2>${renderMessage(turn.answering)}</section>`,
    );
  }
  return `<article class="turn">\n${sections.join("\n")}\n</article>`;
}

/**
 * The whole page: title, when it started, how many turns, the turns
 * themselves and the footer. Nothing else from the chain goes in.
 */
export function renderConversationHtml(
  events: readonly Event[],
  sessionId: string,
  options: ConversationHtmlOptions = {},
): string {
  const info = readSessions(events).sessions.find((entry) => entry.id === sessionId);
  const title = info?.title ?? "Conversation";
  const turns = turnsOf(events, sessionId).filter(
    (turn) => turn.asked !== null || turn.answering !== null || turn.photo !== null,
  );
  const model = sessionModel(events, sessionId);

  const meta: string[] = [];
  if (info !== undefined) meta.push(`Started ${formatStamp(info.startedAt)}`);
  meta.push(`${String(turns.length)} ${turns.length === 1 ? "turn" : "turns"}`);
  if (model !== null) meta.push(`model ${model}`);
  if (options.now !== undefined) meta.push(`exported ${formatStamp(options.now)}`);

  const articles = turns.map(renderTurn).join("\n");

  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    // A shared conversation is not a page anyone should find in search.
    '<meta name="robots" content="noindex">',
    `<title>${escapeHtml(title)} — Roan</title>`,
    `<style>\n${STYLE}\n</style>`,
    "</head>",
    "<body>",
    '<div class="page">',
    "<header>",
    `<h1>${escapeHtml(title)}</h1>`,
    `<p class="meta">${escapeHtml(meta.join(" · "))}</p>`,
    "</header>",
    "<main>",
    articles,
    "</main>",
    "<footer>Shared from Roan</footer>",
    "</div>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}
