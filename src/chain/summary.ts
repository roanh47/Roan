/**
 * One-glance statistics for a chain.
 *
 * `summarize` is pure: it takes the events themselves and touches nothing else.
 * There is no store, no file system and no clock in here, so a caller can run
 * it over `store.since(1)` — or over a hand-written array in a test — and get
 * the same answer.
 *
 * Every number is order-insensitive: `firstSeq` is the lowest seq present and
 * `lastSeq` the highest, so a list that arrives shuffled still summarises the
 * same. `contiguous` is the one structural claim: the seqs are exactly `1..n`,
 * each appearing once, gaps and repeats alike disqualifying the chain.
 *
 * Payload size is the UTF-8 length of `JSON.stringify(event.data)`, matching
 * what compaction (`gc.ts`) assumes a payload costs on disk. An event whose
 * payload cannot be serialised (a cycle, a throwing `toJSON`) counts as zero
 * bytes rather than throwing: summarising a chain must never fail on bad data.
 */

import type { Event } from "../sync/types.js";

/** The biggest payload in the chain, by serialised size. */
export interface LargestPayload {
  /** Seq of the event carrying it; the lowest seq on a tie, so the answer is stable. */
  seq: number;
  /** UTF-8 byte length of `JSON.stringify(event.data)`. */
  bytes: number;
}

/** Aggregate view of one chain's events. */
export interface ChainSummary {
  /** Number of events inspected. */
  count: number;
  /** Lowest seq present, or 0 for an empty input. */
  firstSeq: number;
  /** Highest seq present, or 0 for an empty input. */
  lastSeq: number;
  /** Events per type, with the keys inserted in sorted order. */
  perType: Record<string, number>;
  /** Biggest payload, or `null` when there are no events. */
  largest: LargestPayload | null;
  /**
   * True when the seqs are exactly `1..count`: no gaps, no repeats, regardless
   * of the order the events arrived in. An empty chain counts as contiguous.
   */
  contiguous: boolean;
}

/**
 * UTF-8 byte length of the event's stored JSON payload; 0 when it has none.
 *
 * Mirrors `payloadBytes` in `gc.ts`, including the cycle guard: a payload the
 * store could never have written is reported as empty instead of throwing.
 */
function payloadBytes(event: Event): number {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(event.data);
  } catch {
    return 0;
  }
  return serialized === undefined ? 0 : Buffer.byteLength(serialized, "utf8");
}

/**
 * Summarise `events` without touching anything outside the argument.
 *
 * An empty list yields zeroes everywhere, an empty `perType` and
 * `largest: null`. Otherwise `firstSeq`/`lastSeq` are the lowest/highest seq
 * seen, `perType` has one entry per distinct type name (keys sorted) and
 * `largest` names the event with the biggest serialised payload.
 */
export function summarize(events: readonly Event[]): ChainSummary {
  const perTypeCounts = new Map<string, number>();
  const seenSeqs = new Set<number>();

  let hasAny = false;
  let firstSeq = 0;
  let lastSeq = 0;
  let largest: LargestPayload | null = null;

  for (const event of events) {
    perTypeCounts.set(event.type, (perTypeCounts.get(event.type) ?? 0) + 1);
    seenSeqs.add(event.seq);

    if (!hasAny) {
      hasAny = true;
      firstSeq = event.seq;
      lastSeq = event.seq;
    } else {
      if (event.seq < firstSeq) firstSeq = event.seq;
      if (event.seq > lastSeq) lastSeq = event.seq;
    }

    const bytes = payloadBytes(event);
    if (
      largest === null ||
      bytes > largest.bytes ||
      (bytes === largest.bytes && event.seq < largest.seq)
    ) {
      largest = { seq: event.seq, bytes };
    }
  }

  const perType: Record<string, number> = {};
  for (const type of [...perTypeCounts.keys()].sort()) {
    perType[type] = perTypeCounts.get(type) ?? 0;
  }

  // `seenSeqs.size === events.length` means no seq appeared twice; together
  // with min 1 and max `length` that is exactly `1..n`. An empty chain has no
  // holes to report, so it is contiguous by definition.
  const contiguous =
    events.length === 0
      ? true
      : firstSeq === 1 && lastSeq === events.length && seenSeqs.size === events.length;

  return { count: events.length, firstSeq, lastSeq, perType, largest, contiguous };
}

/**
 * A few short Dutch lines for a status panel or a log line rendered by a human.
 *
 * Returned as separate lines rather than one string so the caller decides the
 * separator; nothing here is long enough to wrap.
 */
export function formatSummary(summary: ChainSummary): string[] {
  if (summary.count === 0) {
    return ["Lege keten: geen events."];
  }

  const types = Object.entries(summary.perType)
    .map(([type, count]) => `${type} ${count}`)
    .join(", ");
  const largest =
    summary.largest === null
      ? "Grootste payload: geen"
      : `Grootste payload: seq ${summary.largest.seq}, ${summary.largest.bytes} bytes`;

  return [
    `Events: ${summary.count}, seq ${summary.firstSeq}..${summary.lastSeq}`,
    `Per type: ${types}`,
    largest,
    summary.contiguous
      ? "Seq is aaneengesloten van 1 tot en met de laatste."
      : "Seq is niet aaneengesloten: er is een gat of een dubbele seq.",
  ];
}
