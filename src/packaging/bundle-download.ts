/**
 * Fetch one update bundle to a temporary directory, prove its bytes are the
 * bytes the feed named, and hand the path to whatever installs on this
 * platform.
 *
 * The order is deliberate: download to a private temp dir, hash while writing,
 * compare only after the last byte, and delete the file when anything fails.
 * A bundle whose digest does not match never reaches the installer, and a
 * failed download leaves no half file behind that a later run might trust.
 *
 * `prepareUpdate` is the decision seam: it compares the feed entry with the
 * running version first and only downloads when the feed is actually newer.
 * The result carries the verified path, which is what the platform installer
 * (NSIS, AppImage, APK) consumes; installing is not this module's job.
 */

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, open, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { compareVersions } from "./semver.js";
import type { FeedEntry } from "./updater.js";

/** Lower-case hex SHA-256 only, matching the feed validator. */
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** Default network budget for a bundle; bundles are large, so this is generous. */
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 120_000;

export interface DownloadedBundle {
  /** Absolute path inside the temp directory the caller supplied or got. */
  readonly path: string;
  /** Bytes written, which equals the digest input. */
  readonly bytes: number;
  /** Lower-case hex SHA-256 of the bytes, equal to the feed's value on success. */
  readonly sha256: string;
}

export interface DownloadOptions {
  /** Directory to write into; a fresh `mkdtemp` directory is used when omitted. */
  readonly dir?: string;
  /** Injected in tests; defaults to the runtime's global `fetch`. */
  readonly fetchImpl?: typeof fetch;
  /** Milliseconds before the transfer is abandoned. Defaults to 120 s. */
  readonly timeoutMs?: number;
  /** Override the file name derived from the URL's last path segment. */
  readonly fileName?: string;
}

/**
 * What `prepareUpdate` decided:
 * - `current`: the feed names the version that is running (or an invalid
 *   comparison never happened because it is equal);
 * - `older`: the feed is behind the running version, which is not an update;
 * - `ready`: a newer bundle was downloaded and verified; `bundle.path` is what
 *   the installer gets.
 */
export type UpdateDecision =
  | { readonly state: "current"; readonly entry: FeedEntry }
  | { readonly state: "older"; readonly entry: FeedEntry }
  | { readonly state: "ready"; readonly entry: FeedEntry; readonly bundle: DownloadedBundle };

/** One short reason from an arbitrary thrown value. */
function reasonOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Require an http(s) URL with a host before any request is attempted. */
function parseBundleUrl(raw: string): URL {
  if (typeof raw !== "string" || raw === "") {
    throw new Error(`bundle url must be a non-empty string, got ${typeof raw}`);
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`bundle url is not a valid URL: ${JSON.stringify(raw)}`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`bundle url must be http or https, got ${parsed.protocol}`);
  }
  if (parsed.hostname === "") {
    throw new Error(`bundle url must name a host, got ${JSON.stringify(raw)}`);
  }
  return parsed;
}

/** The digest rule is the feed's rule, restated here so the downloader never trusts it. */
function assertSha256(value: string): void {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new Error(`expected sha256 must be 64 lower-case hex characters, got ${JSON.stringify(value)}`);
  }
}

/**
 * A safe file name from the URL's last path segment: decoding may fail, and a
 * name that survives decoding is reduced to a plain, separator-free file name.
 */
function bundleFileName(url: URL): string {
  const last = url.pathname.split("/").pop() ?? "";
  let decoded = last;
  try {
    decoded = decodeURIComponent(last);
  } catch {
    // Keep the undecoded segment; it is still safer than an empty name.
  }
  const cleaned = basename(decoded).replace(/[^A-Za-z0-9._-]/g, "_");
  return cleaned === "" || cleaned === "." || cleaned === ".." ? "bundle" : cleaned;
}

/** Delete a file whose bytes we do not trust; a missing file is fine. */
async function discard(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // Already gone or never created; the caller gets the original failure.
  }
}

/**
 * Download `url` into a temp directory and verify it against `expectedSha256`.
 *
 * The digest is computed over the bytes as they are written, so there is no
 * second read and no window where an unverified file sits at the returned
 * path. On a mismatch, an HTTP error, a broken stream or a timeout the partial
 * file is deleted and the promise rejects.
 *
 * @throws Error naming the URL/status when the request fails, and naming both
 *   expected and actual digests when verification fails.
 */
export async function downloadBundle(
  url: string,
  expectedSha256: string,
  options: DownloadOptions = {},
): Promise<DownloadedBundle> {
  const parsed = parseBundleUrl(url);
  assertSha256(expectedSha256);

  const dir = options.dir ?? (await mkdtemp(join(tmpdir(), "roan-update-")));
  await mkdir(dir, { recursive: true });
  const path = join(dir, options.fileName ?? bundleFileName(parsed));
  const fetchImpl = options.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await fetchImpl(parsed.toString(), {
      redirect: "follow",
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`could not download ${parsed.toString()}: ${reasonOf(error)}`, { cause: error });
  }

  if (!response.ok) {
    throw new Error(`download of ${parsed.toString()} failed: HTTP ${response.status}`);
  }
  if (response.body === null) {
    throw new Error(`download of ${parsed.toString()} returned no body`);
  }

  const handle = await open(path, "w");
  const hash = createHash("sha256");
  let bytes = 0;

  try {
    const reader = response.body.getReader();
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const value = chunk.value;
      if (value === undefined) continue;
      bytes += value.byteLength;
      hash.update(value);
      await handle.writeFile(value);
    }
  } catch (error) {
    await handle.close();
    await discard(path);
    throw new Error(`could not write update bundle to ${path}: ${reasonOf(error)}`, { cause: error });
  }

  await handle.close();
  const sha256 = hash.digest("hex");

  if (sha256 !== expectedSha256) {
    await discard(path);
    throw new Error(
      `update bundle sha256 mismatch: expected ${expectedSha256}, got ${sha256} (${path})`,
    );
  }

  return { path, bytes, sha256 };
}

/**
 * Compare a validated feed entry with the running version and, only when the
 * feed is newer, download and verify the bundle.
 *
 * @throws Error from `downloadBundle` when the bundle cannot be fetched or
 *   does not match its digest. Version parsing errors from `compareVersions`
 *   also propagate, so a malformed running version is visible rather than
 *   treated as "current".
 */
export async function prepareUpdate(
  feed: FeedEntry,
  currentVersion: string,
  options: DownloadOptions = {},
): Promise<UpdateDecision> {
  const order = compareVersions(feed.version, currentVersion);
  if (order === 0) return { state: "current", entry: feed };
  if (order < 0) return { state: "older", entry: feed };

  const bundle = await downloadBundle(feed.url, feed.sha256, options);
  return { state: "ready", entry: feed, bundle };
}
