/**
 * One call from "there is a feed URL" to "here is the verified bundle for the
 * installer": fetch and parse `latest.json`, compare it with the running
 * version, and download only when it is newer.
 *
 * The pieces stay separate (`update-feed.ts`, `bundle-download.ts`) so a
 * caller that already holds an entry, or one that wants to decide without
 * downloading, can use them directly. This module is only the composition.
 */

import { prepareUpdate, type DownloadOptions, type UpdateDecision } from "./bundle-download.js";
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
