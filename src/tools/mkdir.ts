import { promises as fs } from "node:fs";
import path from "node:path";

/** Outcome of {@link mkdir}. */
export interface MkdirResult {
  /** Absolute path of the directory, with any symbolic links resolved. */
  path: string;
  /** Path relative to the root, with forward slashes. */
  relative: string;
  /** True if the directory was created in this call, false if it already existed. */
  created: boolean;
}

/** Options for {@link mkdir}; currently only an abort signal. */
export interface MkdirOptions {
  signal?: AbortSignal;
}

/** Reads the error code (`ENOENT`, `EACCES`, …) without reaching for `any`. */
function errorCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null || !("code" in err)) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/** True if `child` equals `root` or lies below it. */
function isWithin(root: string, child: string): boolean {
  if (child === root) return true;
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  // Compare case-sensitively the way the operating system does; on
  // Windows this is an approximation, on Linux it is exact.
  return child.startsWith(prefix);
}

/**
 * Resolves `absolute` to a real path, following symbolic links for the part
 * that already exists. Segments that do not exist yet are left as they are, so
 * that a directory still to be created keeps the same path.
 */
async function resolveReal(absolute: string): Promise<string> {
  const missing: string[] = [];
  let candidate = absolute;
  for (;;) {
    try {
      const real = await fs.realpath(candidate);
      return missing.length === 0 ? real : path.join(real, ...missing.slice().reverse());
    } catch {
      const parent = path.dirname(candidate);
      if (parent === candidate) return absolute;
      missing.push(path.basename(candidate));
      candidate = parent;
    }
  }
}

/**
 * Creates `target` as a directory, including all intermediate directories.
 *
 * - `root` is the working directory and must already exist; `target` is checked against it.
 * - Relative and absolute paths are allowed as long as they stay within `root`.
 *   A path that points outside via `..` or a symbolic link is rejected.
 * - Idempotent: an existing directory yields `created: false` without an error.
 * - If a file or a dangling symlink already exists at the path, an error follows;
 *   nothing is overwritten.
 *
 * @throws Error if `root` is not an existing directory, if `target` falls outside
 *   the root, or if the target path is blocked by a non-directory.
 */
export async function mkdir(
  root: string,
  target: string,
  options: MkdirOptions = {},
): Promise<MkdirResult> {
  options.signal?.throwIfAborted();

  if (typeof target !== "string" || target.includes("\0")) {
    throw new Error(`invalid path: ${JSON.stringify(target)}`);
  }
  if (typeof root !== "string" || root.trim() === "") {
    throw new Error("working directory is missing");
  }

  // The root must exist: without an existing root there is no boundary to
  // check against and a typo would silently create directories outside the working directory.
  let rootReal: string;
  try {
    rootReal = await fs.realpath(path.resolve(root));
  } catch {
    throw new Error(`working directory does not exist: ${path.resolve(root)}`);
  }
  const rootInfo = await fs.stat(rootReal);
  if (!rootInfo.isDirectory()) {
    throw new Error(`working directory is not a directory: ${rootReal}`);
  }

  const raw = target.trim() === "" ? "." : target;
  const lexical = path.resolve(rootReal, raw);
  if (!isWithin(rootReal, lexical)) {
    throw new Error(`path "${target}" falls outside the working directory ${rootReal}`);
  }

  // The deepest existing part may be a symbolic link pointing outside; that is why
  // we check the real path and not just the lexical form.
  const resolved = await resolveReal(lexical);
  if (!isWithin(rootReal, resolved)) {
    throw new Error(`path "${target}" points outside the working directory ${rootReal} via a symbolic link`);
  }

  let exists = true;
  try {
    await fs.lstat(resolved);
  } catch (err) {
    if (errorCode(err) !== "ENOENT") throw err;
    exists = false;
  }

  let created = false;
  if (exists) {
    // An existing target may only be a directory (or a link to one).
    let isDirectory = false;
    try {
      isDirectory = (await fs.stat(resolved)).isDirectory();
    } catch (err) {
      if (errorCode(err) !== "ENOENT") throw err;
      throw new Error(`target is a dangling symbolic link: ${resolved}`);
    }
    if (!isDirectory) throw new Error(`target already exists and is not a directory: ${resolved}`);
  } else {
    options.signal?.throwIfAborted();
    await fs.mkdir(resolved, { recursive: true });
    created = true;
  }

  const relative = path.relative(rootReal, resolved).split(path.sep).join("/") || ".";
  return { path: resolved, relative, created };
}
