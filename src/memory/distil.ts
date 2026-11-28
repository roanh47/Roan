/**
 * Auto-memory: what a finished conversation should still know tomorrow.
 *
 * When a session ends, the turn runner asks a model to distil at most three
 * durable facts out of it. "Durable" means: true beyond this task, about the
 * person, their machines or their conventions — not "the build failed at 14:02".
 *
 * The model call is injected as a plain function, so the whole distillation is
 * testable without a provider, a socket or a network. The answer is untrusted
 * input like any other: it may be a JSON array, a bullet list, or a paragraph of
 * prose, and the worst case is an empty list rather than a crash mid-session-end.
 *
 * Facts are deduplicated on their normalised text — case and whitespace do not
 * make two facts different — both inside one answer and against what the chain
 * already remembers.
 */

import type { Event } from "../protocol/types.js";

/** At most this many facts leave one session. More is a diary, not a memory. */
export const MEMORY_CAP = 3;

/** One line of the finished conversation, in the shape `sessionMessages` gives. */
export interface MemoryMessage {
  readonly role: string;
  readonly text: string;
}

/** The finished session, named by the id its `memory` events will point back to. */
export interface Conversation {
  readonly session: string;
  readonly messages: readonly MemoryMessage[];
}

/**
 * One durable fact and where it came from. This is exactly the payload of a
 * `memory` event: `{ text, source }`.
 */
export interface MemoryFact {
  readonly text: string;
  readonly source: string;
}

/** The injected model call: one prompt in, one answer out. */
export type DistilModel = (prompt: string) => Promise<string>;

/** How much of the conversation the prompt may carry. */
const MAX_MESSAGES = 30;
const MAX_MESSAGE_CHARS = 1500;

/**
 * The comparison key for a fact: lower-cased, whitespace collapsed to single
 * spaces, trimmed. Two facts with the same key are the same fact.
 */
export function normaliseFact(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Strip list markers and a wrapping quote pair; collapse inner whitespace. */
function cleanFact(value: string): string {
  let text = value.replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, "").trim();
  const wrapped =
    (text.startsWith("\"") && text.endsWith("\"")) ||
    (text.startsWith("'") && text.endsWith("'")) ||
    (text.startsWith("`") && text.endsWith("`"));
  if (wrapped && text.length >= 2) text = text.slice(1, -1).trim();
  return text.replace(/\s+/g, " ").trim();
}

/** Try `text` as JSON, and as the smallest JSON array inside it, in that order. */
function fromJson(text: string): string[] | null {
  const unfenced = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  const attempts = [unfenced];
  const start = unfenced.indexOf("[");
  const end = unfenced.lastIndexOf("]");
  if (start !== -1 && end > start) attempts.push(unfenced.slice(start, end + 1));

  for (const attempt of attempts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(attempt);
    } catch {
      continue;
    }
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string");
    }
  }
  return null;
}

/** Lines that start with a bullet or a number followed by a full stop. */
function fromBullets(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:[-*+•]|\d+[.)])\s+(.+)$/.exec(line);
    if (match?.[1] !== undefined) out.push(match[1]);
  }
  return out;
}

/**
 * Read whatever the model answered as a list of facts.
 *
 * A JSON array of strings wins; otherwise bullet lines are used; otherwise the
 * answer is prose and yields nothing. Empties, non-strings and duplicates (on
 * the normalised text) are dropped, and the list is capped at `MEMORY_CAP`.
 */
export function parseFacts(answer: string): string[] {
  const raw = fromJson(answer) ?? fromBullets(answer);
  const facts: string[] = [];
  const seen = new Set<string>();

  for (const value of raw) {
    const text = cleanFact(value);
    const key = normaliseFact(text);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    facts.push(text);
    if (facts.length === MEMORY_CAP) break;
  }

  return facts;
}

/**
 * The prompt handed to the model. Kept next to the parser so the two stay in
 * step: the instructions ask for the JSON the parser prefers, and the parser
 * survives a model that ignores them.
 */
export function buildDistilPrompt(
  conversation: Conversation,
  existing: readonly string[],
): string {
  const tail = conversation.messages.slice(-MAX_MESSAGES);
  const transcript = tail
    .map((message) => {
      const text = message.text.replace(/\s+/g, " ").trim().slice(0, MAX_MESSAGE_CHARS);
      return `${message.role === "assistant" ? "Assistant" : "User"}: ${text}`;
    })
    .join("\n");

  const known =
    existing.length === 0
      ? "Nothing is remembered yet."
      : `Already remembered (do not repeat these, in any wording):\n${existing
          .map((fact) => `- ${fact}`)
          .join("\n")}`;

  return [
    "You keep the long-term memory of a personal agent. Read the finished",
    "conversation below and write down at most three facts that will still be",
    "true and useful in a later session: who the person is, what they prefer,",
    "which machines, paths or conventions they use. Skip anything about this",
    "task only, anything already remembered, and anything you are not sure of.",
    "Each fact is one short sentence, in English, with no markdown inside it.",
    "",
    known,
    "",
    "Conversation:",
    transcript,
    "",
    `Answer with a JSON array of at most ${String(MEMORY_CAP)} strings and nothing else.`,
  ].join("\n");
}

/**
 * Distil a finished conversation into `memory` event payloads.
 *
 * Returns at most `MEMORY_CAP` facts, each `{ text, source: session }`, with no
 * fact repeating one in `existing` (case- and whitespace-insensitive) or an
 * earlier fact from the same answer. A conversation with no text never reaches
 * the model and yields nothing; a model error is the caller's to handle.
 */
export async function distilMemories(
  conversation: Conversation,
  existing: readonly string[],
  callModel: DistilModel,
): Promise<MemoryFact[]> {
  const messages = conversation.messages.filter((message) => message.text.trim().length > 0);
  if (messages.length === 0) return [];

  const known = new Set<string>();
  for (const fact of existing) {
    const key = normaliseFact(fact);
    if (key.length > 0) known.add(key);
  }

  const answer = await callModel(buildDistilPrompt({ ...conversation, messages }, existing));
  const facts: MemoryFact[] = [];

  for (const text of parseFacts(answer)) {
    const key = normaliseFact(text);
    if (key.length === 0 || known.has(key)) continue;
    known.add(key);
    facts.push({ text, source: conversation.session });
    if (facts.length === MEMORY_CAP) break;
  }

  return facts;
}

/**
 * The facts the chain already remembers, oldest first, as plain text. The same
 * fold `foldMemoryMd` uses, without the markdown.
 */
export function memoryTexts(events: readonly Event[]): string[] {
  return foldFacts(events).map((fact) => fact.text);
}

/** Newest text per normalised fact, oldest fact first; shared by the two folds. */
export function foldFacts(events: readonly Event[]): { text: string; seq: number }[] {
  const kept = new Map<string, { text: string; seq: number }>();

  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    if (event.type !== "memory") continue;
    const data: unknown = event.data;
    if (typeof data !== "object" || data === null) continue;
    const text = (data as Record<string, unknown>)["text"];
    if (typeof text !== "string") continue;
    const clean = text.replace(/\s+/g, " ").trim();
    const key = normaliseFact(clean);
    if (key.length === 0) continue;
    // The owner said this is wrong or no longer true: the fact leaves the
    // fold. Stating it again later brings it back, like any new fact.
    if ((data as Record<string, unknown>)["forgotten"] === true) {
      kept.delete(key);
      continue;
    }
    // The newest event wins the text; the key keeps one fact per thing.
    kept.set(key, { text: clean, seq: event.seq });
  }

  return [...kept.values()].sort((a, b) => a.seq - b.seq);
}
