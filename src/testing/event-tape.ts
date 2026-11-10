/**
 * Record and replay agent event streams as JSONL.
 *
 * A tape is the boring transport for a test: one `AgentEvent` per line, each
 * line a complete JSON object, every line terminated by `\n`. That makes a
 * tape diffable, appendable and greppable, and it turns a corrupt line into a
 * parse error that names the line instead of a mystery deep in a test.
 */

import type { AgentEvent } from "../types.js";

/** Marker appended to a shortened offending line in an error message. */
const ELLIPSIS = "…";

/** Longest slice of an offending line repeated back in an error message. */
const MAX_SNIPPET_CODE_POINTS = 120;

/** Every discriminant `AgentEvent` can carry; used to vet replayed lines. */
const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set<string>([
  "assistant_text",
  "tool_start",
  "tool_end",
  "error",
  "turn_end",
]);

/** Shorten `text` for inclusion in an error message, on a code point boundary. */
function snippet(text: string): string {
  const codePoints = Array.from(text);
  if (codePoints.length <= MAX_SNIPPET_CODE_POINTS) return text;
  return `${codePoints.slice(0, MAX_SNIPPET_CODE_POINTS).join("")}${ELLIPSIS}`;
}

/**
 * Serialise `events` as JSONL: one JSON object per line, each line ending in
 * `\n`. An empty tape is the empty string — no stray blank line.
 */
export function recordTape(events: AgentEvent[]): string {
  if (!Array.isArray(events)) {
    throw new Error(`recordTape: expected an array of events, got ${typeof events}`);
  }
  let tape = "";
  for (const event of events) {
    tape += `${JSON.stringify(event)}\n`;
  }
  return tape;
}

/**
 * Parse a tape produced by `recordTape`.
 *
 * Blank trailing lines (including the final newline) are ignored. Any other
 * line must be a JSON object whose `type` is a known `AgentEvent`
 * discriminant; otherwise this throws an error carrying the 1-based line
 * number and a shortened copy of the offending text.
 */
export function replayTape(jsonl: string): AgentEvent[] {
  if (typeof jsonl !== "string") {
    throw new Error(`replayTape: expected a string, got ${typeof jsonl}`);
  }

  const lines = jsonl.split("\n");
  // Only trailing blanks are tolerable: a blank line between two records
  // means the tape lost a record, which is not something to paper over.
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  const events: AgentEvent[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const lineNumber = index + 1;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `replayTape: line ${lineNumber} is not valid JSON (${reason}): ${snippet(line)}`,
      );
    }

    const type =
      typeof parsed === "object" && parsed !== null
        ? (parsed as { type?: unknown }).type
        : undefined;

    if (typeof type !== "string" || !KNOWN_EVENT_TYPES.has(type)) {
      throw new Error(
        `replayTape: line ${lineNumber} has unknown event type ${JSON.stringify(
          type,
        )}: ${snippet(line)}`,
      );
    }

    events.push(parsed as AgentEvent);
  }

  return events;
}
