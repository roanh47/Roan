/**
 * JSONL export and import for a single event chain.
 *
 * Export streams the chain out of the store page by page (`store.read` caps a
 * page at 10000 events) and writes one `Event` per line, so a chain larger than
 * one page round-trips intact.
 *
 * Import is deliberately strict: it only fills an empty chain, it keeps file
 * order, and it rejects a malformed line with an error naming the 1-based line
 * number. `seq` and `chain` are stripped from each record — the store assigns a
 * fresh `seq`, and the target chain decides the chain name. Lines whose event id
 * is already in the file are skipped rather than duplicated (`append` would
 * no-op on them anyway).
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  StoreError,
  type EventStore,
  type EventType,
  type NewEvent,
} from "./store.js";

/** Mirrors the store's page cap; larger requests are clamped there anyway. */
const PAGE_SIZE = 10_000;

const EVENT_TYPES: ReadonlySet<string> = new Set<EventType>([
  "message",
  "assistant",
  "tool_call",
  "tool_result",
  "error",
  "turn_start",
  "turn_end",
  "env",
]);

/**
 * Write every event of `chain` to `outPath` as JSONL, oldest first.
 *
 * The parent directory is created when missing. An empty chain produces an
 * empty file and `{ count: 0, head: 0 }`.
 */
export function exportChain(
  store: EventStore,
  chain: string,
  outPath: string,
): { count: number; head: number } {
  if (typeof outPath !== "string" || outPath.length === 0) {
    throw new StoreError("export path must be a non-empty string");
  }

  const lines: string[] = [];
  let fromSeq = 1;
  let head = 0;

  for (;;) {
    const page = store.read(chain, fromSeq, PAGE_SIZE);
    if (page.length === 0) {
      break;
    }
    for (const event of page) {
      lines.push(JSON.stringify(event));
      head = event.seq;
    }
    const last = page[page.length - 1];
    if (last === undefined) {
      break;
    }
    fromSeq = last.seq + 1;
  }

  mkdirSync(dirname(outPath), { recursive: true });
  const text = lines.length === 0 ? "" : `${lines.join("\n")}\n`;
  writeFileSync(outPath, text, "utf8");

  return { count: lines.length, head };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Narrow one parsed JSON line into a `NewEvent`. Throws with the 1-based line
 * number on anything that is not a well-formed event.
 */
function toNewEvent(value: unknown, lineNumber: number): NewEvent {
  const fail = (reason: string): never => {
    throw new StoreError(`line ${lineNumber}: ${reason}`);
  };

  if (!isRecord(value)) {
    fail("event must be a JSON object");
  }

  const record = value as Record<string, unknown>;

  if (record["v"] !== undefined && record["v"] !== 1) {
    fail(`unsupported event version: ${JSON.stringify(record["v"])}`);
  }

  const id = record["id"];
  if (typeof id !== "string" || id.length === 0) {
    fail("event.id must be a non-empty string");
  }

  const node = record["node"];
  if (typeof node !== "string" || node.length === 0) {
    fail("event.node must be a non-empty string");
  }

  const ts = record["ts"];
  if (typeof ts !== "number" || !Number.isSafeInteger(ts) || ts < 0) {
    fail("event.ts must be a non-negative integer");
  }

  const type = record["type"];
  if (typeof type !== "string" || !EVENT_TYPES.has(type)) {
    fail(`unknown event type: ${JSON.stringify(type)}`);
  }

  // `chain` and `seq` are intentionally dropped: the store owns both.
  return {
    id: id as string,
    node: node as string,
    ts: ts as number,
    type: type as EventType,
    data: record["data"],
  };
}

/**
 * Append the events in `inPath` to `chain`, which must be empty.
 *
 * Blank lines are skipped and counted. File order is preserved. Throws a
 * `StoreError` with `line N:` in the message when a line is not valid JSON or
 * not a well-formed event.
 */
export function importChain(
  store: EventStore,
  chain: string,
  inPath: string,
): { imported: number; skipped: number } {
  const currentHead = store.head(chain);
  if (currentHead !== 0) {
    throw new StoreError(
      `chain ${JSON.stringify(chain)} is not empty (head ${currentHead}); import requires an empty chain`,
    );
  }

  const text = readFileSync(inPath, "utf8");
  const rawLines = text.split("\n");
  // A trailing newline (which export always writes) is not a blank event line.
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") {
    rawLines.pop();
  }

  let imported = 0;
  let skipped = 0;
  const seenIds = new Set<string>();

  for (let index = 0; index < rawLines.length; index += 1) {
    const lineNumber = index + 1;
    let line = rawLines[index] ?? "";
    if (lineNumber === 1 && line.startsWith("\uFEFF")) {
      line = line.slice(1);
    }
    if (line.trim().length === 0) {
      skipped += 1;
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new StoreError(`line ${lineNumber}: malformed JSON: ${detail}`);
    }

    const event = toNewEvent(parsed, lineNumber);

    if (seenIds.has(event.id)) {
      skipped += 1;
      continue;
    }
    seenIds.add(event.id);

    store.append(chain, event);
    imported += 1;
  }

  return { imported, skipped };
}
