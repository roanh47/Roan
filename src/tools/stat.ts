import { promises as fs } from "node:fs";

/**
 * Metadata for one path, as returned by a successful `stat`.
 *
 * `stat` follows symlinks: a symlink to a directory reports `isDirectory: true`
 * and the target's size, mtime and mode. A dangling symlink therefore fails
 * with the underlying `ENOENT` and is reported as a per-entry error.
 */
export interface StatEntry {
  /** The path exactly as it was passed in. */
  path: string;
  /** Size in bytes as reported by `stat` (directories normally report their own, not their contents). */
  size: number;
  /** Last modification time as an ISO 8601 string (UTC). */
  mtime: string;
  /** The same instant in milliseconds since the epoch, for sorting or arithmetic. */
  mtimeMs: number;
  /**
   * Raw `stat` mode, including the file-type bits (e.g. `0o100644` for a regular
   * file). On Windows only the read-only bit is meaningful.
   */
  mode: number;
  /** The permission bits of `mode` as three or four octal digits, e.g. `"644"`. */
  modeString: string;
  /** True for a directory (after following symlinks). */
  isDirectory: boolean;
}

/** Per-path outcome of a {@link statMany} call. */
export type StatResult =
  | ({ ok: true } & StatEntry)
  | { path: string; ok: false; error: string };

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Permission bits only, so the type bits do not leak into the display value. */
function octalMode(mode: number): string {
  return (mode & 0o777).toString(8).padStart(3, "0");
}

/**
 * Stats every path and returns one entry per input, in input order.
 *
 * - A missing, unreadable or otherwise bad path yields `{ ok: false, error }`
 *   with the path echoed back; the other paths are still statted. Nothing is
 *   thrown, even if a path is not a string at runtime.
 * - Duplicates are not collapsed: two identical inputs produce two entries.
 * - Entries are statted one at a time, so the order of `results` always lines up
 *   with `paths` and a huge list does not open a huge number of descriptors.
 */
export async function statMany(paths: readonly string[]): Promise<StatResult[]> {
  const results: StatResult[] = [];
  for (const input of paths) {
    if (typeof input !== "string" || input.length === 0) {
      results.push({
        path: String(input),
        ok: false,
        error: `invalid path: ${JSON.stringify(input)}`,
      });
      continue;
    }
    try {
      const info = await fs.stat(input);
      results.push({
        path: input,
        ok: true,
        size: info.size,
        mtime: info.mtime.toISOString(),
        mtimeMs: Math.round(info.mtimeMs),
        mode: info.mode,
        modeString: octalMode(info.mode),
        isDirectory: info.isDirectory(),
      });
    } catch (cause) {
      results.push({ path: input, ok: false, error: errorText(cause) });
    }
  }
  return results;
}
