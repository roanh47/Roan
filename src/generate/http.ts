import { GenerationError, type GenerationConfig } from "./types.js";

/** Hard ceiling on one generated artifact: 25 MiB, the same number the task pins. */
export const MAX_GENERATION_BYTES = 25 * 1024 * 1024;

/** Default per-request deadline. Image models and ComfyUI both take a while. */
export const DEFAULT_GENERATION_TIMEOUT_MS = 120_000;

/** How much of a provider error body is repeated back to the caller. */
const ERROR_PREVIEW = 300;

/** Strips a key from anything about to become a message. Belt and braces. */
export function redact(text: string, secret?: string): string {
  let out = text;
  const trimmed = secret?.trim() ?? "";
  if (trimmed.length >= 4) out = out.split(trimmed).join("[redacted]");
  // Provider keys look like this even when we were not handed the key itself
  // (an upstream error quoting its own token). Short fragments are left alone.
  out = out.replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]");
  return out;
}

/** The effective byte ceiling for one request. */
export function byteCap(config: GenerationConfig): number {
  const configured = config.maxBytes;
  return configured !== undefined && Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : MAX_GENERATION_BYTES;
}

/** The effective deadline for one request. */
export function timeoutMs(config: GenerationConfig): number {
  const configured = config.timeoutMs;
  return configured !== undefined && Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : DEFAULT_GENERATION_TIMEOUT_MS;
}

/**
 * One fetch with a deadline. A timeout or transport failure becomes a
 * `GenerationError` that names the provider and never repeats the request.
 */
export async function fetchWithTimeout(
  provider: string,
  url: string,
  init: RequestInit,
  limit: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limit);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new GenerationError(provider, `request timed out after ${String(limit)} ms`);
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new GenerationError(provider, `request failed: ${redact(detail).slice(0, ERROR_PREVIEW)}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reads a response body while refusing to buffer more than `limit` bytes.
 * Checks the declared length first, then enforces the cap as bytes arrive, so
 * a hostile or broken server cannot fill memory before the check.
 */
export async function readCapped(response: Response, limit: number, provider: string): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > limit) {
    if (response.body !== null) await response.body.cancel().catch(() => undefined);
    throw new GenerationError(provider, `response is ${String(declared)} bytes, over the ${String(limit)}-byte cap`);
  }
  if (response.body === null) throw new GenerationError(provider, "response had no body");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        throw new GenerationError(provider, `response is over the ${String(limit)}-byte cap`);
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Base64 to bytes, refusing to decode something that cannot fit the cap. */
export function decodeBase64Capped(encoded: string, limit: number, provider: string): Uint8Array {
  const clean = encoded.replace(/\s+/g, "");
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  const estimate = Math.floor((clean.length * 3) / 4) - padding;
  if (estimate > limit) {
    throw new GenerationError(provider, `image is ${String(estimate)} bytes, over the ${String(limit)}-byte cap`);
  }
  const bytes = new Uint8Array(Buffer.from(clean, "base64"));
  if (bytes.byteLength === 0) throw new GenerationError(provider, "provider returned an empty image");
  if (bytes.byteLength > limit) {
    throw new GenerationError(provider, `image is ${String(bytes.byteLength)} bytes, over the ${String(limit)}-byte cap`);
  }
  return bytes;
}

/**
 * What a body actually is, by magic bytes. Providers rarely label generated
 * files correctly, and a fixture serving octet-stream must still land as an
 * image. Falls back to `fallback` when the bytes are not a known format.
 */
export function mimeFromBytes(bytes: Uint8Array, fallback: string): string {
  const ascii = (start: number, end: number): string =>
    Buffer.from(bytes.subarray(start, end)).toString("latin1");
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && ascii(0, 4) === "GIF8") return "image/gif";
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "audio/wav";
  if (bytes.length >= 4 && ascii(0, 4) === "OggS") return "audio/ogg";
  if (bytes.length >= 3 && ascii(0, 3) === "ID3") return "audio/mpeg";
  if (bytes.length >= 4 && ascii(0, 4) === "fLaC") return "audio/flac";
  if (bytes.length >= 12 && ascii(4, 8) === "ftyp") {
    return ascii(8, 12) === "M4A " ? "audio/mp4" : "video/mp4";
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] ?? 0) >= 0xe0) return "audio/mpeg";
  return fallback;
}

/** Reads a mime type off a response, ignoring parameters. */
export function mimeFromResponse(response: Response, fallback: string): string {
  const header = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  // Browsers and simple servers say "application/octet-stream"; that is no
  // information, so sniffing beats trusting it.
  return header.length > 0 && header !== "application/octet-stream" ? header : fallback;
}

/**
 * The provider's own words, bounded and redacted. OpenAI-style `{error:{message}}`
 * is unwrapped; anything else falls back to the plain body text.
 */
export function providerMessage(body: string, secret?: string): string {
  let text = body;
  try {
    const parsed = JSON.parse(body) as unknown;
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      const error = record["error"];
      if (typeof error === "string") text = error;
      else if (typeof error === "object" && error !== null) {
        const message = (error as Record<string, unknown>)["message"];
        if (typeof message === "string") text = message;
      }
      if (text === body) {
        const message = record["message"];
        if (typeof message === "string") text = message;
      }
      if (text === body) {
        const detail = record["detail"];
        if (typeof detail === "string") text = detail;
      }
    }
  } catch {
    // Not JSON; the body text itself is the best available explanation.
  }
  return redact(text.replace(/\s+/g, " ").trim(), secret).slice(0, ERROR_PREVIEW);
}
