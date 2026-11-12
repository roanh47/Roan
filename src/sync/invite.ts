/**
 * Invite codes: a short, typo-resistant string another machine can use to reach
 * this chain.
 *
 * The code has three dot-separated parts:
 *
 *   ROAN1.<payload>.<checksum>
 *
 * `payload` is the JSON invite in Crockford base32, `checksum` is 40 bits of
 * SHA-256 over that payload. The format is case-insensitive and ignores spaces
 * and hyphens, so a code read aloud or copied out of a chat still parses.
 *
 * The checksum is checked before the payload is decoded, which is the point:
 * a mistyped character is reported as a checksum failure ("you mistyped this")
 * and never as a confusing JSON error. Expiry is a separate check with its own
 * error, so the app can offer "ask for a fresh code" instead of "invalid code".
 *
 * No secret travels here. An invite says where the chain is and how long the
 * offer stands; authentication is a separate concern.
 */

import { createHash } from "node:crypto";

/** Default lifetime of an invite: one day. */
export const DEFAULT_INVITE_TTL_MS = 24 * 60 * 60 * 1000;

/** Leading segment; the digit is the format version. */
const PREFIX = "ROAN";
const VERSION = 1;

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CHECKSUM_CHARS = 8;

/** What the caller supplies to mint a code. */
export interface CreateInviteInput {
  /** Chain id the other machine is being invited to. */
  readonly chain: string;
  /** Host or IP the invited machine should connect to. */
  readonly host: string;
  /** TCP port on that host, 1..65535. */
  readonly port: number;
  /** How long the code stays valid. Defaults to `DEFAULT_INVITE_TTL_MS`. */
  readonly ttlMs?: number;
}

/** What a valid code contains. */
export interface Invite {
  readonly v: 1;
  readonly chain: string;
  readonly host: string;
  readonly port: number;
  /** Epoch ms the code was minted. */
  readonly issuedAt: number;
  /** Epoch ms after which the code is refused. */
  readonly expiresAt: number;
}

/**
 * Why a code was refused. Callers switch on this instead of matching strings:
 * `checksum` means "likely a typo, let them retry", `expired` means "ask for a
 * new code", `version` means "the other machine is newer or older".
 */
export type InviteErrorCode = "malformed" | "version" | "checksum" | "invalid" | "expired";

export class InviteError extends Error {
  readonly code: InviteErrorCode;

  constructor(code: InviteErrorCode, message: string) {
    super(message);
    this.name = "InviteError";
    this.code = code;
  }
}

/** Short form of the input for messages; never echoes a whole pasted blob. */
function shown(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= 24 ? `"${trimmed}"` : `"${trimmed.slice(0, 21)}..."`;
}

function encodeBase32(bytes: Uint8Array): string {
  let out = "";
  let buffer = 0;
  let bits = 0;

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(buffer >>> bits) & 31];
    }
    buffer &= (1 << bits) - 1;
  }

  if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}

function decodeBase32(text: string): Uint8Array {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;

  for (const char of text) {
    const value = ALPHABET.indexOf(char);
    if (value < 0) {
      throw new InviteError("malformed", `invite code ${shown(text)} contains an invalid character "${char}"`);
    }
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 0xff);
    }
    buffer &= (1 << bits) - 1;
  }

  // Non-zero trailing bits mean the payload was truncated or padded wrong.
  if (buffer !== 0) {
    throw new InviteError("malformed", `invite code ${shown(text)} ends mid-character`);
  }
  return Uint8Array.from(bytes);
}

function checksum(payload: string): string {
  return encodeBase32(createHash("sha256").update(payload, "utf8").digest().subarray(0, 5));
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/**
 * Mints an invite code. Throws `InviteError` with code `invalid` when the input
 * cannot describe a reachable chain.
 */
export function createInvite(input: CreateInviteInput, now: number = Date.now()): string {
  const ttlMs = input.ttlMs ?? DEFAULT_INVITE_TTL_MS;

  if (input.chain.trim().length === 0) {
    throw new InviteError("invalid", "cannot create an invite without a chain id");
  }
  if (input.host.trim().length === 0) {
    throw new InviteError("invalid", "cannot create an invite without a host");
  }
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
    throw new InviteError("invalid", `cannot create an invite with port ${String(input.port)}`);
  }
  if (!isPositiveInt(ttlMs)) {
    throw new InviteError("invalid", `cannot create an invite with ttlMs ${String(ttlMs)}`);
  }

  const invite: Invite = {
    v: VERSION,
    chain: input.chain.trim(),
    host: input.host.trim(),
    port: input.port,
    issuedAt: now,
    expiresAt: now + ttlMs,
  };

  if (!Number.isSafeInteger(invite.expiresAt)) {
    throw new InviteError("invalid", `invite expiry ${String(invite.expiresAt)} is out of range`);
  }

  const payload = encodeBase32(Buffer.from(JSON.stringify(invite), "utf8"));
  return `${PREFIX}${VERSION}.${payload}.${checksum(payload)}`;
}

/**
 * Reads an invite code and returns what it promises.
 *
 * Throws `InviteError` with a distinct `code` for each failure:
 * - `malformed` — not a code at all, or one with characters cut off.
 * - `version`   — a code from a different format version.
 * - `checksum`  — the shape is right but the characters do not match; a typo.
 * - `invalid`   — checksum passed but the contents make no sense.
 * - `expired`   — the code was valid, but its expiry has passed.
 *
 * `now` is injectable so expiry can be tested without waiting.
 */
export function parseInvite(text: string, now: number = Date.now()): Invite {
  // Case, spaces and hyphens are presentation; accept what a human would type.
  const normalized = text.trim().toUpperCase().replace(/[\s-]/g, "");
  if (normalized.length === 0) {
    throw new InviteError("malformed", "invite code is empty");
  }

  const parts = normalized.split(".");
  if (parts.length !== 3) {
    throw new InviteError(
      "malformed",
      `invite code ${shown(text)} should have three dot-separated parts, found ${parts.length}`,
    );
  }

  const [prefix, payload, given] = parts;
  if (prefix === undefined || payload === undefined || given === undefined || payload.length === 0) {
    throw new InviteError("malformed", `invite code ${shown(text)} is incomplete`);
  }

  const versionMatch = /^ROAN(\d+)$/.exec(prefix);
  if (versionMatch === null) {
    throw new InviteError("malformed", `invite code ${shown(text)} is not a Roan invite`);
  }
  if (Number(versionMatch[1]) !== VERSION) {
    throw new InviteError(
      "version",
      `invite code uses format version ${String(versionMatch[1])}; this build understands version ${VERSION}`,
    );
  }

  if (given.length !== CHECKSUM_CHARS) {
    throw new InviteError(
      "malformed",
      `invite code ${shown(text)} has a ${given.length}-character checksum, expected ${CHECKSUM_CHARS}`,
    );
  }

  // Reject characters outside the alphabet before comparing checksums: that
  // is a malformed code, not a plausible mistype, and the caller should not be
  // told "you mistyped it" for something that was never a code.
  for (const char of payload + given) {
    if (!ALPHABET.includes(char)) {
      throw new InviteError("malformed", `invite code ${shown(text)} contains an invalid character "${char}"`);
    }
  }

  const expected = checksum(payload);
  if (given !== expected) {
    throw new InviteError(
      "checksum",
      `invite code ${shown(text)} failed its checksum; a character was probably mistyped`,
    );
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(decodeBase32(payload)).toString("utf8"));
  } catch (error) {
    if (error instanceof InviteError) throw error;
    throw new InviteError("malformed", `invite code ${shown(text)} does not contain readable data`);
  }

  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
    throw new InviteError("invalid", "invite code payload is not an object");
  }
  const p = decoded as Record<string, unknown>;

  if (p["v"] !== VERSION) {
    throw new InviteError("version", `invite payload version ${String(p["v"])} is not ${VERSION}`);
  }
  if (typeof p["chain"] !== "string" || p["chain"].trim().length === 0) {
    throw new InviteError("invalid", "invite code carries no chain id");
  }
  if (typeof p["host"] !== "string" || p["host"].trim().length === 0) {
    throw new InviteError("invalid", "invite code carries no host");
  }
  const port = p["port"];
  if (!isPositiveInt(port) || port > 65535) {
    throw new InviteError("invalid", `invite code carries an unusable port: ${String(port)}`);
  }
  const issuedAt = p["issuedAt"];
  const expiresAt = p["expiresAt"];
  if (typeof issuedAt !== "number" || !Number.isFinite(issuedAt)) {
    throw new InviteError("invalid", "invite code carries no issue time");
  }
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) {
    throw new InviteError("invalid", "invite code carries no expiry");
  }
  if (expiresAt <= issuedAt) {
    throw new InviteError("invalid", "invite code expires before it was issued");
  }
  if (now >= expiresAt) {
    throw new InviteError("expired", `invite code expired at ${new Date(expiresAt).toISOString()}`);
  }

  return { v: VERSION, chain: p["chain"], host: p["host"], port, issuedAt, expiresAt };
}
