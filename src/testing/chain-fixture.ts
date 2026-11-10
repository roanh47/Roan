/**
 * Synthetic event chains for tests.
 *
 * `buildChain` produces a healthy chain: contiguous seqs starting at
 * `startSeq` (1 by default), one event per seq, unique ids, a single chain and
 * a single sender. The `with*` helpers return a new array that breaks exactly
 * one invariant, in the way `verifyChain` reports it:
 *
 * - `withGap` removes the event at `atSeq`, so seq `atSeq` is missing.
 * - `withDuplicate` copies the id of the event at `atSeq` onto the next event,
 *   so the id appears on seqs `atSeq` and `atSeq + 1` (`duplicate-id`).
 * - `withReordered` swaps the seqs of the events at `atSeq` and `atSeq + 1`
 *   while leaving the array order alone (`bad-order`).
 *
 * No helper mutates its input and none touches a store or the filesystem: the
 * arrays are ready for `verifyChain`. The fixture mirrors the wire `Event`
 * contract structurally, so `FixtureEvent[]` is assignable to `Event[]`.
 */

import type { Event } from "../protocol/types.js";

export type FixtureEvent = Event;

/** Chain name every fixture event carries. */
export const FIXTURE_CHAIN = "main";

/** Sender (`node` field) used when `opts.sender` is omitted. */
export const FIXTURE_SENDER = "node-a";

/** Fixed timestamp base; `ts` is `FIXTURE_TS_BASE + seq`, never `Date.now()`. */
const FIXTURE_TS_BASE = 1_700_000_000_000;

export interface ChainOptions {
  /** Value of `node` on every event. Must be a non-empty string. */
  sender?: string;
  /** First seq; must be a safe integer >= 1. Defaults to 1. */
  startSeq?: number;
}

/**
 * Build `count` healthy events with seqs `startSeq .. startSeq + count - 1`.
 *
 * A `startSeq` above 1 is legal but not contiguous from 1, so
 * `verifyChain` will report a gap at seq 1 — that is the caller's choice.
 */
export function buildChain(count: number, opts: ChainOptions = {}): FixtureEvent[] {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`buildChain: count must be a safe integer >= 0, got ${String(count)}`);
  }
  const sender = opts.sender ?? FIXTURE_SENDER;
  if (typeof sender !== "string" || sender.length === 0) {
    throw new Error(`buildChain: sender must be a non-empty string, got ${JSON.stringify(opts.sender)}`);
  }
  const startSeq = opts.startSeq ?? 1;
  if (!Number.isSafeInteger(startSeq) || startSeq < 1) {
    throw new Error(`buildChain: startSeq must be a safe integer >= 1, got ${String(opts.startSeq)}`);
  }

  const events: FixtureEvent[] = [];
  for (let index = 0; index < count; index += 1) {
    const seq = startSeq + index;
    events.push({
      v: 1,
      chain: FIXTURE_CHAIN,
      seq,
      id: `id-${seq}`,
      node: sender,
      ts: FIXTURE_TS_BASE + seq,
      type: "message",
      data: { seq },
    });
  }
  return events;
}

/** Copy of `events` (new array, new event objects). `data` is shared, not deep-copied. */
export function cheapClone(events: readonly FixtureEvent[]): FixtureEvent[] {
  return events.map((event) => ({ ...event }));
}

/** The event with seq `atSeq`, or a throw naming the helper and the seq. */
function eventAtSeq(events: readonly FixtureEvent[], atSeq: number, what: string): FixtureEvent {
  if (!Number.isSafeInteger(atSeq) || atSeq < 1) {
    throw new Error(`${what}: atSeq must be a safe integer >= 1, got ${String(atSeq)}`);
  }
  const found = events.find((event) => event.seq === atSeq);
  if (found === undefined) {
    throw new Error(`${what}: no event with seq ${atSeq} among ${events.length} events`);
  }
  return found;
}

/** New chain with the event at seq `atSeq` removed. */
export function withGap(events: readonly FixtureEvent[], atSeq: number): FixtureEvent[] {
  const missing = eventAtSeq(events, atSeq, "withGap");
  return events.filter((event) => event !== missing);
}

/** New chain where the event at seq `atSeq + 1` reuses the id of the one at `atSeq`. */
export function withDuplicate(events: readonly FixtureEvent[], atSeq: number): FixtureEvent[] {
  const donor = eventAtSeq(events, atSeq, "withDuplicate");
  const receiverSeq = atSeq + 1;
  const receiver = eventAtSeq(events, receiverSeq, "withDuplicate");
  return events.map((event) => (event === receiver ? { ...event, id: donor.id } : event));
}

/** New chain with the seqs of `atSeq` and `atSeq + 1` swapped, array order kept. */
export function withReordered(events: readonly FixtureEvent[], atSeq: number): FixtureEvent[] {
  const first = eventAtSeq(events, atSeq, "withReordered");
  const secondSeq = atSeq + 1;
  const second = eventAtSeq(events, secondSeq, "withReordered");
  return events.map((event) => {
    if (event === first) {
      return { ...event, seq: second.seq };
    }
    if (event === second) {
      return { ...event, seq: first.seq };
    }
    return event;
  });
}
