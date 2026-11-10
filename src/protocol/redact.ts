/**
 * Redaction for everything that leaves the process: event payloads, log lines
 * and error messages.
 *
 * Three entry points, one rule set: `redact` scrubs a string, `redactDeep`
 * walks a JSON-ish value and `redactUrl` handles URLs (userinfo, secret query
 * parameters). Every function is safe to call twice — the replacement text
 * never matches a pattern again — so a value cannot be "un-redacted" by a
 * later pass and cannot grow on repeated runs.
 *
 * This is a best-effort scrubber, not a guarantee: it catches the credential
 * shapes this project actually emits. Anything genuinely secret should still
 * never reach a payload in the first place.
 */

import os from "node:os";

export interface RedactOptions {
  /** Directory replaced by `~`. Defaults to `os.homedir()`. */
  home?: string;
  /** Extra expressions whose matches are replaced with `REDACTED`. */
  extraPatterns?: readonly RegExp[];
}

export const REDACTED = "[redacted]";

/** Stand-in for a value that points back at one of its own ancestors. */
const CIRCULAR = "[circular]";

/*
 * PEM blocks go first: the base64 body is long and arbitrary, so nothing else
 * should be given a chance to nibble at it. An unterminated block is treated as
 * running to the end of the text, which is the only safe assumption.
 */
const PEM_BLOCK =
  /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----|$)/g;

/** Keeps the scheme words, replaces only the credential. */
const AUTHORIZATION = /(\bauthorization\s*:\s*(?:bearer|basic|token)\s+)[^\s,;]+/gi;

/** `scheme://user:pass@host` -> `scheme://[redacted]@host`. */
const URL_USERINFO = /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/?#@]+@/gi;

const SECRET_TOKENS: readonly RegExp[] = [
  // OpenAI style: sk-..., sk-ant-..., sk-proj-..., sk-svcacct-...
  /\bsk-(?:ant-|proj-|svcacct-)?[A-Za-z0-9_-]{16,}/g,
  // GitHub: fine-grained PATs then the classic ghp_/gho_/ghu_/ghs_/ghr_ tokens.
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  // Slack bot/user/app/refresh/... tokens.
  /\bxox[abeprs]-[A-Za-z0-9-]{10,}/g,
  // Google API keys.
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  // AWS access key ids (long-term and temporary).
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
];

/** Query parameters whose value never belongs in a log line. */
const SENSITIVE_PARAM = /(key|token|secret|password|sig)/i;

let cachedHome: string | undefined;

function defaultHome(): string {
  if (cachedHome === undefined) {
    try {
      cachedHome = os.homedir();
    } catch {
      // No HOME, no passwd entry: nothing to collapse, keep the text as is.
      cachedHome = "";
    }
  }
  return cachedHome;
}

/**
 * Replace a literal path, never a pattern, so a home directory containing
 * regex metacharacters cannot corrupt the substitution.
 */
function collapseHome(text: string, home: string): string {
  if (home.length === 0 || home === "/" || home === "~" || text.length === 0) {
    return text;
  }
  const withSlash = home.endsWith("/") ? home : `${home}/`;
  return text.split(withSlash).join("~/").split(home).join("~");
}

function toGlobal(pattern: RegExp): RegExp {
  if (pattern.flags.includes("g")) return pattern;
  return new RegExp(pattern.source, `${pattern.flags}g`);
}

/**
 * Scrub one string. Never throws on string input, including very large input.
 */
export function redact(text: string, options: RedactOptions = {}): string {
  if (typeof text !== "string") {
    throw new Error(`redact: expected a string, got ${typeof text}`);
  }
  if (text.length === 0) return text;

  let out = text.replace(PEM_BLOCK, REDACTED);
  out = out.replace(AUTHORIZATION, (_match, prefix: string) => `${prefix}${REDACTED}`);
  out = out.replace(URL_USERINFO, (_match, scheme: string) => `${scheme}${REDACTED}@`);

  for (const pattern of SECRET_TOKENS) {
    out = out.replace(pattern, REDACTED);
  }

  for (const pattern of options.extraPatterns ?? []) {
    out = out.replace(toGlobal(pattern), REDACTED);
  }

  return collapseHome(out, options.home ?? defaultHome());
}

function decodeName(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Drop everything before the `@` in the authority, keeping the `@`. */
function stripUserinfo(head: string): string {
  const schemeEnd = head.indexOf("://");
  if (schemeEnd === -1) return head;

  const authorityStart = schemeEnd + 3;
  const slash = head.indexOf("/", authorityStart);
  const authorityEnd = slash === -1 ? head.length : slash;
  const authority = head.slice(authorityStart, authorityEnd);
  const at = authority.lastIndexOf("@");
  if (at === -1) return head;

  return `${head.slice(0, authorityStart)}${authority.slice(at + 1)}${head.slice(authorityEnd)}`;
}

/** Keep the parameter name, replace the value with `REDACTED`. */
function redactQuery(query: string): string {
  if (query.length === 0) return query;

  return query
    .split("&")
    .map((part) => {
      if (part.length === 0) return part;
      const equals = part.indexOf("=");
      const rawName = equals === -1 ? part : part.slice(0, equals);
      if (!SENSITIVE_PARAM.test(decodeName(rawName))) return part;
      return `${rawName}=${REDACTED}`;
    })
    .join("&");
}

/**
 * Scrub a URL: userinfo is dropped, secret-looking query parameters keep their
 * name but lose their value. The rest of the URL is passed through `redact`,
 * so a token in the path is caught too.
 */
export function redactUrl(url: string, options: RedactOptions = {}): string {
  if (typeof url !== "string") {
    throw new Error(`redactUrl: expected a string url, got ${typeof url}`);
  }
  if (url.length === 0) return url;

  const hashAt = url.indexOf("#");
  const hash = hashAt === -1 ? "" : url.slice(hashAt);
  const beforeHash = hashAt === -1 ? url : url.slice(0, hashAt);

  const queryAt = beforeHash.indexOf("?");
  const query = queryAt === -1 ? "" : beforeHash.slice(queryAt + 1);
  const head = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);

  const withoutUserinfo = stripUserinfo(head);
  const scrubbedQuery = redactQuery(query);

  let rebuilt: string;
  if (queryAt === -1) {
    rebuilt = withoutUserinfo;
  } else if (query.length > 0 && scrubbedQuery.length === 0) {
    rebuilt = `${withoutUserinfo}?`;
  } else {
    rebuilt = `${withoutUserinfo}?${scrubbedQuery}`;
  }

  return redact(rebuilt + hash, options);
}

function walk(value: unknown, options: RedactOptions, ancestors: Set<object>): unknown {
  if (typeof value === "string") return redact(value, options);
  if (value === null || typeof value !== "object") return value;

  const object = value as object;
  if (ancestors.has(object)) return CIRCULAR;

  if (Array.isArray(object)) {
    ancestors.add(object);
    const copy: unknown[] = [];
    for (const item of object as readonly unknown[]) {
      copy.push(walk(item, options, ancestors));
    }
    ancestors.delete(object);
    return copy;
  }

  const record = object as Record<string, unknown>;
  const prototype = Object.getPrototypeOf(record) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    // Dates, Maps, class instances: not ours to touch, not ours to copy.
    return record;
  }

  ancestors.add(record);
  const copy: Record<string, unknown> =
    prototype === null ? (Object.create(null) as Record<string, unknown>) : {};
  for (const key of Object.keys(record)) {
    // defineProperty, not assignment: a literal "__proto__" key must stay an
    // own property instead of rewiring the copy's prototype.
    Object.defineProperty(copy, key, {
      value: walk(record[key], options, ancestors),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  ancestors.delete(record);
  return copy;
}

/**
 * Redact every string in a plain object or array, recursively. Numbers,
 * booleans, null and undefined pass through untouched, non-plain objects are
 * returned by reference, and the input is never mutated. A value that contains
 * itself becomes `"[circular]"` instead of hanging.
 */
export function redactDeep<T>(value: T, options: RedactOptions = {}): T {
  return walk(value, options, new Set<object>()) as T;
}
