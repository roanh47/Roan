/**
 * Search the facts and messages the chain already holds.
 *
 * `search.ts` in `src/chain/` answers "which event mentions this text?" over one
 * chain, in chain order. This module answers a different question: "what do we
 * know that matches this?" — it looks at `memory` and `message` events only, ranks
 * the matches, and reports where each one came from so the caller can open the
 * session or the seq it was found in.
 *
 * Three entry points, one ranker:
 *
 * - `searchMemories(db, query, limit)` reads the `events` table directly. That is
 *   the wiring path: one query over the whole store, every chain included.
 * - `searchStoreMemories(store, chain, query, limit)` pages an `EventStore`, for
 *   code that holds a store handle but not the SQLite file.
 * - `searchMemoryEvents(events, query, limit)` is pure, so a test can hand it an
 *   array and the two adapters stay thin.
 *
 * Ranking: for each query word, a hit earns 10 points plus one per repeat (capped
 * at 9), so "covers both words" beats "says one word five times". A `memory` row
 * earns 5 extra: a distilled fact is worth more than the chat it came from. Ties
 * go to the newest seq. Scores are integers, so ordering is stable and testable.
 *
 * Why a scored LIKE read and not FTS5: the search path must not own the schema.
 * An FTS index only pays off if it is maintained on every append, which means a
 * trigger on `events` in `src/chain/store.ts` — a module this one may not change —
 * and rebuilding an index per query is slower than the scan it replaces. The scan
 * is therefore bounded (`MAX_SCAN` newest rows) and the ranking happens in JS,
 * where Unicode lowercasing is correct (SQLite's `lower()` is ASCII-only).
 *
 * Garbage in, empty out: an empty query, punctuation, SQL metacharacters or a
 * lone one-letter word all yield `[]`. Nothing in a query reaches SQL as text —
 * words are split to `[\p{L}\p{N}]` runs and bound as parameters — so there is
 * nothing to escape and nothing to inject.
 */

import type { DatabaseSync, SQLInputValue, SQLOutputValue } from "node:sqlite";
import type { EventStore } from "../chain/store.js";
import { makeSnippet } from "../chain/search.js";

/** Hits returned when the caller does not say. */
export const DEFAULT_MEMORY_LIMIT = 20;

/** Hard ceiling on `limit`, whatever the caller asks for. */
export const MAX_MEMORY_LIMIT = 200;

/** Event types that count as knowledge; everything else is machinery. */
const MEMORY_TYPES: readonly string[] = ["memory", "message"];

/** Pages and scan bound, mirroring `chain/search.ts`. */
const PAGE_SIZE = 10_000;
const MAX_PAGES = 10_000;

/** Rows read at most, newest first, so a huge chain still answers quickly. */
const MAX_SCAN = 20_000;

/** Distinct query words considered; more is a paragraph, not a query. */
const MAX_TERMS = 16;

/** A one-letter word matches everything; it is not a search. */
const MIN_TERM_CHARS = 2;

/** Characters of a hit kept before it becomes an excerpt around the match. */
const MAX_TEXT_CHARS = 500;

/** Extra weight for a distilled fact over a chat message. */
const MEMORY_TYPE_BONUS = 5;

/** Points per matched word, before repeats. */
const TERM_POINTS = 10;

/** Points per extra occurrence of the same word. */
const REPEAT_POINTS = 1;

/** Repeats counted per word, so one spammy message cannot dominate. */
const MAX_REPEATS = 9;

/** Only an all-ASCII word may be pushed into SQLite's ASCII-only `lower()`. */
const ASCII_TERM = /^[a-z0-9]+$/;

/** Words pushed into SQL to shrink the scan; the rest is scored in JS. */
const MAX_PUSHED_TERMS = 3;

/** Where a hit was found: the chain, the seq, and the session when known. */
export interface MemorySourceRef {
  /** Chain the event belongs to. */
  readonly chain: string;
  /** Seq of the event inside that chain. */
  readonly seq: number;
  /** Session id the event names, when it names one. */
  readonly session?: string;
}

/** One match. */
export interface MemoryHit {
  /** One-line text of the event, capped, centred on the first match when long. */
  readonly text: string;
  /** Integer relevance; higher is better. */
  readonly score: number;
  /** Which kind of row matched. */
  readonly kind: "memory" | "message";
  /** Event the text came from. */
  readonly source: MemorySourceRef;
}

/** What the ranker needs; `Event` fits, and so does a row read from SQLite. */
export interface MemoryEventLike {
  readonly chain: string;
  readonly seq: number;
  readonly type: string;
  readonly data: unknown;
}

/** The parsed part of a memory/message payload that search cares about. */
interface Payload {
  readonly text: string;
  readonly session?: string;
}

/**
 * Split a query into lowercase words.
 *
 * Normalises NFKC (so full-width characters match their plain forms), lowercases,
 * then cuts on everything that is not a letter or a digit. Words shorter than two
 * characters and repeats are dropped, and at most {@link MAX_TERMS} survive. A
 * non-string or a query with no words gives `[]` — never a throw.
 */
export function queryTerms(query: string): string[] {
  if (typeof query !== "string") return [];
  const words = query
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= MIN_TERM_CHARS);

  const seen = new Set<string>();
  const terms: string[] = [];
  for (const word of words) {
    if (seen.has(word)) continue;
    seen.add(word);
    terms.push(word);
    if (terms.length >= MAX_TERMS) break;
  }
  return terms;
}

function resolveLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_MEMORY_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError("memory search limit must be a positive integer");
  }
  return Math.min(limit, MAX_MEMORY_LIMIT);
}

/** First non-empty string among the candidates. */
function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

/**
 * The searchable part of an event payload, or undefined when there is none.
 * Whitespace runs collapse to one space: a hit is a line, not a document.
 */
function payloadOf(data: unknown): Payload | undefined {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return undefined;
  const record = data as Record<string, unknown>;
  const raw = record["text"];
  if (typeof raw !== "string") return undefined;
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length === 0) return undefined;
  const session = firstString(record["session"], record["source"]);
  return session === undefined ? { text } : { text, session };
}

/** Non-overlapping occurrences of `needle` in an already lowercase haystack. */
function occurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const index = haystack.indexOf(needle, from);
    if (index === -1) return count;
    count += 1;
    if (count >= MAX_REPEATS) return count;
    from = index + needle.length;
  }
}

/**
 * Long text becomes an excerpt around the first match, reusing the one-line
 * snippet rule from `chain/search.ts`. Short text is returned whole.
 */
function excerpt(text: string, index: number, matchLength: number): string {
  if (text.length <= MAX_TEXT_CHARS) return text;
  const context = Math.max(20, Math.floor((MAX_TEXT_CHARS - matchLength) / 2));
  return makeSnippet(text, Math.max(0, index), matchLength, context);
}

/** Score one event, or undefined when it holds no match. */
function scoreEvent(event: MemoryEventLike, terms: readonly string[]): MemoryHit | undefined {
  if (!MEMORY_TYPES.includes(event.type)) return undefined;
  const payload = payloadOf(event.data);
  if (payload === undefined) return undefined;

  const haystack = payload.text.toLowerCase();
  // Lowercasing a few codepoints changes the length (e.g. "İ"); an offset from
  // the lowercase copy would then point at the wrong place in the original.
  const offsetsAgree = haystack.length === payload.text.length;

  let matched = 0;
  let score = 0;
  let firstIndex = -1;
  let firstLength = 0;

  for (const term of terms) {
    const count = occurrences(haystack, term);
    if (count === 0) continue;
    matched += 1;
    score += TERM_POINTS + Math.min(count - 1, MAX_REPEATS) * REPEAT_POINTS;
    const index = haystack.indexOf(term);
    if (offsetsAgree && index !== -1 && (firstIndex === -1 || index < firstIndex)) {
      firstIndex = index;
      firstLength = term.length;
    }
  }

  if (matched === 0) return undefined;
  if (event.type === "memory") score += MEMORY_TYPE_BONUS;

  const kind = event.type === "memory" ? "memory" : "message";
  const source: MemorySourceRef =
    payload.session === undefined
      ? { chain: event.chain, seq: event.seq }
      : { chain: event.chain, seq: event.seq, session: payload.session };

  return { text: excerpt(payload.text, firstIndex, firstLength), score, kind, source };
}

/** Text used to collapse restatements of the same fact into one hit. */
function dedupeKey(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Search a list of events (pure).
 *
 * Returns at most `limit` hits (default 20, capped at 200), best first. Restated
 * text is reported once: the highest-scoring copy wins, and on a tie the newest
 * seq. A query with no usable words or no match gives `[]`, never a throw.
 */
export function searchMemoryEvents(
  events: readonly MemoryEventLike[],
  query: string,
  limit?: number,
): MemoryHit[] {
  const terms = queryTerms(query);
  const max = resolveLimit(limit);
  if (terms.length === 0) return [];

  const best = new Map<string, MemoryHit>();
  for (const event of events) {
    const hit = scoreEvent(event, terms);
    if (hit === undefined) continue;
    const key = dedupeKey(hit.text);
    const previous = best.get(key);
    const better =
      previous === undefined ||
      hit.score > previous.score ||
      (hit.score === previous.score && hit.source.seq > previous.source.seq);
    if (better) best.set(key, hit);
  }

  return [...best.values()]
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.source.seq - a.source.seq ||
        a.source.chain.localeCompare(b.source.chain),
    )
    .slice(0, max);
}

function asText(value: SQLOutputValue | undefined, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`event store row has a non-text ${field}`);
  }
  return value;
}

function asSeq(value: SQLOutputValue | undefined): number {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "bigint" && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
  throw new Error("event store row has a non-integer seq");
}

/**
 * Search the `events` table `db` directly, across every chain.
 *
 * Reads at most `MAX_SCAN` newest memory/message rows and ranks them in JS. The
 * ASCII words among the query are also pushed into SQL as `instr(lower(data), …)`
 * filters — a strict superset of the eventual matches, which only shrinks the
 * scan. Non-ASCII words are scored in JS only, because SQLite's `lower()` would
 * not fold `É` to `é`.
 *
 * Throws only what SQLite throws (for example a database without an `events`
 * table); an unparseable payload is skipped rather than fatal.
 */
export function searchMemories(db: DatabaseSync, query: string, limit?: number): MemoryHit[] {
  const terms = queryTerms(query);
  const max = resolveLimit(limit);
  if (terms.length === 0) return [];

  const pushed = terms.filter((term) => ASCII_TERM.test(term)).slice(0, MAX_PUSHED_TERMS);
  let sql = "SELECT chain, seq, type, data FROM events WHERE type IN ('memory', 'message')";
  const params: Record<string, SQLInputValue> = { scan: MAX_SCAN };
  if (pushed.length > 0) {
    // OR, not AND: the JS ranker scores each word separately, so a row matching
    // any one word must survive the filter. The filter is a superset, never a
    // second, differently-behaved notion of "matches".
    const any: string[] = [];
    pushed.forEach((term, index) => {
      any.push(`instr(lower(data), :t${String(index)}) > 0`);
      params[`t${String(index)}`] = term;
    });
    sql += ` AND (${any.join(" OR ")})`;
  }
  sql += " ORDER BY ts DESC, seq DESC LIMIT :scan";

  const rows = db.prepare(sql).all(params);

  const events: MemoryEventLike[] = [];
  for (const row of rows) {
    let data: unknown;
    try {
      data = JSON.parse(asText(row["data"], "data")) as unknown;
    } catch {
      continue;
    }
    events.push({
      chain: asText(row["chain"], "chain"),
      seq: asSeq(row["seq"]),
      type: asText(row["type"], "type"),
      data,
    });
  }

  return searchMemoryEvents(events, query, max);
}

/**
 * Search one chain through an `EventStore`.
 *
 * For callers that hold a store and not the SQLite handle. Pages the chain oldest
 * first and keeps at most `MAX_SCAN` memory/message events, so a very long chain
 * still answers; ranking is the same as `searchMemories`.
 */
export function searchStoreMemories(
  store: EventStore,
  chain: string,
  query: string,
  limit?: number,
): MemoryHit[] {
  const terms = queryTerms(query);
  const max = resolveLimit(limit);
  if (terms.length === 0) return [];

  const events: MemoryEventLike[] = [];
  let from = 1;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const batch = store.read(chain, from, PAGE_SIZE);
    for (const event of batch) {
      if (!MEMORY_TYPES.includes(event.type)) continue;
      events.push({ chain: event.chain, seq: event.seq, type: event.type, data: event.data });
      if (events.length >= MAX_SCAN) break;
    }
    if (events.length >= MAX_SCAN || batch.length < PAGE_SIZE) break;

    const last = batch[batch.length - 1];
    const next = last === undefined ? from : last.seq + 1;
    if (!Number.isSafeInteger(next) || next <= from) break;
    from = next;
  }

  return searchMemoryEvents(events, query, max);
}
