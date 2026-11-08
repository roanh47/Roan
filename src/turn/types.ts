/**
 * Wire types for the session chain, restricted to what the turn lock needs.
 *
 * The chain is an append-only log of numbered events. A turn is a stretch of
 * work opened by one `turn_start` and closed by that same node's `turn_end`.
 * During a turn only its owner appends; the lock is what keeps it that way.
 */

export type Awaitable<T> = T | Promise<T>;

export interface Event {
  readonly v: 1;
  readonly chain: string;
  readonly seq: number;
  readonly id: string;
  readonly node: string;
  readonly ts: number;
  readonly type: string;
  readonly data: Readonly<Record<string, unknown>>;
}

/** What a caller hands to the store; v/seq/id/ts are assigned by the store. */
export interface TurnEventDraft {
  readonly node: string;
  readonly type: "turn_start" | "turn_end";
  readonly data: Readonly<Record<string, unknown>>;
}

/**
 * The only persistence the lock needs.
 *
 * `append` must be an atomic compare-and-append: it stores the draft at
 * `expectedSeq` and rejects with `SeqConflictError` when the chain head has
 * moved on (i.e. the next free seq is no longer `expectedSeq`). That check is
 * what makes two nodes unable to both open a turn, even though both read the
 * same tail first.
 */
export interface TurnStore {
  /** The last `limit` events of `chain`, oldest first. */
  tail(chain: string, limit: number): Awaitable<readonly Event[]>;
  append(
    chain: string,
    expectedSeq: number,
    draft: TurnEventDraft,
  ): Awaitable<Event>;
}

/** Injected logger; the lock never writes to stdout itself. */
export interface TurnLogger {
  debug?(message: string, fields?: Readonly<Record<string, unknown>>): void;
  warn?(message: string, fields?: Readonly<Record<string, unknown>>): void;
}
