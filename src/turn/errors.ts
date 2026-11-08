export type TurnLockErrorCode =
  | "invalid-argument"
  | "bad-event"
  | "wrong-chain"
  | "no-open-turn"
  | "not-turn-owner"
  | "append-conflict";

/**
 * A rule of the turn lock was broken. The lock never proceeds past a
 * violation: callers either get a result or this error, never a silent write.
 */
export class TurnLockError extends Error {
  readonly code: TurnLockErrorCode;

  constructor(
    code: TurnLockErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "TurnLockError";
    this.code = code;
  }
}

/**
 * The store refused an append because another event took the next seq first.
 * Only the lock should catch this, to re-read the tail and try again.
 */
export class SeqConflictError extends Error {
  readonly expectedSeq: number;
  readonly actualSeq: number | undefined;

  constructor(expectedSeq: number, actualSeq?: number) {
    super(
      `append conflict: expected seq ${expectedSeq}, chain head is ${
        actualSeq === undefined ? "elsewhere" : String(actualSeq)
      }`,
    );
    this.name = "SeqConflictError";
    this.expectedSeq = expectedSeq;
    this.actualSeq = actualSeq;
  }
}
