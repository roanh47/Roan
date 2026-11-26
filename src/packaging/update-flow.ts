/**
 * One call from "check for an update" to "here is the file, or here is the
 * reason there is nothing to do".
 *
 * Two update paths live here, and they are not interchangeable:
 *
 * - `checkAndPrepareUpdate` reads a self-hosted `latest.json` feed. It predates
 *   the public repository and stays because the feed parser and downloader are
 *   still exercised; nothing calls it.
 * - `checkGithubAndPrepareUpdate` reads the public GitHub release, which is
 *   what a shipped build actually ships with. It is the function the daemon's
 *   update surface calls.
 *
 * The GitHub path is deliberately one composition rather than four: the check,
 * the platform plan and the download must agree, and a caller that assembles
 * them by hand can download a Windows installer onto Linux. The result carries
 * all three so a UI can show what was decided even when the download failed.
 */

import { prepareUpdate, type DownloadOptions, type UpdateDecision } from "./bundle-download.js";
import {
  checkGithubRelease,
  downloadAndVerify,
  downloadPathFor,
  planGithubUpdate,
  type DownloadOutcome,
  type GithubCheckOptions,
  type GithubCheckResult,
  type LocalTarget,
  type UpdatePlan,
} from "./github-releases.js";
import { fetchUpdateFeed, type FeedFetchOptions } from "./update-feed.js";

export type UpdateFlowOptions = FeedFetchOptions & DownloadOptions;

/**
 * Read `feedUrl`, then decide and (when newer) download + verify the bundle.
 *
 * A feed that cannot be read rejects with `UpdateFeedError`; a bundle that
 * cannot be fetched or does not match its digest rejects with the downloader's
 * error. "No update" is a returned `current`/`older` decision, never a throw.
 */
export async function checkAndPrepareUpdate(
  feedUrl: string,
  currentVersion: string,
  options: UpdateFlowOptions = {},
): Promise<UpdateDecision> {
  const entry = await fetchUpdateFeed(feedUrl, options);
  return prepareUpdate(entry, currentVersion, options);
}

export interface GithubUpdateFlowOptions extends GithubCheckOptions {
  /** Where the installer is written. Defaults to a fixed temp directory. */
  readonly dir?: string;
  /** Ceiling for the downloaded installer, in bytes. */
  readonly maxBytes?: number;
  /** Budget for the installer transfer; separate from the check's budget. */
  readonly downloadTimeoutMs?: number;
  /** Set false to decide without downloading (a check-only preview). */
  readonly download?: boolean;
  /** Known writable state of the running executable, passed to the plan. */
  readonly executablePath?: string;
  readonly executableWritable?: boolean;
}

export interface GithubUpdateFlowResult {
  /** What GitHub said, unchanged, so the caller can render it. */
  readonly check: GithubCheckResult;
  /** What to do next, with the notes a person reads. */
  readonly plan: UpdatePlan;
  /**
   * The verified file, or the reason it is not there. Null when the plan had
   * nothing to fetch or the caller asked not to download.
   */
  readonly download: DownloadOutcome | null;
}

/** A stable directory for downloaded installers; `mkdtemp` would leak one per check. */
function defaultDownloadDir(): string {
  const base = process.env["TMPDIR"] ?? process.env["TEMP"] ?? process.env["TMP"] ?? "/tmp";
  return `${base.replace(/[\\/]+$/, "")}/roan-update`;
}

/**
 * Check GitHub, decide, and (for platforms where a file can be installed)
 * download and verify the artefact.
 *
 * Never rejects: `checkGithubRelease` returns its failures as values and
 * `downloadAndVerify` does the same, so a caller can render an update card
 * without a try/catch. A failed download is not hidden: the plan's notes gain
 * the reason, because "there is an update" and "the update is here" are
 * different claims.
 */
export async function checkGithubAndPrepareUpdate(
  options: GithubUpdateFlowOptions,
): Promise<GithubUpdateFlowResult> {
  const check = await checkGithubRelease(options);
  const target: LocalTarget = {
    platform: options.platform,
    arch: options.arch,
    ...(options.executablePath === undefined ? {} : { executablePath: options.executablePath }),
    ...(options.executableWritable === undefined
      ? {}
      : { executableWritable: options.executableWritable }),
  };
  const plan = planGithubUpdate(check, target);

  if (plan.url === null || options.download === false) {
    return { check, plan, download: null };
  }

  const name = check.kind === "update" ? check.asset.name : "update";
  const dir = options.dir ?? defaultDownloadDir();
  const outcome = await downloadAndVerify({
    url: plan.url,
    dest: downloadPathFor(dir, name),
    ...(options.fetchImpl === undefined ? {} : { fetch: options.fetchImpl }),
    ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
    ...(options.downloadTimeoutMs === undefined
      ? {}
      : { timeoutMs: options.downloadTimeoutMs }),
    ...(check.kind === "update" && check.asset.sha256 !== undefined
      ? { sha256: check.asset.sha256 }
      : {}),
  });

  if (!outcome.ok) {
    return {
      check,
      plan: { ...plan, notes: [...plan.notes, `Download failed: ${outcome.reason}`] },
      download: outcome,
    };
  }
  return { check, plan, download: outcome };
}
