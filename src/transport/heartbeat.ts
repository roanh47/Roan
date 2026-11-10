/**
 * Heartbeat policy as pure data plus two pure helpers.
 *
 * Nothing here schedules a timer, reads the clock or touches I/O: callers pass
 * `now` (a millisecond epoch) explicitly and own the timer. That keeps the
 * policy testable and lets the daemon decide when it wants to wake up.
 */

/** Bounds for `intervalMs`, inclusive. */
export const MIN_INTERVAL_MS = 1_000;
export const MAX_INTERVAL_MS = 60_000;
/** Bounds for `missThreshold`, inclusive. */
export const MIN_MISS_THRESHOLD = 2;
export const MAX_MISS_THRESHOLD = 10;

export interface HeartbeatPolicy {
  intervalMs: number;
  missThreshold: number;
}

/** Renders an unknown value for an error message without throwing itself. */
function describe(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }
  if (typeof value === "bigint") return `${String(value)}n`;
  if (typeof value === "undefined") return "undefined";
  if (typeof value === "symbol") return "symbol";
  if (typeof value === "function") return "function";
  return Array.isArray(value) ? "array" : "object";
}

/** Reads a numeric field, throwing a message that names the field and value. */
function readNumber(record: Record<string, unknown>, field: string): number {
  const value = record[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(
      `heartbeat policy ${field}: expected a finite number, got ${describe(value)}`,
    );
  }
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Validates a caller-supplied policy and clamps it into the supported range:
 * `intervalMs` to 1000..60000 and `missThreshold` to 2..10.
 *
 * A wrong type or a non-finite number throws an `Error` naming the offending
 * field and value; an out-of-range number is clamped rather than rejected.
 */
export function clampPolicy(input: unknown): HeartbeatPolicy {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error(`heartbeat policy: expected an object, got ${describe(input)}`);
  }
  const record = input as Record<string, unknown>;
  const intervalMs = readNumber(record, "intervalMs");
  const missThreshold = readNumber(record, "missThreshold");
  return {
    intervalMs: clamp(intervalMs, MIN_INTERVAL_MS, MAX_INTERVAL_MS),
    missThreshold: clamp(missThreshold, MIN_MISS_THRESHOLD, MAX_MISS_THRESHOLD),
  };
}

/**
 * True once `missThreshold` beats of `intervalMs` have gone by without a sign
 * of life. A `lastSeenAtMs` in the future (clock skew) counts as fresh, so a
 * skewed peer is never declared stale.
 */
export function isPeerStale(
  lastSeenAtMs: number,
  nowMs: number,
  policy: HeartbeatPolicy,
): boolean {
  const elapsed = nowMs - lastSeenAtMs;
  if (!Number.isFinite(elapsed) || elapsed < 0) return false;
  return elapsed >= policy.intervalMs * policy.missThreshold;
}

/** Absolute time of the next beat; the caller turns it into a timer. */
export function nextBeatAt(nowMs: number, policy: HeartbeatPolicy): number {
  return nowMs + policy.intervalMs;
}
