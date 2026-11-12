/**
 * Coalescing for assistant text so the app can render while the model types.
 *
 * A provider hands us text in many small pieces — often one token per SSE
 * chunk. Appending an event per piece would flood the chain and the socket, so
 * this module buffers the pieces and turns them into at most one
 * `assistant_partial` event per 100 ms. The first piece after a quiet window is
 * emitted immediately (leading edge) so typing starts without the 100 ms wait;
 * everything that arrives during the window is merged into the next event.
 *
 * Every emitted event carries only the text that was not emitted before. The
 * caller appends each fragment to the transcript; it never has to diff. The
 * final fragment is emitted by `flush()`, which the caller must run when the
 * model stops — including on an error path — or the tail of the answer is lost.
 */

/**
 * The event this module produces. `assistant_partial` is deliberately declared
 * here rather than in the protocol's `EventType`: partials are a renderer hint,
 * not part of the durable chain, so the protocol stays as frozen as it was.
 */
export interface AssistantPartialEvent {
  readonly type: "assistant_partial";
  readonly data: {
    /** Text that has not been shown yet; concatenate fragments in order. */
    readonly text: string;
  };
}

/** Default coalescing window: at most one partial event per 100 ms. */
export const PARTIAL_INTERVAL_MS = 100;

/**
 * Timer seam. Production uses `setTimeout`; tests pass a fake so the coalescing
 * rule can be checked without waiting on the wall clock.
 */
export interface PartialScheduler {
  /** Run `callback` once after at least `delayMs`; returns an opaque handle. */
  readonly schedule: (callback: () => void, delayMs: number) => unknown;
  /** Cancel a handle returned by `schedule`; unknown handles are ignored. */
  readonly cancel: (handle: unknown) => void;
}

export interface AssistantStreamOptions {
  /** Called with each coalesced fragment, in order, never with empty text. */
  readonly onPartial: (event: AssistantPartialEvent) => void;
  /** Coalescing window in milliseconds; defaults to `PARTIAL_INTERVAL_MS`. */
  readonly intervalMs?: number;
  /** Clock seam; defaults to real timers. */
  readonly scheduler?: PartialScheduler;
}

export interface AssistantStream {
  /** Add one provider delta. Empty deltas are ignored. */
  push(delta: string): void;
  /**
   * Emit whatever is still buffered and stop the pending timer. Safe to call
   * more than once, and safe on an empty stream: it emits nothing then.
   */
  flush(): void;
  /** All text pushed so far, emitted or not. */
  readonly text: string;
  /** Text pushed but not yet emitted. */
  readonly pending: string;
}

const defaultScheduler: PartialScheduler = {
  schedule(callback, delayMs) {
    return setTimeout(callback, delayMs);
  },
  cancel(handle) {
    if (handle !== undefined) clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

/** Reject windows that would make "at most once per window" meaningless. */
function resolveInterval(value: number | undefined): number {
  if (value === undefined) return PARTIAL_INTERVAL_MS;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `assistant stream intervalMs must be a positive number of milliseconds, got ${String(value)}`,
    );
  }
  return value;
}

/**
 * Build a coalescing stream. One instance per assistant message: `flush()` at
 * the end of the message, not between tool calls inside the same message.
 */
export function createAssistantStream(options: AssistantStreamOptions): AssistantStream {
  const intervalMs = resolveInterval(options.intervalMs);
  const { schedule, cancel } = options.scheduler ?? defaultScheduler;

  let text = "";
  let buffer = "";
  let timer: unknown = undefined;
  let scheduled = false;

  const emit = (): void => {
    if (buffer === "") return;
    const fragment = buffer;
    buffer = "";
    options.onPartial({ type: "assistant_partial", data: { text: fragment } });
  };

  const onTimer = (): void => {
    scheduled = false;
    timer = undefined;
    emit();
    // `onPartial` may push synchronously (a consumer that echoes); start a new
    // window for whatever it added instead of dropping it.
    if (buffer !== "") arm();
  };

  const arm = (): void => {
    if (scheduled) return;
    scheduled = true;
    timer = schedule(onTimer, intervalMs);
  };

  return {
    push(delta: string): void {
      if (delta === "") return;
      text += delta;
      buffer += delta;
      if (scheduled) return;
      // Leading edge: the first fragment is shown at once, then the window
      // closes so the pieces that follow arrive together.
      emit();
      arm();
    },
    flush(): void {
      if (scheduled) {
        cancel(timer);
        scheduled = false;
        timer = undefined;
      }
      emit();
    },
    get text(): string {
      return text;
    },
    get pending(): string {
      return buffer;
    },
  };
}
