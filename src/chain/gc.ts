/**
 * Compaction *planning* for a chain.
 *
 * This module answers one question: if we were allowed to compact this chain,
 * what would be worth compacting? It never compacts. There is no writer here,
 * no `fs`, no `append`, no `DELETE`: `store.read()` and `store.head()` are the
 * only store calls, and the result is a report.
 *
 * Three kinds of candidate are reported:
 *
 * - `same-type-run` — a run of consecutive events (in `seq` order) sharing one
 *   type that is longer than `minRunLength`. Only the last `keepRunTail` events
 *   of the run are worth keeping; the rest is redundant repetition (the classic
 *   case is a long chain of `tool_result`s nobody will gather again).
 * - `duplicate-id` — the same `id` under two or more `seq` values. The schema
 *   has `UNIQUE (chain, id)`, so this must be impossible; it is reported as
 *   corruption, not as ordinary savings.
 * - `large-old-tool-event` — a `tool_call` / `tool_result` outside the
 *   `keepRecent` window whose serialized payload is at least `largeDataBytes`.
 *   Old tool payloads are the bulk of a chain's bytes and the safest to fold
 *   into a stub.
 *
 * Reads happen through `read()` in pages of at most 10000 events (its ceiling),
 * so memory stays bounded by the page plus the duplicate-id index.
 */

import type { Event, EventStore, EventType } from "./store.js";

/** `read()` silently caps `limit` at 10000; asking for more just hides that. */
const PAGE_SIZE = 10_000;

/**
 * Serialized size a folded tool payload is assumed to shrink to: a stub holding
 * the original id, type and a marker. Savings for a fold are the payload size
 * minus this, so the estimate is deliberately conservative rather than "the
 * whole payload disappears".
 */
const FOLD_STUB_BYTES = 256;

export interface CompactionOptions {
  /** A run must be strictly longer than this to be reported. Default 20. */
  minRunLength?: number;
  /** How many trailing events of a run are worth keeping. Default 1. */
  keepRunTail?: number;
  /** Most recent events never considered for folding: the tail of the chain. Default 50. */
  keepRecent?: number;
  /** Minimum serialized payload size (UTF-8 bytes) for a fold candidate. Default 4096. */
  largeDataBytes?: number;
}

export interface ResolvedCompactionOptions {
  minRunLength: number;
  keepRunTail: number;
  keepRecent: number;
  largeDataBytes: number;
}

export type CompactionCandidateKind =
  | "same-type-run"
  | "duplicate-id"
  | "large-old-tool-event";

export interface CompactionCandidate {
  kind: CompactionCandidateKind;
  /** First seq covered by the candidate. */
  seqFrom: number;
  /** Last seq that would go away (for a run) or the last copy (for a duplicate id). */
  seqTo: number;
  /** Number of events covered: the events that would go away or change. */
  eventCount: number;
  /**
   * Estimate of bytes freed by this candidate, from the UTF-8 length of
   * `JSON.stringify(event.data)`. Folds subtract the stub cost.
   */
  estimatedBytesSaved: number;
  /** One sentence a human can act on. */
  reason: string;
}

export interface CompactionKindTotals {
  candidates: number;
  eventCount: number;
  estimatedBytesSaved: number;
}

export interface CompactionReport {
  chain: string;
  /** What was actually read, so the caller can tell a full scan from a partial one. */
  scanned: {
    events: number;
    pages: number;
    fromSeq: number;
    toSeq: number;
    head: number;
    /** Highest old seq; events above it are inside the `keepRecent` window. 0 = no window. */
    recentFloor: number;
    /** True only when the scan reached the head without hitting a guard. */
    complete: boolean;
  };
  options: ResolvedCompactionOptions;
  candidates: CompactionCandidate[];
  /** True when at least one candidate would need the chain rewritten (all but corruption). */
  requiresRewrite: boolean;
  corruption: {
    duplicateIds: string[];
    /** True when the store's UNIQUE (chain, id) invariant appears violated. */
    detected: boolean;
  };
  totals: CompactionKindTotals & {
    byKind: Record<CompactionCandidateKind, CompactionKindTotals>;
  };
  warnings: string[];
}

const DEFAULTS: ResolvedCompactionOptions = {
  minRunLength: 20,
  keepRunTail: 1,
  keepRecent: 50,
  largeDataBytes: 4096,
};

function resolveOptions(options: CompactionOptions | undefined): ResolvedCompactionOptions {
  const raw: unknown = options;
  if (raw !== undefined && (raw === null || typeof raw !== "object")) {
    throw new TypeError("compaction options must be an object when given");
  }
  const pick = (value: number | undefined, name: string, min: number, fallback: number): number => {
    if (value === undefined) {
      return fallback;
    }
    if (!Number.isSafeInteger(value) || value < min) {
      throw new RangeError(`compaction option ${name} must be an integer >= ${min}`);
    }
    return value;
  };
  const minRunLength = pick(options?.minRunLength, "minRunLength", 2, DEFAULTS.minRunLength);
  const keepRunTail = pick(options?.keepRunTail, "keepRunTail", 0, DEFAULTS.keepRunTail);
  if (keepRunTail >= minRunLength) {
    throw new RangeError("compaction option keepRunTail must be smaller than minRunLength");
  }
  return {
    minRunLength,
    keepRunTail,
    keepRecent: pick(options?.keepRecent, "keepRecent", 0, DEFAULTS.keepRecent),
    largeDataBytes: pick(options?.largeDataBytes, "largeDataBytes", 1, DEFAULTS.largeDataBytes),
  };
}

/** UTF-8 byte length of the event's stored JSON payload; 0 when it has none. */
function payloadBytes(event: Event): number {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(event.data);
  } catch {
    // Cycles or a throwing toJSON: the store could not have written this either.
    return 0;
  }
  return serialized === undefined ? 0 : Buffer.byteLength(serialized, "utf8");
}

function emptyTotals(): CompactionKindTotals {
  return { candidates: 0, eventCount: 0, estimatedBytesSaved: 0 };
}

/** A run of same-typed events, tracked across page boundaries. */
interface OpenRun {
  type: EventType;
  seqFrom: number;
  /** Total events in the run so far. */
  count: number;
  /** Sum of payload bytes over the whole run. */
  totalBytes: number;
  /** Trailing events that survive: at most `keepRunTail` of them. */
  tail: { seq: number; bytes: number }[];
  tailBytes: number;
  /** Seq of the most recent event that compaction would drop. */
  lastDroppedSeq: number | undefined;
}

function pushTail(run: OpenRun, event: Event, bytes: number, keepRunTail: number): void {
  if (keepRunTail === 0) {
    run.lastDroppedSeq = event.seq;
    return;
  }
  run.tail.push({ seq: event.seq, bytes });
  run.tailBytes += bytes;
  while (run.tail.length > keepRunTail) {
    const shifted = run.tail.shift();
    if (shifted !== undefined) {
      run.tailBytes -= shifted.bytes;
      run.lastDroppedSeq = shifted.seq;
    }
  }
}

function makeRun(event: Event, bytes: number, keepRunTail: number): OpenRun {
  const run: OpenRun = {
    type: event.type,
    seqFrom: event.seq,
    count: 1,
    totalBytes: bytes,
    tail: [],
    tailBytes: 0,
    lastDroppedSeq: undefined,
  };
  pushTail(run, event, bytes, keepRunTail);
  return run;
}

function extendRun(run: OpenRun, event: Event, bytes: number, keepRunTail: number): void {
  run.count += 1;
  run.totalBytes += bytes;
  pushTail(run, event, bytes, keepRunTail);
}

function finishRun(
  run: OpenRun,
  options: ResolvedCompactionOptions,
): CompactionCandidate | undefined {
  if (run.count <= options.minRunLength) {
    return undefined;
  }
  const dropped = run.count - run.tail.length;
  const seqTo = run.lastDroppedSeq;
  if (dropped <= 0 || seqTo === undefined) {
    return undefined;
  }
  return {
    kind: "same-type-run",
    seqFrom: run.seqFrom,
    seqTo,
    eventCount: dropped,
    estimatedBytesSaved: Math.max(0, run.totalBytes - run.tailBytes),
    reason:
      `${run.count} consecutive "${run.type}" events (seq ${run.seqFrom}..${run.seqFrom + run.count - 1}); ` +
      `only the last ${run.tail.length} carry new information, the other ${dropped} are redundant`,
  };
}

export function planCompaction(
  store: EventStore,
  chain: string,
  options?: CompactionOptions,
): CompactionReport {
  const resolved = resolveOptions(options);
  const head = store.head(chain);
  const recentFloor = head > resolved.keepRecent ? head - resolved.keepRecent : 0;

  const candidates: CompactionCandidate[] = [];
  const warnings: string[] = [];

  // id -> first seq plus the extra (duplicate) copies. Bytes are tracked only
  // for the extras, so the savings number is the surplus, not the whole payload.
  const seenIds = new Map<
    string,
    { count: number; firstSeq: number; lastSeq: number; extraBytes: number }
  >();

  let pages = 0;
  let eventsRead = 0;
  let toSeq = 0;
  let complete = true;
  let fromSeq = 1;
  let run: OpenRun | undefined;

  while (fromSeq <= head) {
    const batch = store.read(chain, fromSeq, PAGE_SIZE);
    if (batch.length === 0) {
      break;
    }
    pages += 1;
    eventsRead += batch.length;

    let progressed = false;
    for (const event of batch) {
      if (event.seq < fromSeq) {
        // read() is ordered and inclusive of fromSeq; a regression would loop.
        complete = false;
        warnings.push(`read() returned seq ${event.seq} below requested fromSeq ${fromSeq}; scan stopped`);
        break;
      }
      if (event.seq <= toSeq) {
        complete = false;
        warnings.push(`read() repeated seq ${event.seq}; scan stopped`);
        break;
      }
      progressed = true;
      toSeq = event.seq;
      const bytes = payloadBytes(event);

      // (1) same-type runs, continued across page boundaries.
      if (run !== undefined && run.type === event.type) {
        extendRun(run, event, bytes, resolved.keepRunTail);
      } else {
        if (run !== undefined) {
          const finished = finishRun(run, resolved);
          if (finished !== undefined) {
            candidates.push(finished);
          }
        }
        run = makeRun(event, bytes, resolved.keepRunTail);
      }

      // (2) duplicate ids: impossible by schema, so track and report.
      const known = seenIds.get(event.id);
      if (known === undefined) {
        seenIds.set(event.id, { count: 1, firstSeq: event.seq, lastSeq: event.seq, extraBytes: 0 });
      } else {
        known.count += 1;
        known.lastSeq = event.seq;
        known.extraBytes += bytes;
        if (known.count === 2) {
          warnings.push(
            `duplicate event id ${JSON.stringify(event.id)} at seq ${known.firstSeq} and ${event.seq}; ` +
              "UNIQUE (chain, id) is violated, treat the store as corrupt",
          );
        }
      }

      // (3) large old tool payloads outside the keepRecent window.
      if (
        recentFloor > 0 &&
        event.seq <= recentFloor &&
        (event.type === "tool_call" || event.type === "tool_result") &&
        bytes >= resolved.largeDataBytes
      ) {
        const saved = Math.max(0, bytes - FOLD_STUB_BYTES);
        candidates.push({
          kind: "large-old-tool-event",
          seqFrom: event.seq,
          seqTo: event.seq,
          eventCount: 1,
          estimatedBytesSaved: saved,
          reason:
            `"${event.type}" seq ${event.seq} is outside the last ${resolved.keepRecent} events and ` +
            `carries a ${bytes}-byte payload; folding it to a stub keeps the reference and frees ~${saved} bytes`,
        });
      }
    }

    if (!complete || !progressed) {
      if (complete && !progressed) {
        complete = false;
        warnings.push(`read() made no progress past seq ${fromSeq}; scan stopped`);
      }
      break;
    }
    if (batch.length < PAGE_SIZE) {
      break;
    }
    fromSeq = toSeq + 1;
  }

  if (run !== undefined) {
    const finished = finishRun(run, resolved);
    if (finished !== undefined) {
      candidates.push(finished);
    }
  }

  // Duplicate-id candidates, one per offending id.
  const duplicateIds: string[] = [];
  for (const [id, info] of seenIds) {
    if (info.count < 2) {
      continue;
    }
    duplicateIds.push(id);
    candidates.push({
      kind: "duplicate-id",
      seqFrom: info.firstSeq,
      seqTo: info.lastSeq,
      eventCount: info.count - 1,
      estimatedBytesSaved: info.extraBytes,
      reason:
        `id ${JSON.stringify(id)} appears ${info.count} times (seq ${info.firstSeq}..${info.lastSeq}); ` +
        "the store guarantees uniqueness, so this is corruption rather than ordinary duplication",
    });
  }
  duplicateIds.sort();

  candidates.sort((a, b) =>
    a.seqFrom === b.seqFrom ? a.kind.localeCompare(b.kind) : a.seqFrom - b.seqFrom,
  );

  const byKind: Record<CompactionCandidateKind, CompactionKindTotals> = {
    "same-type-run": emptyTotals(),
    "duplicate-id": emptyTotals(),
    "large-old-tool-event": emptyTotals(),
  };
  const totals = emptyTotals();
  for (const candidate of candidates) {
    const bucket = byKind[candidate.kind];
    bucket.candidates += 1;
    bucket.eventCount += candidate.eventCount;
    bucket.estimatedBytesSaved += candidate.estimatedBytesSaved;
    totals.candidates += 1;
    totals.eventCount += candidate.eventCount;
    totals.estimatedBytesSaved += candidate.estimatedBytesSaved;
  }

  if (duplicateIds.length > 0) {
    warnings.push(
      `${duplicateIds.length} duplicated event id(s): repair the chain before compacting anything`,
    );
  }

  return {
    chain,
    scanned: { events: eventsRead, pages, fromSeq: 1, toSeq, head, recentFloor, complete },
    options: resolved,
    candidates,
    requiresRewrite: candidates.some((candidate) => candidate.kind !== "duplicate-id"),
    corruption: { duplicateIds, detected: duplicateIds.length > 0 },
    totals: { ...totals, byKind },
    warnings,
  };
}
