/**
 * Mobile pairing payloads.
 *
 * A pairing token is the url-safe base64 (no padding) encoding of a small JSON
 * object handed to a phone via a QR code. Decoding is deliberately strict: the
 * token alphabet is checked before decoding, and every field is validated after
 * parsing, so a corrupted QR code fails loudly instead of pairing silently.
 *
 * Neither the code nor the token is ever included in an error message or logged.
 */

import { Buffer } from 'node:buffer';

export interface PairingPayload {
  code: string;
  tailnetName: string;
  chainId: string;
  expiresAt: number;
}

const MIN_CODE_LENGTH = 8;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const STRING_FIELDS = ['code', 'tailnetName', 'chainId'] as const;

/** The code is a secret: only its length may appear in an error message. */
function requireCode(code: unknown): string {
  if (typeof code !== 'string') {
    throw new Error(`pairing code must be a string, got ${typeof code}`);
  }
  if (code.length < MIN_CODE_LENGTH) {
    throw new Error(
      `pairing code must be at least ${MIN_CODE_LENGTH} characters, got ${code.length}`,
    );
  }
  return code;
}

function requireNonEmpty(field: 'tailnetName' | 'chainId', value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error(`${field} must be a string, got ${typeof value}`);
  }
  if (value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function requireExpiresAt(expiresAt: unknown): number {
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) {
    throw new Error(`expiresAt must be a finite unix-ms timestamp, got ${String(expiresAt)}`);
  }
  return expiresAt;
}

/**
 * Encode `payload` as a url-safe, unpadded base64 JSON string.
 *
 * @throws Error on a code shorter than {@link MIN_CODE_LENGTH} chars, an empty
 *   `tailnetName`/`chainId`, or a non-finite `expiresAt`.
 */
export function encodePairing(payload: PairingPayload): string {
  const code = requireCode(payload.code);
  const tailnetName = requireNonEmpty('tailnetName', payload.tailnetName);
  const chainId = requireNonEmpty('chainId', payload.chainId);
  const expiresAt = requireExpiresAt(payload.expiresAt);

  const json = JSON.stringify({ code, tailnetName, chainId, expiresAt });
  return Buffer.from(json, 'utf8').toString('base64url');
}

/** Decode the token to text; a token that is not clean url-safe base64 is "not decodable". */
function tokenToJson(token: string): unknown {
  if (!BASE64URL_PATTERN.test(token)) {
    throw new Error('pairing token is not decodable: expected url-safe base64 without padding');
  }

  let text: string;
  try {
    text = Buffer.from(token, 'base64url').toString('utf8');
  } catch {
    throw new Error('pairing token is not decodable: base64 decoding failed');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('pairing token is not decodable: payload is not valid JSON');
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('pairing token is not decodable: payload is not a JSON object');
  }
  return parsed;
}

/**
 * Decode and validate a pairing token.
 *
 * `nowMs` defaults to `Date.now()`; pass it explicitly in tests. Unknown extra
 * fields in the JSON are ignored.
 *
 * @throws Error with one of three distinct messages: not decodable, missing or
 *   mistyped field (named), or expired (with the `expiresAt` timestamp).
 */
export function decodePairing(token: string, nowMs: number = Date.now()): PairingPayload {
  if (!Number.isFinite(nowMs)) {
    throw new Error(`decodePairing: invalid "nowMs" timestamp: ${String(nowMs)}`);
  }

  const record = tokenToJson(token) as Record<string, unknown>;

  for (const field of STRING_FIELDS) {
    const value = record[field];
    if (value === undefined) {
      throw new Error(`pairing payload is missing required field "${field}"`);
    }
    if (typeof value !== 'string') {
      throw new Error(`pairing payload field "${field}" must be a string, got ${typeof value}`);
    }
  }
  const rawExpiresAt = record.expiresAt;
  if (rawExpiresAt === undefined) {
    throw new Error('pairing payload is missing required field "expiresAt"');
  }
  if (typeof rawExpiresAt !== 'number') {
    throw new Error(
      `pairing payload field "expiresAt" must be a number, got ${typeof rawExpiresAt}`,
    );
  }

  const code = requireCode(record.code);
  const tailnetName = requireNonEmpty('tailnetName', record.tailnetName);
  const chainId = requireNonEmpty('chainId', record.chainId);
  const expiresAt = requireExpiresAt(rawExpiresAt);

  if (nowMs >= expiresAt) {
    throw new Error(
      `pairing token expired at ${new Date(expiresAt).toISOString()} (expiresAt ${String(expiresAt)}, now ${String(nowMs)})`,
    );
  }

  return { code, tailnetName, chainId, expiresAt };
}
