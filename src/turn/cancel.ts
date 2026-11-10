/**
 * Cancellation signal shared by a turn and everything it started.
 *
 * The token is deliberately inert: it holds no timer, no clock and no I/O. A
 * caller cancels it and interested parties observe that, either by awaiting the
 * fate of work or by registering a listener. That keeps cancellation
 * deterministic and testable without fake timers.
 */

/** Listener invoked once, with the reason of the first cancellation. */
export type CancelListener = (reason: string) => void;

export class CancelToken {
  /** Set by the first `cancel`; later calls leave it untouched. */
  #reason: string | undefined;

  /** Listeners that have not fired yet. */
  #listeners = new Set<CancelListener>();

  /** True once a cancellation reason has been recorded. */
  get isCancelled(): boolean {
    return this.#reason !== undefined;
  }

  /** The first recorded reason, or `undefined` while the token is live. */
  get reason(): string | undefined {
    return this.#reason;
  }

  /**
   * Cancel the token. Idempotent: the first reason wins, a second call neither
   * overwrites it nor throws, so a late cancellation from a second code path is
   * harmless.
   *
   * Every listener registered so far is called once, in registration order,
   * and then dropped. A listener that throws does not stop the others; the
   * first failure is rethrown afterwards as an `AggregateError`. The reason is
   * recorded before any listener runs, so a listener that inspects the token
   * already sees `isCancelled === true`.
   */
  cancel(reason: string): void {
    assertReason(reason);
    if (this.#reason !== undefined) return;

    this.#reason = reason;
    const pending = [...this.#listeners];
    this.#listeners.clear();
    dispatch(pending, reason);
  }

  /**
   * Throw when cancelled. The message carries the recorded reason verbatim, so
   * a failure report says why the work stopped.
   */
  throwIfCancelled(): void {
    const reason = this.#reason;
    if (reason !== undefined) {
      throw new Error(`operation cancelled: ${reason}`);
    }
  }

  /**
   * Register a listener and get an unsubscribe function back.
   *
   * A listener registered after cancellation is not stored but called
   * immediately with the reason, and the returned unsubscribe is a no-op. That
   * way callers never have to check `isCancelled` before subscribing, and a
   * cancellation cannot slip through the gap between the check and the
   * subscription.
   */
  onCancel(listener: CancelListener): () => void {
    assertListener(listener);

    const reason = this.#reason;
    if (reason !== undefined) {
      listener(reason);
      return () => {
        // Already fired; nothing left to unsubscribe.
      };
    }

    // Wrapped so the same function can be registered twice and each
    // unsubscribe removes exactly its own registration.
    const entry: CancelListener = (why) => listener(why);
    this.#listeners.add(entry);
    return () => {
      this.#listeners.delete(entry);
    };
  }
}

function assertReason(reason: string): void {
  if (typeof reason !== "string" || reason.trim() === "") {
    throw new Error(
      `cancel reason must be a non-empty string, got ${JSON.stringify(reason)}`,
    );
  }
}

function assertListener(listener: CancelListener): void {
  if (typeof listener !== "function") {
    throw new Error(
      `onCancel listener must be a function, got ${typeof listener}`,
    );
  }
}

function dispatch(listeners: readonly CancelListener[], reason: string): void {
  const errors: unknown[] = [];
  for (const listener of listeners) {
    try {
      listener(reason);
    } catch (error) {
      errors.push(error);
    }
  }
  const first = errors[0];
  if (first !== undefined) {
    throw new AggregateError(
      errors,
      `cancel listener failed: ${describe(first)}`,
    );
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
