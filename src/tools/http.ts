/**
 * Fetches a URL and returns the content as plain text.
 *
 * Deliberately simple: no retries, no cookies, no authentication. A non-2xx
 * response is not an error — the status and the body are returned as-is, so the
 * caller can decide for itself what to do with them.
 */

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_CHARS = 20_000;

export interface FetchResult {
  url: string;
  status: number;
  contentType: string;
  text: string;
  truncated: boolean;
}

export interface FetchOptions {
  timeoutMs?: number;
  maxChars?: number;
}

/** Only usable positive numbers; anything else falls back to the default. */
function positiveInt(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

/** Media type without parameters, lowercase. */
function mediaType(contentType: string): string {
  return (contentType.split(";")[0] ?? "").trim().toLowerCase();
}

/** text/* and JSON are readable; images, PDFs and binary junk are not. */
function isTextual(media: string): boolean {
  return media.startsWith("text/") || media === "application/json" || media.endsWith("+json");
}

/** HTML must first be made readable; everything else passes through unchanged. */
function isHtml(media: string): boolean {
  return media === "text/html" || media === "application/xhtml+xml";
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
};

function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (match, name: string) => {
    const key = name.toLowerCase();
    const known = ENTITIES[key];
    if (known !== undefined) return known;
    if (key.startsWith("#x")) {
      const code = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (key.startsWith("#")) {
      const code = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return match;
  });
}

/**
 * Turns HTML into plain text: scripts, styles, comments and tags removed,
 * block boundaries become line breaks, whitespace is normalised.
 */
function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<(script|style)\b[^>]*\/>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|section|article|header|footer|main|aside|nav|li|tr|td|th|h[1-6]|blockquote|pre)\s*>/gi, "\n")
      .replace(/<(hr|p|div|tr|h[1-6])\b[^>]*>/gi, "\n")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Reads the body up to at most `maxChars` characters. Stops reading as soon as
 * the maximum is exceeded, so an enormous page does not eat memory.
 */
async function readBody(
  res: Response,
  maxChars: number,
): Promise<{ text: string; truncated: boolean }> {
  const body = res.body;
  if (body === null) {
    const text = await res.text();
    return text.length > maxChars
      ? { text: text.slice(0, maxChars), truncated: true }
      : { text, truncated: false };
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let truncated = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        text += decoder.decode(value, { stream: true });
      }
      if (text.length > maxChars) {
        truncated = true;
        text = text.slice(0, maxChars);
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
    if (!truncated) text += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  return { text, truncated };
}

/** Turns the various fetch errors into one clear message per failure mode. */
function fetchError(url: string, err: unknown, timeoutMs: number): Error {
  const e = (typeof err === "object" && err !== null ? err : {}) as {
    name?: string;
    message?: string;
    cause?: { code?: string; message?: string };
  };

  if (e.name === "TimeoutError" || e.name === "AbortError") {
    return new Error(`timeout after ${timeoutMs} ms: no response from ${url}`);
  }

  const code = e.cause?.code ?? "";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "EAI_FAIL" || code === "ENODATA") {
    return new Error(`DNS error (${code}): host of ${url} not found`);
  }
  if (
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "EHOSTUNREACH" ||
    code === "ENETUNREACH" ||
    code === "ECONNABORTED" ||
    code === "EPIPE"
  ) {
    return new Error(`connection error (${code}): cannot connect to ${url}`);
  }
  if (code === "ETIMEDOUT") {
    return new Error(`connection error (ETIMEDOUT): connection to ${url} dropped`);
  }
  if (
    code.startsWith("ERR_TLS") ||
    code === "CERT_HAS_EXPIRED" ||
    code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
    code === "DEPTH_ZERO_SELF_SIGNED_CERT"
  ) {
    return new Error(`TLS error (${code}): certificate of ${url} is not trusted`);
  }

  const detail = e.cause?.message ?? e.message ?? "unknown cause";
  return new Error(`network error at ${url}: ${detail}`);
}

/**
 * Fetches `url`. Only throws on an unusable URL or a network error;
 * an HTTP error status simply ends up in the result.
 */
export async function fetchUrl(url: string, options: FetchOptions = {}): Promise<FetchResult> {
  const timeoutMs = positiveInt(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const maxChars = positiveInt(options.maxChars, DEFAULT_MAX_CHARS);

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new Error(`invalid URL: "${url}"`);
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error(`invalid URL: "${url}" (only http and https are supported)`);
  }

  let res: Response;
  try {
    res = await fetch(target, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.5",
        "accept-language": "nl,en;q=0.8",
        "user-agent": "Mozilla/5.0 (compatible; RoanBot/1.0)",
      },
    });
  } catch (err) {
    throw fetchError(url, err, timeoutMs);
  }

  const contentType = (res.headers.get("content-type") ?? "").trim();
  const media = mediaType(contentType);

  if (!isTextual(media)) {
    // Nothing readable: do not pull in the body, clean up right away.
    await res.body?.cancel().catch(() => undefined);
    return { url: target.toString(), status: res.status, contentType, text: "", truncated: false };
  }

  // HTML carries a lot of markup per character: read more raw characters than the final budget.
  const html = isHtml(media);
  const readLimit = html ? maxChars * 4 : maxChars;

  let raw: string;
  let readTruncated: boolean;
  try {
    ({ text: raw, truncated: readTruncated } = await readBody(res, readLimit));
  } catch (err) {
    throw fetchError(url, err, timeoutMs);
  }

  const processed = html ? htmlToText(raw) : raw;
  const truncated = readTruncated || processed.length > maxChars;
  const text = processed.length > maxChars ? processed.slice(0, maxChars) : processed;

  return { url: target.toString(), status: res.status, contentType, text, truncated };
}
