/**
 * The per-turn steer inbox.
 *
 * A turn can run for minutes. While it does, the owner may want to add one
 * correction — "check the failing test first", "stop editing that file". That
 * wish waits here until the loop reaches a point where a user message is
 * allowed: after the tool results of a round, before the next model call.
 *
 * One slot, newest wins: a second thought replaces the first instead of
 * queueing behind it, because the model should see the owner's final word, not
 * a backlog read in order. `push` reports the replacement so the app can say
 * so rather than pretend both arrived.
 *
 * Pure on purpose: no clock, no I/O, no events. The runner decides where the
 * text goes; this file only holds it.
 */

/** What happened to a pushed message: whether an earlier one was displaced. */
export interface SteerPushResult {
  /** True when a message was still waiting and this one replaced it. */
  readonly replaced: boolean;
  /** The displaced text, or null when the slot was empty. */
  readonly previous: string | null;
}

export interface SteerInbox {
  /**
   * Offers one message for the next model call. Surrounding whitespace is
   * dropped; a blank offer changes nothing and is reported as not stored.
   */
  push(text: string): SteerPushResult;
  /** Removes and returns the waiting message, or null when there is none. */
  take(): string | null;
  /** Removes and returns everything waiting, oldest (and only) first. */
  drain(): string[];
}

export function createSteerInbox(): SteerInbox {
  let pending: string | null = null;

  return {
    push(text: string): SteerPushResult {
      const trimmed = text.trim();
      if (trimmed.length === 0) return { replaced: false, previous: null };
      const previous = pending;
      pending = trimmed;
      return { replaced: previous !== null, previous };
    },
    take(): string | null {
      const text = pending;
      pending = null;
      return text;
    },
    drain(): string[] {
      const text = pending;
      pending = null;
      return text === null ? [] : [text];
    },
  };
}
