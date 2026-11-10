/**
 * A hand-wound clock for tests that need to observe time passing.
 *
 * Real time is a poor input for a unit test: `Date.now()` cannot be aimed and
 * a test that sleeps is slow and flaky. This clock holds a single epoch-ms
 * value that only moves when a test says so, which makes expiry, backoff and
 * timestamp behaviour deterministic.
 *
 * There are no timers behind it — nothing schedules itself, so a clock nobody
 * advances simply stands still. `Date.now()` is never consulted after the
 * seed, so a test cannot pick up the wall clock by accident.
 */

/** A clock whose reading only changes through `advance` and `set`. */
export interface FakeClock {
  /** Current time as epoch milliseconds. */
  now(): number;
  /** Current time as an ISO-8601 string, e.g. `2026-01-01T00:00:00.000Z`. */
  nowIso(): string;
  /**
   * Moves the clock forward by `ms` milliseconds.
   *
   * Negative and non-finite amounts are rejected rather than tolerated: a
   * test that walks backwards is almost always a sign of a mixed-up argument
   * order, and silently rewinding would hide it.
   */
  advance(ms: number): void;
  /**
   * Jumps to the absolute time `iso`.
   *
   * Only forward jumps are allowed, for the same reason `advance` refuses
   * negative amounts — time in these tests must move in one direction.
   */
  set(iso: string): void;
}

/** Parses an ISO-8601 string, rejecting anything that does not name a moment. */
function parseIso(iso: string, caller: string): number {
  if (typeof iso !== "string") {
    throw new Error(`${caller}: expected an ISO-8601 string, got ${typeof iso}`);
  }
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {
    throw new Error(`${caller}: ${JSON.stringify(iso)} is not a valid ISO-8601 time`);
  }
  return ms;
}

/**
 * Creates a clock seeded at `startIso`.
 *
 * The seed goes through `Date.parse`, so any format that names an instant
 * works (`2026-01-01`, `2026-01-01T12:00:00+02:00`); `nowIso` always reports
 * the UTC form.
 */
export function createFakeClock(startIso: string): FakeClock {
  let currentMs = parseIso(startIso, "createFakeClock");

  const isoNow = (): string => new Date(currentMs).toISOString();

  return {
    now(): number {
      return currentMs;
    },

    nowIso(): string {
      return isoNow();
    },

    advance(ms: number): void {
      if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
        throw new Error(
          `advance: ms must be a non-negative finite number, got ${String(ms)}`,
        );
      }
      const next = currentMs + ms;
      if (!Number.isFinite(next) || Math.abs(next) > 8.64e15) {
        // Date's representable range ends at ±8.64e15 ms; going past it would
        // make `nowIso` throw from deep inside Date instead of here.
        throw new Error(
          `advance: ${String(ms)} ms from ${isoNow()} leaves the representable date range`,
        );
      }
      currentMs = next;
    },

    set(iso: string): void {
      const requestedMs = parseIso(iso, "set");
      if (requestedMs < currentMs) {
        throw new Error(
          `set: cannot move the clock backwards from ${isoNow()} to ${iso}`,
        );
      }
      currentMs = requestedMs;
    },
  };
}
