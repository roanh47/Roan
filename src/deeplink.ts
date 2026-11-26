/**
 * App deep links: the `roan://` urls the operating system hands the app when a
 * link is clicked, plus the inverse builder so the app (or a script) can offer
 * one.
 *
 * Exactly three shapes exist, and nothing else parses:
 *
 *   roan://session/<id>        open a conversation
 *   roan://chat?text=…         start a turn with that text
 *   roan://settings/<page>     open one settings page
 *
 * Parsing returns a result rather than throwing: a link comes from outside the
 * process — an OS intent, a QR code, another app — so a malformed one is an
 * ordinary answer the caller shows, not an exception it crashes on. Building
 * throws, because there the caller passes its own values and a bad one is a
 * bug in the caller.
 *
 * `src/mobile/deeplink.ts` owns the fourth link (`roan://join?…`, pairing) on
 * purpose: it carries a secret and expires, which none of these do.
 */

/** The scheme half of every link here. */
const SCHEME = "roan";

/** The settings pages the web shell can show, matching `SETTINGS_ROWS`. */
export const SETTINGS_PAGES = [
  "providers",
  "agent",
  "tools",
  "workspace",
  "schedules",
  "checkpoints",
  "devices",
  "storage",
  "about",
] as const;

export type SettingsPage = (typeof SETTINGS_PAGES)[number];

/** Longest text a chat link may carry; the share inbox uses the same ceiling. */
export const MAX_TEXT_LENGTH = 20_000;

/** Longest session id accepted; chain ids and uuids are far shorter. */
const MAX_ID_LENGTH = 128;

/**
 * Ids travel in a url, a settings key and a daemon reply, so only characters
 * that survive all three are allowed. A leading dot or dash is refused so an id
 * can never look like a flag or a hidden file on its way somewhere else.
 */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

/**
 * Control characters are refused in text: they do not render, they break
 * terminals and logs, and a link that carries one is a mistake rather than a
 * message. `\n` and `\r` stay allowed — a chat link may legitimately carry a
 * multi-line prompt.
 */
const CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export interface SessionLink {
  readonly kind: "session";
  readonly params: { readonly id: string };
}

export interface ChatLink {
  readonly kind: "chat";
  readonly params: { readonly text: string; readonly session?: string };
}

export interface SettingsLink {
  readonly kind: "settings";
  readonly params: { readonly page: SettingsPage };
}

export type DeepLink = SessionLink | ChatLink | SettingsLink;

export type DeepLinkResult =
  | { readonly ok: true; readonly link: DeepLink }
  | { readonly ok: false; readonly error: string };

/* -------------------------------------------------------------------------- */
/* Validation shared by parse and build                                       */
/* -------------------------------------------------------------------------- */

function isSettingsPage(value: string): value is SettingsPage {
  return (SETTINGS_PAGES as readonly string[]).includes(value);
}

function checkId(value: string, what: string): string | null {
  if (value.length === 0) return `${what} cannot be empty`;
  if (value.length > MAX_ID_LENGTH) {
    return `${what} is longer than ${String(MAX_ID_LENGTH)} characters`;
  }
  if (!ID_PATTERN.test(value)) {
    return `${what} may only use letters, digits and . _ : - and must not start with . or -`;
  }
  return null;
}

function checkText(value: string): string | null {
  if (value.trim().length === 0) return "a chat link needs a non-blank text";
  if (value.length > MAX_TEXT_LENGTH) {
    return `the chat text is longer than ${String(MAX_TEXT_LENGTH)} characters`;
  }
  if (CONTROL_PATTERN.test(value)) return "the chat text contains a control character";
  return null;
}

/* -------------------------------------------------------------------------- */
/* Parse                                                                      */
/* -------------------------------------------------------------------------- */

function fail(error: string): DeepLinkResult {
  return { ok: false, error };
}

/**
 * Splits and percent-decodes a link path. An encoded `/` (`%2F`) decodes inside
 * its segment instead of becoming a separator, so an id that somehow contains
 * one is then refused by `checkId` rather than silently changing the shape.
 */
function segmentsOf(pathname: string): { ok: true; segments: string[] } | { ok: false; error: string } {
  const raw = pathname.startsWith("/") ? pathname.slice(1) : pathname;
  if (raw.length === 0) return { ok: true, segments: [] };
  const segments: string[] = [];
  for (const segment of raw.split("/")) {
    try {
      segments.push(decodeURIComponent(segment));
    } catch {
      return { ok: false, error: `the link path is not valid percent-encoding: ${JSON.stringify(segment)}` };
    }
  }
  return { ok: true, segments };
}

/** Refuses any query parameter the kind does not name, duplicates included. */
function queryKeys(url: URL, allowed: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const [key] of url.searchParams) {
    if (!allowed.includes(key)) {
      return `unknown link parameter ${JSON.stringify(key)}; ${SCHEME}://chat takes text and session`;
    }
    if (seen.has(key)) return `link parameter ${JSON.stringify(key)} is given twice`;
    seen.add(key);
  }
  return null;
}

function parseSession(url: URL): DeepLinkResult {
  if (url.search !== "") return fail("a session link takes no query parameters");
  const path = segmentsOf(url.pathname);
  if (!path.ok) return fail(path.error);
  if (path.segments.length === 0) return fail(`a session link needs an id: ${SCHEME}://session/<id>`);
  if (path.segments.length !== 1) {
    return fail(
      `a session link is ${SCHEME}://session/<id>; this one has ${String(path.segments.length)} path segments`,
    );
  }
  const id = path.segments[0] ?? "";
  const problem = checkId(id, "the session id");
  if (problem !== null) return fail(problem);
  return { ok: true, link: { kind: "session", params: { id } } };
}

function parseChat(url: URL): DeepLinkResult {
  if (url.pathname !== "" && url.pathname !== "/") {
    return fail(`a chat link has no path: ${SCHEME}://chat?text=…`);
  }
  const problem = queryKeys(url, ["text", "session"]);
  if (problem !== null) return fail(problem);

  const text = url.searchParams.get("text");
  if (text === null) return fail("a chat link needs a text: " + `${SCHEME}://chat?text=…`);
  const textProblem = checkText(text);
  if (textProblem !== null) return fail(textProblem);

  const session = url.searchParams.get("session");
  if (session === null) return { ok: true, link: { kind: "chat", params: { text } } };
  const idProblem = checkId(session, "the session id");
  if (idProblem !== null) return fail(idProblem);
  return { ok: true, link: { kind: "chat", params: { text, session } } };
}

function parseSettings(url: URL): DeepLinkResult {
  if (url.search !== "") return fail("a settings link takes no query parameters");
  const path = segmentsOf(url.pathname);
  if (!path.ok) return fail(path.error);
  if (path.segments.length === 0) return fail(`a settings link needs a page: ${SCHEME}://settings/<page>`);
  if (path.segments.length !== 1) {
    return fail(
      `a settings link is ${SCHEME}://settings/<page>; this one has ${String(path.segments.length)} path segments`,
    );
  }
  const page = path.segments[0] ?? "";
  if (!isSettingsPage(page)) {
    return fail(`unknown settings page ${JSON.stringify(page)}; known pages: ${SETTINGS_PAGES.join(", ")}`);
  }
  return { ok: true, link: { kind: "settings", params: { page } } };
}

/**
 * Parses one `roan://` link.
 *
 * The scheme and host are matched case-insensitively, as urls are; every other
 * part is exact. A link either has the documented shape or comes back as
 * `{ ok: false, error }` naming what is wrong — unknown scheme, unknown host,
 * unknown or repeated parameter, empty or malformed id, a page that is not in
 * `SETTINGS_PAGES`, or trailing path segments.
 */
export function parseDeepLink(input: string): DeepLinkResult {
  if (typeof input !== "string") return fail(`a deep link must be a string, got ${typeof input}`);
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return fail("that is not a valid url");
  }

  if (url.protocol !== `${SCHEME}:`) {
    return fail(
      `a Roan link starts with ${SCHEME}://, got ${JSON.stringify(url.protocol.replace(/:$/, ""))}`,
    );
  }
  if (url.hash !== "") return fail(`a Roan link takes no fragment, got ${JSON.stringify(url.hash)}`);

  const host = url.hostname.toLowerCase();
  if (host === "session") return parseSession(url);
  if (host === "chat") return parseChat(url);
  if (host === "settings") return parseSettings(url);
  if (host === "") {
    return fail(
      `a Roan link needs a host: ${SCHEME}://session/<id>, ${SCHEME}://chat?text=…, ${SCHEME}://settings/<page>`,
    );
  }
  return fail(`unknown Roan link host ${JSON.stringify(host)}; expected session, chat or settings`);
}

/* -------------------------------------------------------------------------- */
/* Build                                                                      */
/* -------------------------------------------------------------------------- */

function requireId(value: string, what: string): string {
  const problem = checkId(value, what);
  if (problem !== null) throw new Error(problem);
  return value;
}

/**
 * Builds the link for one of the three shapes, URL-encoding every value so it
 * survives {@link parseDeepLink}. The result is stable: the same input always
 * produces the same string.
 *
 * @throws Error naming the offending field when the input could not parse.
 */
export function buildDeepLink(link: DeepLink): string {
  switch (link.kind) {
    case "session":
      return `${SCHEME}://session/${encodeURIComponent(requireId(link.params.id, "the session id"))}`;
    case "chat": {
      const problem = checkText(link.params.text);
      if (problem !== null) throw new Error(problem);
      const params = new URLSearchParams({ text: link.params.text });
      if (link.params.session !== undefined) {
        params.set("session", requireId(link.params.session, "the session id"));
      }
      return `${SCHEME}://chat?${params.toString()}`;
    }
    case "settings": {
      const page = link.params.page;
      if (!isSettingsPage(page)) {
        throw new Error(
          `unknown settings page ${JSON.stringify(String(page))}; known pages: ${SETTINGS_PAGES.join(", ")}`,
        );
      }
      return `${SCHEME}://settings/${page}`;
    }
  }
}
