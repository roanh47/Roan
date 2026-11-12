/**
 * Case-insensitive text search over a chain's events.
 *
 * "Event text" is every string inside `event.data`, in traversal order: object
 * properties in insertion order, array elements in index order. Keys are not
 * searched, only values, and numbers/booleans/null are skipped. The first
 * matching string in an event decides the snippet, so the hit is one per event
 * rather than one per occurrence — the caller gets a readable line, not a list
 * of offsets.
 *
 * Two entry points, same answer:
 *
 * - `searchEvents(events, query, options?)` is pure; it needs no store, so a
 *   test can hand it an array.
 * - `searchStore(store, chain, query, options?)` pages the chain through
 *   `store.read()` in 10000-event pages and stops as soon as one match beyond
 *   the cap is seen, so a hit-limited search does not walk a huge chain.
 *
 * Matching lowercases both sides once per string. That is the ordinary
 * definition of case-insensitive; it does not do Unicode case folding, so a
 * few exotic pairs (`ß`/`SS`, Turkish dotted `İ`) will not match. The snippet
 * is a single line: whitespace runs collapse to one space, and `…` marks text
 * cut off at either end.
 */

import { StoreError, type Event, type EventStore } from "./store.js";

/** `EventStore.read` caps a page at 10000; asking for more just hides that. */
const PAGE_SIZE = 10_000;

/** Defensive bound on paging, mirroring `verify.ts`. */
const MAX_PAGES = 10_000;

/** Default number of hits returned. */
const DEFAULT_LIMIT = 50;

/** Hard ceiling on `limit`, whatever the caller asks for. */
const MAX_LIMIT = 1000;

/** Default characters of context kept on each side of the match. */
const DEFAULT_CONTEXT = 40;

/** Deep enough for any real payload, shallow enough to stop a pathological one. */
const MAX_DEPTH = 20;

/** One matching event. */
export interface SearchHit {
  /** Seq of the event that matched. */
  seq: number;
  /** Event type, so a caller can tell a message from a tool result. */
  type: string;
  /** Single-line excerpt around the first match, with `…` where text was cut. */
  snippet: string;
}

/** Outcome of one search. */
export interface SearchResult {
  /** The query as given (not lowercased). */
  query: string;
  /** Matches in chain order, at most `limit` of them. */
  hits: SearchHit[];
  /**
   * True when at least one further event matched beyond `limit`. The search
   * stops there, so this says "more exist", not how many.
   */
  truncated: boolean;
}

/** Tuning for `searchEvents` / `searchStore`. */
export interface SearchOptions {
  /** Most hits to return. Default 50, capped at 1000. */
  limit?: number;
  /** Characters of context on each side of the match. Default 40. */
  context?: number;
}

/** What search needs from an event; both `store.Event` and `sync.Event` fit. */
export interface SearchableEvent {
  seq: number;
  type: string;
  data: unknown;
}

/** Options after defaults and caps have been applied. */
interface ResolvedSearchOptions {
  limit: number;
  context: number;
}

function resolveOptions(options: SearchOptions | undefined): ResolvedSearchOptions {
  const limit = options?.limit ?? DEFAULT_LIMIT;
  const context = options?.context ?? DEFAULT_CONTEXT;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new StoreError("search limit must be a positive integer");
  }
  if (!Number.isSafeInteger(context) || context < 0) {
    throw new StoreError("search context must be a non-negative integer");
  }
  return { limit: Math.min(limit, MAX_LIMIT), context };
}

function requireQuery(query: string): string {
  if (typeof query !== "string" || query.trim().length === 0) {
    throw new StoreError("search query must be a non-empty string");
  }
  return query.toLowerCase();
}

/**
 * Every string value under `value`, depth first. Keys are skipped. Cyclic
 * input is cut at the first repeat rather than allowed to recurse forever.
 */
function collectStrings(
  value: unknown,
  out: string[],
  seen: Set<object>,
  depth: number,
): void {
  if (depth > MAX_DEPTH || typeof value === "string") {
    if (typeof value === "string") {
      out.push(value);
    }
    return;
  }
  if (typeof value !== "object" || value === null) {
    return;
  }
  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, out, seen, depth + 1);
    }
    return;
  }
  for (const item of Object.values(value as Record<string, unknown>)) {
    collectStrings(item, out, seen, depth + 1);
  }
}

/**
 * One-line excerpt of `text` around the match at `index`. Whitespace runs
 * become single spaces; `…` is added on a side where text was dropped.
 */
function makeSnippet(
  text: string,
  index: number,
  matchLength: number,
  context: number,
): string {
  const start = Math.max(0, index - context);
  const end = Math.min(text.length, index + matchLength + context);
  const body = text.slice(start, end).replace(/\s+/g, " ").trim();
  const leading = start > 0 ? "…" : "";
  const trailing = end < text.length ? "…" : "";
  return `${leading}${body}${trailing}`;
}

/**
 * Snippet for `event`, or `undefined` when no string in its payload contains
 * `needle` (already lowercase).
 */
function matchEvent(
  event: SearchableEvent,
  needle: string,
  context: number,
): string | undefined {
  const strings: string[] = [];
  collectStrings(event.data, strings, new Set<object>(), 0);

  for (const text of strings) {
    const index = text.toLowerCase().indexOf(needle);
    if (index !== -1) {
      return makeSnippet(text, index, needle.length, context);
    }
  }
  return undefined;
}

/**
 * Search `events` in the order given.
 *
 * Returns at most `options.limit` hits (default 50, capped at 1000) and sets
 * `truncated` when a further event would have matched. An empty `query` or a
 * non-string one throws `StoreError`; a query with no match is not an error.
 * `data` that cannot be traversed (a radical depth) is simply not searched
 * further, never a throw.
 */
export function searchEvents(
  events: readonly SearchableEvent[],
  query: string,
  options?: SearchOptions,
): SearchResult {
  const needle = requireQuery(query);
  const { limit, context } = resolveOptions(options);

  const hits: SearchHit[] = [];
  for (const event of events) {
    const snippet = matchEvent(event, needle, context);
    if (snippet === undefined) {
      continue;
    }
    if (hits.length >= limit) {
      return { query, hits, truncated: true };
    }
    hits.push({ seq: event.seq, type: event.type, snippet });
  }
  return { query, hits, truncated: false };
}

/**
 * Search `chain` in `store`, oldest event first.
 *
 * Pages with `store.read(chain, from, 10000)` until the chain ends, a guard is
 * hit, or one match past `limit` has been seen. Throws only what the store
 * throws (for example a closed store or an empty chain name); a query with no
 * match yields `{ hits: [], truncated: false }`.
 */
export function searchStore(
  store: EventStore,
  chain: string,
  query: string,
  options?: SearchOptions,
): SearchResult {
  const needle = requireQuery(query);
  const { limit, context } = resolveOptions(options);

  const hits: SearchHit[] = [];
  let from = 1;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const batch: Event[] = store.read(chain, from, PAGE_SIZE);
    for (const event of batch) {
      const snippet = matchEvent(event, needle, context);
      if (snippet === undefined) {
        continue;
      }
      if (hits.length >= limit) {
        return { query, hits, truncated: true };
      }
      hits.push({ seq: event.seq, type: event.type, snippet });
    }

    if (batch.length < PAGE_SIZE) {
      return { query, hits, truncated: false };
    }
    const last = batch[batch.length - 1];
    const next = last === undefined ? from : last.seq + 1;
    if (!Number.isSafeInteger(next) || next <= from) {
      // A page that does not advance would loop forever; stop with what we have.
      return { query, hits, truncated: false };
    }
    from = next;
  }

  return { query, hits, truncated: false };
}
