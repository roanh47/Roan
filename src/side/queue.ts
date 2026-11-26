/**
 * Messages typed while the agent is already working.
 *
 * A turn owns the chain until it ends: only one writer appends at a time. That
 * does not mean the owner has to wait before typing. What they send lands here,
 * in order, and is handed over one message at a time when the turn is done.
 *
 * The queue is deliberately inert: no timer, no I/O, no persistence. Order is
 * the array's order, so what comes out is what went in — first in, first out —
 * and every item is handed out exactly once.
 */

/** Trimmed text a queue will accept; whitespace alone is not a message. */
function asMessage(text: string): string {
  if (typeof text !== "string") {
    throw new TypeError("a queued message must be a string");
  }
  const message = text.trim();
  if (message.length === 0) {
    throw new TypeError("a queued message must have text");
  }
  return message;
}

export class MessageQueue {
  /** Oldest first; the head is what leaves next. */
  #items: string[] = [];

  /** How many messages are waiting. */
  get size(): number {
    return this.#items.length;
  }

  /** True when there is nothing to hand over. */
  get isEmpty(): boolean {
    return this.#items.length === 0;
  }

  /**
   * Add one message to the back of the queue and report the new depth.
   *
   * Empty or whitespace-only text is refused instead of queued: a blank bubble
   * would look like a message that never got an answer. Surrounding whitespace
   * is dropped, because the text that is sent is the text that was meant.
   */
  enqueue(text: string): number {
    this.#items.push(asMessage(text));
    return this.#items.length;
  }

  /** The next message without removing it, or `undefined` when empty. */
  peek(): string | undefined {
    return this.#items[0];
  }

  /**
   * Remove and return the oldest message, or `undefined` when empty. One call
   * consumes one item, so a message is handed over exactly once.
   */
  shift(): string | undefined {
    return this.#items.shift();
  }

  /**
   * Remove one message by position and return it, or `undefined` when the index
   * names nothing. This is what a queue strip's cross button calls: the owner
   * points at a row, and the queue must not lose a different message than the
   * one they saw. Out of range is a no-op, because the strip may be one render
   * behind a drain.
   */
  removeAt(index: number): string | undefined {
    if (!Number.isInteger(index) || index < 0 || index >= this.#items.length) {
      return undefined;
    }
    return this.#items.splice(index, 1)[0];
  }

  /** Drop everything: the owner no longer wants those messages sent. */
  clear(): void {
    this.#items.length = 0;
  }

  /** A copy of what is waiting, oldest first; mutating it cannot touch the queue. */
  toArray(): string[] {
    return [...this.#items];
  }
}
