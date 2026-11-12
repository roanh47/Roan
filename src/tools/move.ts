import { promises as fs } from "node:fs";
import path from "node:path";
import { isInsideWorkspace } from "./policy.js";

/**
 * Moving and renaming inside one workspace.
 *
 * The rules, in order:
 * - both paths must resolve inside the workspace, also after following symlinks;
 * - the source must exist;
 * - the destination must not exist, not even as a dangling symlink, so a move
 *   never replaces anything;
 * - the destination's parent directory must already exist, so a typo does not
 *   silently create a tree;
 * - the workspace root itself is never moved, and a directory is never moved
 *   into its own subtree.
 *
 * Only `rename(2)` is used. Both paths are inside one workspace, so that is a
 * single atomic operation; a cross-filesystem move (`EXDEV`, possible when the
 * workspace contains a mount) is refused rather than emulated with copy+delete,
 * because a half-finished copy would break the never-overwrite rule.
 */

/** Options for {@link movePath}; all fields are optional. */
export interface MoveOptions {
  /** Directory the move may not leave. Defaults to `process.cwd()`. */
  root?: string;
}

/** What was moved, as far as the source told us. */
export type MoveKind = "file" | "directory" | "symlink";

/** Result of a successful {@link movePath} call. */
export interface MoveResult {
  /** Source path relative to the root, with `/` separators. */
  from: string;
  /** Destination path relative to the root, with `/` separators. */
  to: string;
  /** Kind of the moved entry, taken from the source's `lstat`. */
  kind: MoveKind;
}

function errorCode(cause: unknown): string | undefined {
  if (typeof cause !== "object" || cause === null || !("code" in cause)) return undefined;
  const code = (cause as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Root-relative path for messages and results; `.` for the root itself. */
function displayPath(root: string, absolute: string): string {
  const relative = path.relative(root, absolute);
  if (relative === "") return ".";
  return relative.split(path.sep).join("/");
}

function isWithin(root: string, candidate: string): boolean {
  if (candidate === root) return true;
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return candidate.startsWith(prefix);
}

/**
 * Moves or renames one entry inside `options.root` (default `process.cwd()`).
 *
 * `source` and `destination` are resolved against the root; a relative path that
 * climbs out with `..`, an absolute path elsewhere, or a symlink whose target
 * lies outside the workspace is refused with an `Error` naming the path and the
 * root. Nothing is written before every check has passed.
 *
 * @throws Error when a path is empty or outside the root, the source is missing,
 *   the destination already exists, the destination's parent is missing, or the
 *   underlying rename fails (the failing path is named in the message).
 */
export async function movePath(
  source: string,
  destination: string,
  options: MoveOptions = {},
): Promise<MoveResult> {
  if (source.trim() === "") throw new Error("move: source path is empty");
  if (destination.trim() === "") throw new Error("move: destination path is empty");

  const rootInput = options.root ?? process.cwd();
  if (rootInput.trim() === "") throw new Error("move: workspace root is empty");
  const root = path.resolve(rootInput);

  if (!isInsideWorkspace(root, source)) {
    throw new Error(`move: source "${source}" is outside the workspace ${root}`);
  }
  if (!isInsideWorkspace(root, destination)) {
    throw new Error(`move: destination "${destination}" is outside the workspace ${root}`);
  }

  const fromAbsolute = path.resolve(root, source);
  const toAbsolute = path.resolve(root, destination);

  if (fromAbsolute === root) {
    throw new Error(`move: refusing to move the workspace root ${root}`);
  }

  let sourceStat;
  try {
    sourceStat = await fs.lstat(fromAbsolute);
  } catch (cause) {
    const code = errorCode(cause);
    if (code === "ENOENT" || code === "ENOTDIR") {
      throw new Error(`move: source does not exist: ${displayPath(root, fromAbsolute)}`);
    }
    throw new Error(
      `move: could not inspect source "${displayPath(root, fromAbsolute)}": ${describeError(cause)}`,
    );
  }

  if (fromAbsolute === toAbsolute) {
    throw new Error(
      `move: source and destination are the same path: ${displayPath(root, fromAbsolute)}`,
    );
  }

  if (sourceStat.isDirectory() && isWithin(fromAbsolute, toAbsolute)) {
    throw new Error(
      `move: cannot move directory "${displayPath(root, fromAbsolute)}" inside itself ` +
        `(${displayPath(root, toAbsolute)})`,
    );
  }

  let destinationExists: boolean;
  try {
    await fs.lstat(toAbsolute);
    destinationExists = true;
  } catch (cause) {
    const code = errorCode(cause);
    if (code === "ENOENT" || code === "ENOTDIR") {
      destinationExists = false;
    } else {
      throw new Error(
        `move: could not inspect destination "${displayPath(root, toAbsolute)}": ${describeError(cause)}`,
      );
    }
  }
  if (destinationExists) {
    throw new Error(`move: refusing to overwrite existing path: ${displayPath(root, toAbsolute)}`);
  }

  const parent = path.dirname(toAbsolute);
  let parentStat;
  try {
    parentStat = await fs.stat(parent);
  } catch (cause) {
    const code = errorCode(cause);
    if (code === "ENOENT" || code === "ENOTDIR") {
      throw new Error(
        `move: destination directory does not exist: ${displayPath(root, parent)}`,
      );
    }
    throw new Error(
      `move: could not inspect destination directory "${displayPath(root, parent)}": ` +
        describeError(cause),
    );
  }
  if (!parentStat.isDirectory()) {
    throw new Error(`move: destination parent is not a directory: ${displayPath(root, parent)}`);
  }

  const kind: MoveKind = sourceStat.isSymbolicLink()
    ? "symlink"
    : sourceStat.isDirectory()
      ? "directory"
      : "file";

  try {
    await fs.rename(fromAbsolute, toAbsolute);
  } catch (cause) {
    const code = errorCode(cause);
    if (code === "EXDEV") {
      throw new Error(
        `move: "${displayPath(root, fromAbsolute)}" and "${displayPath(root, toAbsolute)}" ` +
          "are on different filesystems; nothing was moved",
      );
    }
    if (code === "EEXIST" || code === "ENOTEMPTY") {
      throw new Error(`move: refusing to overwrite existing path: ${displayPath(root, toAbsolute)}`);
    }
    throw new Error(
      `move: could not move "${displayPath(root, fromAbsolute)}" to ` +
        `"${displayPath(root, toAbsolute)}": ${describeError(cause)}`,
    );
  }

  return {
    from: displayPath(root, fromAbsolute),
    to: displayPath(root, toAbsolute),
    kind,
  };
}
