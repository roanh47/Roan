/**
 * Retry policy for provider HTTP calls.
 *
 * Two things are retryable: a transport-level failure (a `TypeError` from
 * `fetch`, or a `ProviderError` whose `status` is retryable) and a response
 * that came back with a retryable status. Everything else — a 400/401/403,
 * a bad request, an abort — is handed back to the caller on the first try.
 *
 * Waiting is injectable (`sleep`) and so is the jitter source (`random`), so a
 * test can drive the whole policy without any real time passing.
 */
import { ProviderError } from "./adapter.js";

/** Tunables for `withRetry`. Every field has a working default. */
export interface RetryOptions {
  /** Total attempts including the first one. Default 4. */
  maxAttempts?: number;
  /** First backoff step in milliseconds. Default 500. */
  baseDelayMs?: number;
  /** Ceiling for any single wait, in milliseconds. Default 20000. */
  maxDelayMs?: number;
  /** Cancels the wait and the retries. */
  signal?: AbortSignal;
  /** Waits `ms`. Defaults to a real timer; tests pass a recorder. */
  sleep?: (ms: number) => Promise<void>;
  /** Jitter source in `[0, 1)`. Defaults to `Math.random`. */
  random?: () => number;
}

/** Spray added on top of the exponential step, as a fraction of it. */
const JITTER_FRACTION = 0.25;

const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 20000;

/**
 * True for 429 (rate limited) and 5xx (provider-side trouble). 400, 401, 403,
 * 404, 409 and 422 are all permanent: sending the same request again cannot
 * help, so they are never retried.
 */
export function isRetryableStatus(status: number): boolean {
  if (!Number.isFinite(status)) return false;
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * Reads a `Retry-After` header value into milliseconds from `now`.
 *
 * Accepts the delta-seconds form (`"120"`) and the HTTP-date form
 * (`"Wed, 21 Oct 2015 07:28:00 GMT"`). Returns `undefined` when the header is
 * absent, empty or unparseable; a date already in the past yields `0`.
 */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | undefined {
  if (value === null) return undefined;
  const text = value.trim();
  if (text === "") return undefined;

  // delta-seconds: a non-negative number, optionally fractional.
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const seconds = Number(text);
    if (!Number.isFinite(seconds)) return undefined;
    return Math.round(seconds * 1000);
  }

  // A signed number is not a valid delta, and `Date.parse` would happily read
  // "-3" as a year, so stop here rather than fall through to the date branch.
  if (/^[+-]?\d+(?:\.\d+)?$/.test(text)) return undefined;

  // HTTP-date. Date.parse understands every RFC 7231 form.
  const at = Date.parse(text);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, at - now);
}

/**
 * Wait before attempt `attempt + 1`, where `attempt` is the 1-based attempt
 * that just failed.
 *
 * Exponential from `baseDelayMs`, capped at `maxDelayMs`, plus jitter of up to
 * 25% of that step. A server-supplied `retryAfterMs` wins over the backoff —
 * but is still capped, so a provider cannot park the agent for an hour.
 */
export function computeDelay(
  attempt: number,
  matchRetryAfterMs: number | undefined,
  opts: RetryOptions = {},
): number {
  const maxDelayMs = normalizeDelay(opts.maxDelayMs, DEFAULT_MAX_DELAY_MS);
  const baseDelayMs = normalizeDelay(opts.baseDelayMs, DEFAULT_BASE_DELAY_MS);
  const random = opts.random ?? Math.random;

  if (matchRetryAfterMs !== undefined && Number.isFinite(matchRetryAfterMs)) {
    return clamp(matchRetryAfterMs, 0, maxDelayMs);
  }

  const step = Math.max(1, Math.floor(attempt));
  const exponent = step - 1;
  // `2 ** exponent` overflows to Infinity for large exponents; the cap absorbs it.
  const backoff = Math.min(baseDelayMs * 2 ** exponent, maxDelayMs);
  const jitter = backoff * JITTER_FRACTION * clamp(random(), 0, 1);
  return clamp(Math.round(backoff + jitter), 0, maxDelayMs);
}

/**
 * Runs `fn` until it yields a non-retryable result.
 *
 * `fn` receives the 1-based attempt number. It may resolve to a response-like
 * value (anything with a numeric `status`) or reject with a `ProviderError` or
 * a network-level `TypeError`.
 *
 * - Retryable response / retryable `ProviderError` / network `TypeError`: wait
 *   and try again while attempts remain.
 * - Attempts exhausted: the last response is returned as-is, and the last
 *   error is rethrown. Neither is swallowed or wrapped.
 * - Anything else (non-retryable status, programmer error, abort) surfaces on
 *   the first try.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const maxAttempts = normalizeAttempts(opts.maxAttempts);
  const sleep = opts.sleep ?? defaultSleep;
  const signal = opts.signal;

  let lastError: unknown;
  let lastValue: { value: T } | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfAborted(signal);

    let value: T;
    try {
      value = await fn(attempt);
    } catch (error) {
      throwIfAborted(signal);
      lastValue = undefined;

      if (!isRetryableError(error)) throw error;
      lastError = error;

      if (attempt >= maxAttempts) throw error;
      await waitBefore(attempt, retryAfterOfError(error), opts, sleep, signal);
      continue;
    }

    const status = responseStatus(value);
    if (status === undefined || !isRetryableStatus(status)) return value;

    lastValue = { value };
    lastError = undefined;

    if (attempt >= maxAttempts) return value;
    await waitBefore(attempt, parseRetryAfter(headerValue(value, "retry-after")), opts, sleep, signal);
  }

  // Unreachable with maxAttempts >= 1, but keeps the return type honest.
  if (lastValue !== undefined) return lastValue.value;
  throw lastError instanceof Error ? lastError : new Error("withRetry: no attempt was made");
}

/* ---------------------------------------------------------------- helpers */

async function waitBefore(
  attempt: number,
  retryAfterMs: number | undefined,
  opts: RetryOptions,
  sleep: (ms: number) => Promise<void>,
  signal: AbortSignal | undefined,
): Promise<void> {
  const delay = computeDelay(attempt, retryAfterMs, opts);
  await sleep(delay);
  throwIfAborted(signal);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // Do not hold the event loop open just to finish a backoff.
    if (typeof timer === "object" && timer !== null && "unref" in timer) timer.unref();
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return;
  throw abortReason(signal);
}

function abortReason(signal: AbortSignal): unknown {
  const reason: unknown = signal.reason;
  if (reason !== undefined) return reason;
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof ProviderError) {
    return error.status !== null && isRetryableStatus(error.status);
  }
  return isNetworkError(error);
}

/** A `fetch` rejection: no status, no response, the wire never carried a reply. */
function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError;
}

/**
 * Structural read of a `Response`, so the policy does not depend on the global
 * `Response` constructor existing (and so tests can pass plain objects).
 */
function responseStatus(value: unknown): number | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  if (!("status" in value)) return undefined;
  const status: unknown = (value as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function headerValue(value: unknown, name: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  if (!("headers" in value)) return null;
  const headers: unknown = (value as { headers?: unknown }).headers;
  if (typeof headers !== "object" || headers === null) return null;
  const get = (headers as { get?: unknown }).get;
  if (typeof get !== "function") return null;
  const raw: unknown = (get as (key: string) => unknown).call(headers, name);
  return typeof raw === "string" ? raw : null;
}

/** `Retry-After` carried on a thrown `ProviderError`, when the adapter set one. */
function retryAfterOfError(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const raw: unknown = (error as { retryAfterMs?: unknown }).retryAfterMs;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return max;
  return Math.min(Math.max(value, min), max);
}

function normalizeAttempts(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_MAX_ATTEMPTS;
  return Math.max(1, Math.floor(value));
}

function normalizeDelay(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) return fallback;
  return value;
}
