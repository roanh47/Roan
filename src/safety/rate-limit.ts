/**
 * Per-tool token bucket as pure data plus one stateful closure.
 *
 * Nothing here schedules a timer or reads the clock: every `take` receives
 * `nowMs` from the caller, who owns the clock. Buckets are created lazily per
 * tool name and start full, so a quiet tool never spends its budget before it
 * is first used.
 *
 * Credits are kept in "millitokens" (1 token = 60_000 units) because the refill
 * rate is exactly `perMinute` units per millisecond. With an integer
 * `perMinute` that makes the arithmetic exact: 60_000 ms at 1/min is precisely
 * one token, with no floating-point epsilon needed.
 */

/** Inclusive bounds for `perMinute`. */
export const MIN_PER_MINUTE = 1;
export const MAX_PER_MINUTE = 6_000;
/** Inclusive bounds for `burst`. */
export const MIN_BURST = 1;
export const MAX_BURST = 1_000;

/** Units per token; refill adds `perMinute` units per elapsed millisecond. */
const UNITS_PER_TOKEN = 60_000;

export interface RateLimitConfig {
  perMinute: number;
  burst: number;
}

export interface TakeResult {
  /** True when a token was taken and the call may proceed. */
  ok: boolean;
  /** 0 when `ok`, otherwise the whole milliseconds until one token exists. */
  waitMs: number;
  /** Whole tokens left in this tool's bucket after the call. */
  remaining: number;
}

export interface Limiter {
  /** Configured values, already clamped into the supported range. */
  readonly perMinute: number;
  readonly burst: number;
  /** Takes one token for `tool` at `nowMs`, or reports how long to wait. */
  take(tool: string, nowMs: number): TakeResult;
  /** Dutch policy lines for this limiter; same output as `describeLimiter`. */
  describeLimiter(): string[];
}

interface Bucket {
  /** Tokens left, scaled by `UNITS_PER_TOKEN`. */
  credits: number;
  /** Time the credits were last brought up to date. */
  updatedAtMs: number;
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

/**
 * Reads a numeric config field. A wrong type, a non-finite number or a
 * negative number throws an `Error` naming the field and its value; values
 * above `max` are clamped by the caller.
 */
function readAmount(record: Record<string, unknown>, field: string): number {
  const value = record[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(
      `rate limit config ${field}: expected a finite number, got ${describe(value)}`,
    );
  }
  if (value < 0) {
    throw new Error(`rate limit config ${field}: must not be negative, got ${String(value)}`);
  }
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Validates a caller-supplied config and clamps it into range: `perMinute` to
 * 1..6000 and `burst` to 1..1000.
 *
 * A wrong type, a non-finite number or a negative number throws with the bad
 * field named; an out-of-range number is clamped rather than rejected.
 */
export function clampRateLimitConfig(input: unknown): RateLimitConfig {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error(`rate limit config: expected an object, got ${describe(input)}`);
  }
  const record = input as Record<string, unknown>;
  const perMinute = readAmount(record, "perMinute");
  const burst = readAmount(record, "burst");
  return {
    perMinute: clamp(perMinute, MIN_PER_MINUTE, MAX_PER_MINUTE),
    burst: clamp(burst, MIN_BURST, MAX_BURST),
  };
}

function readTool(tool: unknown): string {
  if (typeof tool !== "string" || tool.length === 0) {
    throw new Error(`rate limit tool: expected a non-empty string, got ${describe(tool)}`);
  }
  return tool;
}

function readNow(nowMs: unknown): number {
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) {
    throw new Error(`rate limit nowMs: expected a finite number, got ${describe(nowMs)}`);
  }
  return nowMs;
}

function formatMs(value: number): string {
  return String(Math.round(value * 1_000) / 1_000);
}

/** Short Dutch policy lines for a limiter. */
export function describeLimiter(limiter: Limiter): string[] {
  return [
    `Limiet: ${String(limiter.perMinute)} tokens per minuut, burst van ${String(limiter.burst)}.`,
    `Herstel: één token per ${formatMs(UNITS_PER_TOKEN / limiter.perMinute)} ms.`,
    "Buckets: één per tool, lui aangemaakt en direct vol.",
    "Klok: de tijd wordt altijd meegegeven; deze limiter zet zelf geen timers.",
  ];
}

/**
 * Builds a limiter with one lazily created bucket per tool name.
 *
 * The config is validated and clamped once, up front. `take` never mutates
 * anything outside this limiter and never consults the real clock.
 */
export function createLimiter(config: unknown): Limiter {
  const { perMinute, burst } = clampRateLimitConfig(config);
  const capacity = burst * UNITS_PER_TOKEN;
  const buckets = new Map<string, Bucket>();

  function bucketFor(tool: string, nowMs: number): Bucket {
    const existing = buckets.get(tool);
    if (existing !== undefined) return existing;
    const fresh: Bucket = { credits: capacity, updatedAtMs: nowMs };
    buckets.set(tool, fresh);
    return fresh;
  }

  const limiter: Limiter = {
    perMinute,
    burst,
    take(tool: string, nowMs: number): TakeResult {
      const name = readTool(tool);
      const at = readNow(nowMs);
      const bucket = bucketFor(name, at);

      const elapsed = at - bucket.updatedAtMs;
      if (elapsed > 0) {
        // Refill is proportional to elapsed time, capped at a full bucket.
        bucket.credits = Math.min(capacity, bucket.credits + elapsed * perMinute);
        bucket.updatedAtMs = at;
      }

      if (bucket.credits >= UNITS_PER_TOKEN) {
        bucket.credits -= UNITS_PER_TOKEN;
        return { ok: true, waitMs: 0, remaining: Math.floor(bucket.credits / UNITS_PER_TOKEN) };
      }

      const missingCredits = UNITS_PER_TOKEN - bucket.credits;
      return { ok: false, waitMs: Math.ceil(missingCredits / perMinute), remaining: 0 };
    },
    describeLimiter(): string[] {
      return describeLimiter(limiter);
    },
  };

  return limiter;
}
