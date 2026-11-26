/**
 * HMAC-SHA256 signing for webhooks in both directions.
 *
 * One canonical string is signed: `<timestamp>.<raw body>`. The timestamp is
 * part of the signed material, not a suggestion next to it, so a captured
 * request cannot be re-dated to slip past the freshness window. Verification
 * checks freshness first and the digest second, compares with
 * `timingSafeEqual`, and reports one reason per failure so the caller can tell
 * a broken sender (bad header) from an attacker (bad digest) from a slow
 * network (stale timestamp).
 *
 * Replay protection has two layers: the timestamp window rejects anything
 * older than the tolerance, and an optional `ReplayGuard` remembers digests
 * that were already accepted inside that window. A replayed request carries a
 * signature that is still fresh, so only the second layer catches it.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** Canonical header. Format: `t=<unix seconds>,v1=<hex digest>`. */
export const SIGNATURE_HEADER = "x-roan-signature";
/** Optional separate timestamp header, used when the canonical one omits `t=`. */
export const TIMESTAMP_HEADER = "x-roan-timestamp";

/** Default freshness window in seconds. */
export const DEFAULT_TOLERANCE_SEC = 300;

/** Header bag as Node hands it to a request handler. */
export type HeaderBag = Record<string, string | readonly string[] | undefined>;

/** Anything with a case-insensitive `get`, such as a `Headers` instance. */
interface HeaderGetter {
  get(name: string): string | null;
}

/** Why a signature did not verify. */
export type SignatureFailure =
  | "missing_signature"
  | "malformed_signature"
  | "missing_timestamp"
  | "malformed_timestamp"
  | "stale_timestamp"
  | "future_timestamp"
  | "invalid_signature"
  | "replay";

export type VerifyResult =
  | { ok: true; timestampSec: number; digest: string }
  | { ok: false; reason: SignatureFailure };

/** Remembers accepted digests for as long as their timestamp window allows. */
export interface ReplayGuard {
  /**
   * Records `key` and returns true when it was not seen before; returns false
   * for a key that is already stored and still inside its window.
   */
  accept(key: string, nowSec: number, expiresAtSec: number): boolean;
}

/** Bounded in-memory replay guard; expired entries are dropped as it goes. */
export function createReplayGuard(maxEntries = 4_096): ReplayGuard {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new Error(`createReplayGuard: maxEntries must be a positive integer, got ${maxEntries}`);
  }
  const seen = new Map<string, number>();

  function prune(nowSec: number): void {
    for (const [key, expiresAtSec] of seen) {
      if (expiresAtSec <= nowSec) {
        seen.delete(key);
      }
    }
  }

  return {
    accept(key: string, nowSec: number, expiresAtSec: number): boolean {
      prune(nowSec);
      if (seen.has(key)) return false;
      // Insertion order is age order when nothing is refreshed, so the first
      // key is the oldest and the cheapest one to drop.
      while (seen.size >= maxEntries) {
        const oldest = seen.keys().next();
        if (oldest.done === true) break;
        seen.delete(oldest.value);
      }
      seen.set(key, expiresAtSec);
      return true;
    },
  };
}

/** Reads one header whether the bag is plain or a `Headers`-like object. */
export function readHeader(
  headers: HeaderBag | HeaderGetter,
  name: string,
): string | undefined {
  const getter = headers as Partial<HeaderGetter>;
  if (typeof getter.get === "function") {
    const value = getter.get(name);
    return value === null ? undefined : value;
  }
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== lower) continue;
    return Array.isArray(value) ? value[0] : (value as string | undefined);
  }
  return undefined;
}

/** Rejects a missing or blank secret before any crypto happens. */
function readSecret(secret: string): string {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error("webhook secret: expected a non-empty string");
  }
  return secret;
}

/** Rejects a timestamp that is not a whole, non-negative number of seconds. */
function readTimestamp(timestamp: number): number {
  if (!Number.isInteger(timestamp) || timestamp < 0) {
    throw new Error(
      `signBody: timestamp must be whole seconds since the epoch, got ${String(timestamp)}`,
    );
  }
  return timestamp;
}

/** The exact bytes that are signed. */
function canonical(timestamp: number, body: string): string {
  return `${timestamp}.${body}`;
}

/** Lowercase hex HMAC-SHA256 of `<timestamp>.<body>`. */
export function digestBody(secret: string, body: string, timestamp: number): string {
  return createHmac("sha256", readSecret(secret))
    .update(canonical(readTimestamp(timestamp), body), "utf8")
    .digest("hex");
}

/**
 * Builds the `x-roan-signature` value for one request.
 *
 * The caller owns the clock: the timestamp it passes is the one a verifier
 * will range-check, so an outbound sender must use the wall clock.
 */
export function signBody(secret: string, body: string, timestamp: number): string {
  if (typeof body !== "string") {
    throw new Error("signBody: body must be a string");
  }
  return `t=${readTimestamp(timestamp)},v1=${digestBody(secret, body, timestamp)}`;
}

/** Parsed `x-roan-signature` parts; both are optional so parsing can report. */
interface ParsedSignature {
  timestampSec?: number;
  digest?: string;
  malformed: boolean;
}

/** Splits `t=...,v1=...` without trusting either value. */
function parseSignatureHeader(value: string): ParsedSignature {
  const parts = value.split(",");
  let timestampSec: number | undefined;
  let digest: string | undefined;
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq <= 0) return { malformed: true };
    const key = part.slice(0, eq).trim();
    const raw = part.slice(eq + 1).trim();
    if (key === "t") {
      if (!/^\d{1,12}$/u.test(raw)) return { malformed: true };
      if (timestampSec !== undefined) return { malformed: true };
      timestampSec = Number(raw);
    } else if (key === "v1") {
      if (!/^[0-9a-fA-F]{64}$/u.test(raw)) return { malformed: true };
      if (digest !== undefined) return { malformed: true };
      digest = raw.toLowerCase();
    } else {
      return { malformed: true };
    }
  }
  return { timestampSec, digest, malformed: false };
}

export interface VerifyOptions {
  /** Current time in seconds; defaults to the wall clock. */
  nowSec?: number;
  /** Optional guard that catches a fresh signature used twice. */
  replay?: ReplayGuard;
}

/**
 * Verifies one inbound request.
 *
 * Order matters: parse, then freshness, then digest, then replay. A stale
 * request is reported as stale even when its digest is nonsense, and a
 * signature is only remembered after it has been proved genuine, so an
 * attacker cannot burn a legitimate signature by sending a bad copy first.
 */
export function verifySignature(
  headers: HeaderBag | HeaderGetter,
  body: string,
  secret: string,
  toleranceSec: number = DEFAULT_TOLERANCE_SEC,
  options: VerifyOptions = {},
): VerifyResult {
  readSecret(secret);
  if (typeof body !== "string") {
    throw new Error("verifySignature: body must be a string");
  }
  if (!Number.isFinite(toleranceSec) || toleranceSec < 0) {
    throw new Error(`verifySignature: toleranceSec must be a finite, non-negative number, got ${String(toleranceSec)}`);
  }

  const header = readHeader(headers, SIGNATURE_HEADER);
  if (header === undefined || header.trim() === "") {
    return { ok: false, reason: "missing_signature" };
  }

  const parsed = parseSignatureHeader(header);
  if (parsed.malformed) {
    return { ok: false, reason: "malformed_signature" };
  }

  let timestampSec = parsed.timestampSec;
  if (timestampSec === undefined) {
    const separate = readHeader(headers, TIMESTAMP_HEADER);
    if (separate === undefined || separate.trim() === "") {
      return { ok: false, reason: "missing_timestamp" };
    }
    if (!/^\d{1,12}$/u.test(separate.trim())) {
      return { ok: false, reason: "malformed_timestamp" };
    }
    timestampSec = Number(separate.trim());
  }

  const digest = parsed.digest;
  if (digest === undefined) {
    return { ok: false, reason: "missing_signature" };
  }

  const nowSec = options.nowSec ?? Math.floor(Date.now() / 1_000);
  if (!Number.isFinite(nowSec)) {
    throw new Error(`verifySignature: nowSec must be finite, got ${String(nowSec)}`);
  }
  if (nowSec - timestampSec > toleranceSec) {
    return { ok: false, reason: "stale_timestamp" };
  }
  if (timestampSec - nowSec > toleranceSec) {
    return { ok: false, reason: "future_timestamp" };
  }

  const expected = digestBody(secret, body, timestampSec);
  const given = Buffer.from(digest, "hex");
  const wanted = Buffer.from(expected, "hex");
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
    return { ok: false, reason: "invalid_signature" };
  }

  if (options.replay !== undefined) {
    const expiresAtSec = timestampSec + toleranceSec;
    if (!options.replay.accept(digest, nowSec, expiresAtSec)) {
      return { ok: false, reason: "replay" };
    }
  }

  return { ok: true, timestampSec, digest };
}
