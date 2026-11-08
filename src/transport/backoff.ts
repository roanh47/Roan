/** Reconnect backoff: exponential, capped, with jitter. */
export interface BackoffOptions {
  initialDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  /** Fraction of the delay that is randomised, 0..1. */
  jitter?: number;
}

export interface Backoff {
  /** Delay before the next retry; advances the internal attempt counter. */
  next(): number;
  /** Forget the attempt count, e.g. after a successful handshake. */
  reset(): void;
  readonly attempt: number;
}

export function createBackoff(options: BackoffOptions = {}): Backoff {
  const initial = options.initialDelayMs ?? 250;
  const max = options.maxDelayMs ?? 30_000;
  const factor = options.factor ?? 2;
  const jitter = options.jitter ?? 0.2;
  if (initial <= 0 || max < initial || factor <= 1) {
    throw new Error("invalid backoff options: need 0 < initial <= max and factor > 1");
  }
  if (jitter < 0 || jitter > 1) {
    throw new Error("invalid backoff options: jitter must be between 0 and 1");
  }

  let attempt = 0;

  return {
    get attempt(): number {
      return attempt;
    },
    next(): number {
      const base = Math.min(max, initial * Math.pow(factor, attempt));
      attempt += 1;
      const spread = base * jitter;
      return Math.max(1, Math.round(base - spread / 2 + Math.random() * spread));
    },
    reset(): void {
      attempt = 0;
    },
  };
}
