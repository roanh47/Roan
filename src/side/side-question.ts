/**
 * Side questions: a question about the conversation that is not part of it.
 *
 * A `/btw` question is answered beside the session, never inside it. The answer
 * must not reach the model on the next turn, must not count as a message in the
 * conversation, and must not start a second conversation that pollutes the
 * first. The chain has no hidden channel for that, so a side question gets what
 * any conversation gets: its own session id, an event of its own, and a marker
 * saying which message it was asked about.
 *
 * That marker (`sideOf`) is the whole trick. The message lives in the side
 * session — so the existing session fold, which selects by `session`, can never
 * return it for the parent — and it names the parent message it quotes, so the
 * UI can show the answer as a quote rather than as a turn in the transcript.
 *
 * Ids are derived, not generated: `side:<active>:<n>`. No clock, no random, no
 * store. The same question asked twice on the same session lands in the same
 * place, which is what makes the behaviour testable and the history readable.
 */

/** Marks every side session. The parent id follows, then the attempt number. */
export const SIDE_SESSION_PREFIX = "side:";

/** The question, and the conversation it was asked in. */
export interface SideQuestion {
  readonly text: string;
  readonly session: string;
}

/**
 * What a side message appends to the chain.
 *
 * `session` is the side session, never the parent's. `sideOf` names the parent
 * conversation and the message seq being asked about, so a fold can show the
 * answer as a quote and the parent fold can stay untouched.
 */
export interface SideMessagePayload {
  readonly text: string;
  readonly session: string;
  readonly sideOf: {
    readonly session: string;
    readonly seq: number;
  };
}

function nonEmpty(value: unknown, what: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${what} must be a non-empty string`);
  }
  return value.trim();
}

/**
 * The side session for one question asked in `activeSession`.
 *
 * `index` counts questions within that session and defaults to the first. It
 * must be a positive integer: the id is `side:<active>:<index>`, so the same
 * pair always produces the same id, and no side session can ever equal the
 * session it was asked in.
 */
export function sideSession(activeSession: string, index = 1): string {
  const parent = nonEmpty(activeSession, "the active session");
  if (isSideSession(parent)) {
    throw new RangeError("a side question cannot be asked from a side session");
  }
  if (!Number.isInteger(index) || index < 1) {
    throw new RangeError("the side question number must be a positive integer");
  }
  return `${SIDE_SESSION_PREFIX}${parent}:${String(index)}`;
}

/** True for ids produced by `sideSession`, false for a conversation. */
export function isSideSession(id: string): boolean {
  if (typeof id !== "string" || !id.startsWith(SIDE_SESSION_PREFIX)) return false;
  const rest = id.slice(SIDE_SESSION_PREFIX.length);
  const split = rest.lastIndexOf(":");
  if (split <= 0) return false;
  const parent = rest.slice(0, split);
  const index = rest.slice(split + 1);
  return parent.length > 0 && /^[1-9]\d*$/.test(index);
}

/**
 * The event data for a side question, ready to append to the side session.
 *
 * The parent is carried twice on purpose: `session` keeps the event out of the
 * parent's fold, and `sideOf` says which parent message the answer belongs to.
 * `parentEventSeq` is the seq of the message being asked about, so 0 means the
 * conversation had no message yet.
 */
export function sideMessage(question: SideQuestion, parentEventSeq: number): SideMessagePayload {
  const text = nonEmpty(question.text, "the side question");
  const parent = nonEmpty(question.session, "the parent session");
  if (isSideSession(parent)) {
    throw new RangeError("a side question cannot quote a side session");
  }
  if (!Number.isInteger(parentEventSeq) || parentEventSeq < 0) {
    throw new RangeError("the quoted event seq must be a non-negative integer");
  }
  return Object.freeze({
    text,
    session: sideSession(parent),
    sideOf: Object.freeze({ session: parent, seq: parentEventSeq }),
  });
}
