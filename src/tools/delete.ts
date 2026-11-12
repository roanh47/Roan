import { promises as fs } from "node:fs";
import path from "node:path";
import type { Tool } from "../types.js";

/** Options for {@link deletePath}. */
export interface DeleteOptions {
  /** Workspace root; the target is resolved against it. */
  cwd: string;
  /** Must be exactly `true`; anything else is refused before touching the disk. */
  confirm: boolean;
}

/** What was removed. */
export type DeleteKind = "file" | "directory";

/** Result of a successful {@link deletePath}. */
export interface DeleteResult {
  /** Path relative to the workspace, with forward slashes. */
  path: string;
  kind: DeleteKind;
}

/**
 * Directories that may never be deleted, at any depth. Mirrors the protected
 * names in `policy.ts`: the policy gate denies them too, but a delete that is
 * reachable outside the registry must not depend on that gate alone.
 */
const PROTECTED_DIRS: ReadonlySet<string> = new Set(["secrets", ".ssh", ".gnupg"]);

function isWithin(root: string, target: string): boolean {
  if (target === root) return true;
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return target.startsWith(prefix);
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Resolves `target` to an absolute path inside `root`.
 *
 * The parent directory is resolved with `realpath`, so a symlinked parent
 * cannot point the delete outside the workspace. The final component is kept
 * unresolved on purpose: a symlink is deleted as a link, never followed.
 */
async function resolveTarget(root: string, target: string): Promise<{ full: string; relative: string }> {
  if (typeof target !== "string" || target.trim() === "") {
    throw new Error("delete: path is required");
  }

  const absolute = path.resolve(root, target);
  if (absolute === root) {
    throw new Error("delete: refusing to delete the workspace root");
  }

  let parentReal: string;
  try {
    parentReal = await fs.realpath(path.dirname(absolute));
  } catch (cause) {
    throw new Error(`delete: parent directory of "${target}" does not exist (${errorText(cause)})`);
  }

  if (!isWithin(root, parentReal)) {
    throw new Error(`delete: path "${target}" escapes the workspace ${root}`);
  }

  const full = path.join(parentReal, path.basename(absolute));
  const relative = path.relative(root, full);
  if (relative === "") {
    throw new Error("delete: refusing to delete the workspace root");
  }
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`delete: path "${target}" escapes the workspace ${root}`);
  }

  const segments = relative.split(path.sep).filter((segment) => segment !== "");
  for (const segment of segments) {
    if (PROTECTED_DIRS.has(segment.toLowerCase())) {
      throw new Error(`delete: path "${target}" is inside protected directory "${segment}"`);
    }
  }

  return { full, relative: segments.join("/") };
}

/**
 * Deletes one file or one *empty* directory inside the workspace.
 *
 * - `confirm` must be `true`; without it nothing is resolved or removed.
 * - Paths outside the workspace, paths under `secrets/` (also `.ssh/`, `.gnupg/`)
 *   and the workspace root itself are refused.
 * - Directories are only removed when empty; there is no recursive delete here,
 *   so a mistake can never wipe a tree.
 * - Symlinks are removed as links; their targets are not touched.
 *
 * @throws Error naming the path whenever the target is refused or missing.
 */
export async function deletePath(target: string, options: DeleteOptions): Promise<DeleteResult> {
  if (options.confirm !== true) {
    throw new Error(
      `delete: "${String(target)}" requires an explicit confirmation (confirm: true); nothing was deleted`,
    );
  }

  const root = await fs.realpath(path.resolve(options.cwd)).catch(() => path.resolve(options.cwd));
  const { full, relative } = await resolveTarget(root, String(target));

  let info;
  try {
    info = await fs.lstat(full);
  } catch (cause) {
    throw new Error(`delete: "${relative}" does not exist (${errorText(cause)})`);
  }

  if (info.isSymbolicLink() || info.isFile()) {
    await fs.unlink(full);
    return { path: relative, kind: "file" };
  }

  if (info.isDirectory()) {
    const entries = await fs.readdir(full);
    if (entries.length > 0) {
      throw new Error(
        `delete: directory "${relative}" is not empty (${entries.length} entries); empty it first`,
      );
    }
    await fs.rmdir(full);
    return { path: relative, kind: "directory" };
  }

  throw new Error(`delete: "${relative}" is not a regular file or directory`);
}

/** Tool wrapper for {@link deletePath}; the model must pass `confirm: true`. */
export const deleteTool: Tool = {
  name: "delete_file",
  description:
    "Delete one file or one empty directory inside the workspace. Requires confirm: true. " +
    "Never deletes recursively, never touches secrets/ and never leaves the workspace.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path relative to the workspace" },
      confirm: {
        type: "boolean",
        description: "Must be true; without it the call is refused and nothing is deleted",
      },
    },
    required: ["path", "confirm"],
  },
  async run(args, ctx) {
    if (ctx.signal?.aborted === true) {
      throw new Error("delete: turn was cancelled; nothing was deleted");
    }
    const result = await deletePath(String(args["path"] ?? ""), {
      cwd: ctx.cwd,
      confirm: args["confirm"] === true,
    });
    return `deleted ${result.kind}: ${result.path}`;
  },
};
