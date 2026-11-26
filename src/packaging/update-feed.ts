/**
 * The update feed as the app reads it: one `latest.json` document naming a
 * version, release notes, the bundle URL and the bundle's SHA-256.
 *
 * `updater.ts` owns what a single feed entry may contain; this module owns the
 * document around it and the trip over the network. The parser is pure and
 * takes text or an already-parsed value, so it is usable from a test, a
 * script, or a webview without touching the filesystem. `fetchUpdateFeed` is
 * the one place that talks HTTP, and it never confuses "the feed says you are
 * current" with "the feed could not be read": the first is an entry, the
 * second throws an `UpdateFeedError` whose `kind` says which failure it was.
 *
 * No node-only imports live here on purpose; the shared parser and compare
 * rules have to stay usable outside the daemon.
 */

import { compareVersions, type VersionOrdering } from "./semver.js";
import { parseFeedEntry, type FeedEntry } from "./updater.js";

/** A feed larger than this is not a feed; stop before it fills memory. */
export const MAX_FEED_CHARS = 64 * 1024;

/** Default network budget for one feed read. */
export const DEFAULT_FEED_TIMEOUT_MS = 10_000;

/**
 * Why a feed read produced no entry:
 * - `unreachable`: DNS, connection, timeout, or a non-2xx answer. The app has
 *   no answer and must say so.
 * - `invalid`: something answered, but it is not our document (bad JSON, an
 *   unknown field, a value that fails validation).
 */
export type UpdateFeedErrorKind = "unreachable" | "invalid";

/** A feed read that produced no entry; `kind` is the honest distinction. */
export class UpdateFeedError extends Error {
  readonly kind: UpdateFeedErrorKind;

  constructor(kind: UpdateFeedErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "UpdateFeedError";
    this.kind = kind;
  }
}

export interface FeedFetchOptions {
  /** Injected in tests; defaults to the runtime's global `fetch`. */
  readonly fetchImpl?: typeof fetch;
  /** Milliseconds before the read is abandoned. Defaults to 10 s. */
  readonly timeoutMs?: number;
}

/** One short reason from an arbitrary thrown value. */
function reasonOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Parse an already-decoded feed document.
 *
 * `notes` and `mandatory` may be omitted (same defaults as `parseFeedEntry`);
 * `version`, `url` and `sha256` must be present.
 *
 * @throws UpdateFeedError with kind `invalid` when the document is not one
 *   feed entry; the message carries the offending field and value.
 */
export function parseUpdateFeed(input: unknown): FeedEntry {
  try {
    return parseFeedEntry(input);
  } catch (error) {
    throw new UpdateFeedError("invalid", `update feed is invalid: ${reasonOf(error)}`);
  }
}

/**
 * Parse the bytes of `latest.json`.
 *
 * @throws UpdateFeedError with kind `invalid` when the text is not JSON or the
 *   decoded value is not one feed entry.
 */
export function parseUpdateFeedText(text: string): FeedEntry {
  if (typeof text !== "string") {
    throw new UpdateFeedError("invalid", `update feed must be text, got ${typeof text}`);
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch (error) {
    throw new UpdateFeedError("invalid", `update feed is not valid JSON: ${reasonOf(error)}`);
  }
  return parseUpdateFeed(decoded);
}

/** Which side of the installed version a feed entry sits on. */
export function compareFeedToVersion(feed: FeedEntry, currentVersion: string): VersionOrdering {
  return compareVersions(feed.version, currentVersion);
}

/**
 * Read and validate the feed at `feedUrl`.
 *
 * Any failure to get an answer is `unreachable`; any answer that is not a
 * valid feed is `invalid`. Both throw rather than returning null, because
 * "no update" is a real answer and this function never invents one.
 *
 * @throws UpdateFeedError naming the URL and the reason.
 */
export async function fetchUpdateFeed(
  feedUrl: string,
  options: FeedFetchOptions = {},
): Promise<FeedEntry> {
  if (typeof feedUrl !== "string" || feedUrl === "") {
    throw new UpdateFeedError("invalid", `feed url must be a non-empty string, got ${typeof feedUrl}`);
  }

  let parsed: URL;
  try {
    parsed = new URL(feedUrl);
  } catch {
    throw new UpdateFeedError("invalid", `feed url is not a valid URL: ${JSON.stringify(feedUrl)}`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new UpdateFeedError("invalid", `feed url must be http or https, got ${parsed.protocol}`);
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_FEED_TIMEOUT_MS;

  let response: Response;
  try {
    response = await fetchImpl(parsed.toString(), {
      headers: { accept: "application/json" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new UpdateFeedError(
      "unreachable",
      `could not reach the update feed at ${parsed.toString()}: ${reasonOf(error)}`,
      { cause: error },
    );
  }

  if (!response.ok) {
    throw new UpdateFeedError(
      "unreachable",
      `update feed at ${parsed.toString()} answered HTTP ${response.status}`,
    );
  }

  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    throw new UpdateFeedError(
      "unreachable",
      `could not read the update feed from ${parsed.toString()}: ${reasonOf(error)}`,
      { cause: error },
    );
  }

  if (text.length > MAX_FEED_CHARS) {
    throw new UpdateFeedError(
      "invalid",
      `update feed is ${text.length} characters, more than the ${MAX_FEED_CHARS} allowed`,
    );
  }
  return parseUpdateFeedText(text);
}
