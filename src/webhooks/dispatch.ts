/**
 * Outbound and inbound webhook delivery.
 *
 * Outbound is https-only. Loopback is refused unless the caller passes
 * `allowLoopback`, which exists so a test can point at `127.0.0.1` without the
 * production rule growing an exception. Redirects are not followed: a 3xx is
 * reported as a failed delivery, because following one would hand the signed
 * body and the signature to whatever host the redirect names.
 *
 * Inbound parses and verifies before it trusts anything. A refusal carries one
 * reason and never a partially built event, so a caller cannot accidentally
 * start a turn on a request whose signature did not check out.
 */

import { DEFAULT_TOLERANCE_SEC, readHeader, signBody, verifySignature } from "./sign.js";
import type { HeaderBag, ReplayGuard, SignatureFailure } from "./sign.js";

/** Default outbound timeout. */
export const DEFAULT_TIMEOUT_MS = 10_000;
/** Default cap on an inbound body, in bytes. */
export const DEFAULT_MAX_BODY_BYTES = 64 * 1024;

/** Reasons an inbound request is refused. */
export type IncomingRefusal =
  | SignatureFailure
  | "body_too_large"
  | "invalid_json"
  | "invalid_payload";

/** What an accepted request hands to the turn runner. */
export interface IncomingWebhookEvent {
  type: "webhook";
  /** Stable id for the chain; derived from the verified signature. */
  id: string;
  /** Origin label from `x-roan-source`, or `webhook`. */
  source: string;
  /** Event name from `x-roan-event`, then `payload.event`, then `webhook`. */
  event: string;
  /** Receipt time in milliseconds since the epoch. */
  receivedAt: number;
  /** Signed timestamp, in seconds. */
  timestampSec: number;
  /** Decoded JSON body. */
  payload: unknown;
}

export type IncomingResult =
  | { accepted: true; event: IncomingWebhookEvent }
  | { accepted: false; reason: IncomingRefusal };

export interface SendWebhookOptions {
  /** Shared secret; an empty value is a configuration error. */
  secret: string;
  /** Abort after this many milliseconds. Default `DEFAULT_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** Permit `http://` to a loopback host. Tests only. */
  allowLoopback?: boolean;
  /** Clock override in seconds, for a deterministic signature in a test. */
  nowSec?: number;
  /** Transport override; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

/** Result of one delivery attempt. */
export interface WebhookDelivery {
  ok: boolean;
  /** HTTP status, or 0 when the request never produced a response. */
  status: number;
  /** The signature header that was sent, useful for a receiver's logs. */
  signature: string;
  /** Response body, truncated to 4 KiB. */
  body: string;
  /** Set only when the attempt failed before a usable response. */
  error?: string;
}

/** A caller mistake, as opposed to a failed delivery. */
export class WebhookConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookConfigError";
  }
}

/** Loopback names that only ever mean "this machine". */
function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

/**
 * Checks the URL before any bytes are signed or sent.
 *
 * A hostname that merely looks local (`localhost.example.com`) is not loopback;
 * `isLoopbackHost` matches the whole label. DNS is never consulted, so this
 * cannot be talked into trusting an external name that resolves to `127.0.0.1`.
 */
export function assertWebhookUrl(rawUrl: string, allowLoopback: boolean): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new WebhookConfigError(`webhook url: not a valid URL: ${JSON.stringify(rawUrl)}`);
  }
  if (url.username !== "" || url.password !== "") {
    throw new WebhookConfigError("webhook url: credentials in the URL are not allowed");
  }
  if (url.protocol === "https:") {
    return url;
  }
  if (url.protocol === "http:" && allowLoopback && isLoopbackHost(url.hostname)) {
    return url;
  }
  if (url.protocol === "http:") {
    throw new WebhookConfigError(
      `webhook url: plain http is refused (${url.hostname}); use https`,
    );
  }
  throw new WebhookConfigError(`webhook url: unsupported scheme ${url.protocol}`);
}

/** Keeps a response body short enough to log without thinking. */
function trimBody(text: string, max = 4_096): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/**
 * Signs a payload and POSTs it once.
 *
 * Configuration problems throw `WebhookConfigError`; a network failure, timeout
 * or non-2xx answer comes back as `ok: false`, because those are delivery
 * outcomes the caller retries, not programming errors.
 */
export async function sendWebhook(
  url: string,
  payload: unknown,
  options: SendWebhookOptions,
): Promise<WebhookDelivery> {
  const target = assertWebhookUrl(url, options.allowLoopback === true);
  if (typeof options.secret !== "string" || options.secret === "") {
    throw new WebhookConfigError("webhook secret: expected a non-empty string");
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new WebhookConfigError(`webhook timeoutMs: expected a positive number, got ${String(timeoutMs)}`);
  }

  let body: string;
  try {
    body = JSON.stringify(payload);
  } catch {
    throw new WebhookConfigError("webhook payload: not JSON-serialisable");
  }
  if (body === undefined) {
    throw new WebhookConfigError("webhook payload: not JSON-serialisable");
  }

  const timestampSec = options.nowSec ?? Math.floor(Date.now() / 1_000);
  const signature = signBody(options.secret, body, timestampSec);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  try {
    const response = await fetchImpl(target.toString(), {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/json",
        "user-agent": "roan-webhook/1",
        "x-roan-signature": signature,
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = trimBody(await response.text());
    const ok = response.status >= 200 && response.status < 300;
    const delivery: WebhookDelivery = { ok, status: response.status, signature, body: text };
    if (response.status >= 300 && response.status < 400) {
      delivery.error = "redirect refused";
    }
    return delivery;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      status: 0,
      signature,
      body: "",
      // fetch can echo the URL in its message; the URL is credential-free and the
      // secret is only ever a header, but a transport wrapper may still quote it.
      error: trimBody(message.split(options.secret).join("[redacted]"), 500),
    };
  }
}

export interface HandleIncomingOptions {
  /** Freshness window in seconds. Default `DEFAULT_TOLERANCE_SEC`. */
  toleranceSec?: number;
  /** Body cap in bytes. Default `DEFAULT_MAX_BODY_BYTES`. */
  maxBodyBytes?: number;
  /** Replay guard; pass one shared instance to reject a repeated signature. */
  replay?: ReplayGuard;
}

/** Normalizes `now` (milliseconds, seconds or a Date) to whole seconds. */
function nowToSeconds(now: number | Date): number {
  const ms = now instanceof Date ? now.getTime() : now;
  if (!Number.isFinite(ms) || ms < 0) {
    throw new Error(`handleIncoming: now must be a Date or a non-negative number, got ${String(now)}`);
  }
  // A caller passing seconds is unusual but unambiguous: anything below 1e12
  // cannot be a millisecond timestamp for this century.
  return Math.floor((ms < 1e12 ? ms * 1_000 : ms) / 1_000);
}

/**
 * Verifies an inbound request and turns it into one event, or refuses it.
 *
 * The returned id is derived from the verified digest, so the same request
 * replayed after the freshness window still maps to the same id and the chain
 * de-duplicates it instead of running the task twice.
 */
export function handleIncoming(
  headers: HeaderBag,
  body: string,
  secret: string,
  now: number | Date,
  options: HandleIncomingOptions = {},
): IncomingResult {
  if (typeof body !== "string") {
    throw new Error("handleIncoming: body must be a string");
  }
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  if (Buffer.byteLength(body, "utf8") > maxBodyBytes) {
    return { accepted: false, reason: "body_too_large" };
  }

  const nowSec = nowToSeconds(now);
  const verified = verifySignature(headers, body, secret, options.toleranceSec ?? DEFAULT_TOLERANCE_SEC, {
    nowSec,
    ...(options.replay === undefined ? {} : { replay: options.replay }),
  });
  if (!verified.ok) {
    return { accepted: false, reason: verified.reason };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return { accepted: false, reason: "invalid_json" };
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return { accepted: false, reason: "invalid_payload" };
  }

  const record = payload as Record<string, unknown>;
  const headerEvent = readHeader(headers, "x-roan-event");
  const headerSource = readHeader(headers, "x-roan-source");
  const payloadEvent = typeof record["event"] === "string" ? record["event"] : undefined;

  return {
    accepted: true,
    event: {
      type: "webhook",
      id: `wh_${verified.digest.slice(0, 32)}`,
      source: cleanLabel(headerSource) ?? "webhook",
      event: cleanLabel(headerEvent) ?? cleanLabel(payloadEvent) ?? "webhook",
      receivedAt: nowSec * 1_000,
      timestampSec: verified.timestampSec,
      payload,
    },
  };
}

/** One short, printable label; anything longer or control-heavy is dropped. */
function cleanLabel(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/[\r\n\u2028\u2029]+/gu, " ").trim();
  if (text === "" || text.length > 120) return undefined;
  return text;
}
