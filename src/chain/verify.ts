/**
 * Read-only verification of a chain.
 *
 * The core entry point, `verifyChain`, takes the events themselves: it needs no
 * database, so every failure mode can be tested with a hand-written array.
 * `verifyStore` is a thin wrapper that pages an `EventStore` and adds the one
 * check that needs the store: the declared head must match the chain we read.
 *
 * Nothing in here throws on a malformed chain. Every defect becomes a
 * `ChainProblem`; the report is the answer, not an exception. The store is
 * trusted as a mechanism (a closed store still throws its own `StoreError`),
 * but never as a source of truth about the chain's contents.
 */

import type { Event, EventStore } from "./store.js";

/**
 * One defect in a chain.
 *
 * The union is discriminated on `code`, so a caller that switches on `code`
 * gets the matching payload without casts. `seq` is the event's sequence
 * number where one exists; problems raised before a seq can be read carry
 * `seq: 0`, and the `reason` names the array position instead.
 */
export type ChainProblem =
  /**
   * A sequence number in the `1..head` range is missing. One problem per hole;
   * `seq` is the first missing seq, equal to `expectedSeq`.
   */
  | { code: "gap"; seq: number; expectedSeq: number; foundSeq: number }
  /** Two events in the chain carry the same event id. `seq` is the second one. */
  | { code: "duplicate-id"; seq: number; id: string; firstSeq: number; secondSeq: number }
  /** Two or more events share one sequence number. */
  | { code: "duplicate-seq"; seq: number; ids: string[] }
  /** Sequence numbers are not strictly increasing in the order given. */
  | { code: "bad-order"; seq: number; previousSeq: number }
  /** The event belongs to a different chain than the rest. */
  | { code: "wrong-chain"; seq: number; chain: string }
  /**
   * A required field is missing or has the wrong type/range. `seq` is 0 when
   * the event carries no usable seq; the `reason` names the array position.
   */
  | { code: "bad-shape"; seq: number; reason: string }
  /**
   * `verifyStore` only: the store's `head()` disagrees with the highest seq it
   * actually returned, so events are missing from (or invented by) the read.
   * `seq` is the first sequence number whose presence could not be confirmed.
   */
  | { code: "head-mismatch"; seq: number; declaredHead: number; countedHead: number };

/** The verdict for one chain. `ok` is true only when `problems` is empty. */
export interface ChainReport {
  ok: boolean;
  /** Chain name; empty for an empty list with no chain to infer one from. */
  chain: string;
  /** Number of events inspected. */
  count: number;
  /** Highest seq seen, or 0 when there are no events. */
  head: number;
  problems: ChainProblem[];
}

/** `EventStore.read` caps a page at 10000; ask for exactly that. */
const STORE_PAGE = 10_000;

/**
 * Defensive bound on paging. `read` advances by at least one seq per page, so a
 * healthy store describes at most one page per 10000 events; this stops a
 * store that keeps returning full pages without advancing `seq`.
 */
const MAX_PAGES = 10_000;

/** Sentinel for "this event has no usable seq". */
const NO_SEQ = 0;

/** Placeholder used in `duplicate-seq.ids` when an event has no readable id. */
const MISSING_ID = "";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function safeIntegerAtLeast(value: unknown, min: number): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min
    ? value
    : undefined;
}

/** What the structural checks need from one event, after the shape pass. */
interface Entry {
  readonly index: number;
  readonly seq: number | undefined;
  readonly id: string | undefined;
  readonly chain: string | undefined;
}

/**
 * Inspect one ordered list of events.
 *
 * `expectedChain` is the chain the caller asked about; when omitted, the first
 * event that carries a usable chain name sets the expectation (the spec's
 * "every event's chain equals the first event's chain").
 *
 * Checks run in a fixed order so the report is deterministic: shape, chain,
 * order, duplicate seq, duplicate id, gaps.
 */
function inspect(events: readonly unknown[], expectedChain: string | undefined): ChainReport {
  const problems: ChainProblem[] = [];
  const entries: Entry[] = [];
  const usable: { seq: number; id: string | undefined }[] = [];
  let chainLabel = expectedChain;

  for (let index = 0; index < events.length; index += 1) {
    const record = asRecord(events[index]);
    if (record === undefined) {
      problems.push({ code: "bad-shape", seq: NO_SEQ, reason: `events[${index}] is not an object` });
      continue;
    }

    const seq = safeIntegerAtLeast(record["seq"], 1);
    const id = nonEmptyString(record["id"]);
    const node = nonEmptyString(record["node"]);
    const chain = nonEmptyString(record["chain"]);
    const type = nonEmptyString(record["type"]);
    const ts = safeIntegerAtLeast(record["ts"], 0);

    if (chainLabel === undefined && chain !== undefined) {
      chainLabel = chain;
    }

    // seq is reported when it is usable, otherwise the sentinel.
    const at = seq ?? NO_SEQ;
    if (record["v"] !== 1) {
      problems.push({ code: "bad-shape", seq: at, reason: `events[${index}].v must be 1` });
    }
    if (seq === undefined) {
      problems.push({
        code: "bad-shape",
        seq: NO_SEQ,
        reason: `events[${index}].seq must be a safe integer >= 1`,
      });
    }
    if (id === undefined) {
      problems.push({
        code: "bad-shape",
        seq: at,
        reason: `events[${index}].id must be a non-empty string`,
      });
    }
    if (node === undefined) {
      problems.push({
        code: "bad-shape",
        seq: at,
        reason: `events[${index}].node must be a non-empty string`,
      });
    }
    if (chain === undefined) {
      problems.push({
        code: "bad-shape",
        seq: at,
        reason: `events[${index}].chain must be a non-empty string`,
      });
    }
    if (type === undefined) {
      problems.push({
        code: "bad-shape",
        seq: at,
        reason: `events[${index}].type must be a non-empty string`,
      });
    }
    if (ts === undefined) {
      problems.push({
        code: "bad-shape",
        seq: at,
        reason: `events[${index}].ts must be a safe integer >= 0`,
      });
    }

    entries.push({ index, seq, id, chain });
    if (seq !== undefined) {
      usable.push({ seq, id });
    }
  }

  // Every event must belong to one chain. Entries whose chain is unreadable are
  // already reported as bad-shape, so they are skipped here.
  if (chainLabel !== undefined) {
    const label: string = chainLabel;
    for (const entry of entries) {
      if (entry.chain !== undefined && entry.chain !== label) {
        problems.push({
          code: "wrong-chain",
          seq: entry.seq ?? NO_SEQ,
          chain: entry.chain,
        });
      }
    }
  }

  // Strictly increasing seqs in the order given. Equal seqs are duplicate-seq,
  // reported below; a decrease is an ordering defect.
  let previousSeq: number | undefined;
  for (const entry of usable) {
    if (previousSeq !== undefined && entry.seq < previousSeq) {
      problems.push({ code: "bad-order", seq: entry.seq, previousSeq });
    }
    previousSeq = entry.seq;
  }

  // Group by seq: any group larger than one is a collision, reported once with
  // every id that claims the seq.
  const idsBySeq = new Map<number, string[]>();
  for (const entry of usable) {
    const ids = idsBySeq.get(entry.seq);
    if (ids === undefined) {
      idsBySeq.set(entry.seq, [entry.id ?? MISSING_ID]);
    } else {
      ids.push(entry.id ?? MISSING_ID);
    }
  }
  for (const [seq, ids] of idsBySeq) {
    if (ids.length > 1) {
      problems.push({ code: "duplicate-seq", seq, ids: [...ids] });
    }
  }

  // Duplicate ids: one problem per reused id, pointing at its first two seqs.
  const seqsById = new Map<string, number[]>();
  for (const entry of usable) {
    if (entry.id === undefined) {
      continue;
    }
    const seqs = seqsById.get(entry.id);
    if (seqs === undefined) {
      seqsById.set(entry.id, [entry.seq]);
    } else {
      seqs.push(entry.seq);
    }
  }
  for (const [id, seqs] of seqsById) {
    const firstSeq = seqs[0];
    const secondSeq = seqs[1];
    if (firstSeq !== undefined && secondSeq !== undefined) {
      problems.push({ code: "duplicate-id", seq: secondSeq, id, firstSeq, secondSeq });
    }
  }

  // Contiguity from 1: one problem per hole, using the lowest missing seq and
  // the next seq that does exist.
  const sortedSeqs = [...idsBySeq.keys()].sort((a, b) => a - b);
  let expectedSeq = 1;
  for (const seq of sortedSeqs) {
    if (seq !== expectedSeq) {
      problems.push({ code: "gap", seq: expectedSeq, expectedSeq, foundSeq: seq });
    }
    expectedSeq = seq + 1;
  }

  const lastSeq = sortedSeqs[sortedSeqs.length - 1];
  return {
    ok: problems.length === 0,
    chain: chainLabel ?? "",
    count: events.length,
    head: lastSeq ?? 0,
    problems,
  };
}

/**
 * Verify one ordered list of events.
 *
 * Healthy means: seqs start at 1 and are contiguous, strictly increasing in the
 * given order, unique per seq and per id, every event on the same chain, and
 * every event well-shaped (`v === 1`, non-empty `id`/`node`, `ts` a safe
 * non-negative integer).
 *
 * An empty list is healthy: an empty chain has head 0.
 */
export function verifyChain(events: readonly Event[]): ChainReport {
  return inspect(events, undefined);
}

/**
 * Verify every event in `store`'s chain, then check the store's own `head()`.
 *
 * Pages with `store.read(chain, from, 10000)` until a short page arrives, so
 * the whole chain is inspected even past the per-call cap. A store whose
 * declared head is not the highest seq it returns gets a `head-mismatch`
 * problem: the read is missing events, and the rest of the report would
 * otherwise look healthy.
 *
 * Throws only what the store itself throws (for example a closed store); a
 * broken chain is reported, never thrown.
 */
export function verifyStore(store: EventStore, chain: string): ChainReport {
  const declaredHead = store.head(chain);
  const events: Event[] = [];

  let from = 1;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const batch = store.read(chain, from, STORE_PAGE);
    events.push(...batch);
    if (batch.length < STORE_PAGE) {
      break;
    }
    const last = batch[batch.length - 1];
    const next = last === undefined ? from : last.seq + 1;
    if (!Number.isSafeInteger(next) || next <= from) {
      // A page that does not advance would loop forever; stop and let the
      // head comparison below speak.
      break;
    }
    from = next;
  }

  const report = inspect(events, chain);
  if (declaredHead !== report.head) {
    report.problems.push({
      code: "head-mismatch",
      seq: Math.min(declaredHead, report.head) + 1,
      declaredHead,
      countedHead: report.head,
    });
    report.ok = false;
  }
  return report;
}
