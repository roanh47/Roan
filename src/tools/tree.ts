import { promises as fs } from "node:fs";
import path from "node:path";

/** Options for {@link listTree}; everything is optional. */
export interface TreeOptions {
  /** Number of levels below the root that are shown (default 3). */
  depth?: number;
  /** Hard upper bound on the number of lines shown (default 500). */
  maxEntries?: number;
}

/** Result of {@link listTree}. */
export interface TreeResult {
  /** The tree as plain text, lines separated by "\n". */
  text: string;
  /** Number of items shown, excluding the root line. */
  entries: number;
  /** True as soon as the walk was stopped by the limit. */
  truncated: boolean;
}

const DEFAULT_DEPTH = 3;
const DEFAULT_MAX_ENTRIES = 500;
const DEPTH_CEILING = 32;

const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", ".cache"]);
const ALLOWED_DOTFILES = new Set([".env.example"]);

const BRANCH = "|-- ";
const LAST_BRANCH = "`-- ";
const INDENT = "|   ";
const LAST_INDENT = "    ";

interface Child {
  name: string;
  isDirectory: boolean;
}

interface WalkState {
  lines: string[];
  entries: number;
  maxEntries: number;
  depth: number;
  truncated: boolean;
}

function isHidden(name: string): boolean {
  return name.startsWith(".") && !ALLOWED_DOTFILES.has(name);
}

function compareChildren(a: Child, b: Child): number {
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
  return a.name.localeCompare(b.name);
}

function toCount(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

/** Reads a directory and returns only the visible, non-ignored items, sorted. */
async function readChildren(dir: string): Promise<Child[]> {
  let dirents;
  try {
    dirents = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const children: Child[] = [];
  for (const dirent of dirents) {
    const name = dirent.name;
    if (isHidden(name)) continue;
    const isDirectory = dirent.isDirectory();
    if (isDirectory && IGNORED_DIRS.has(name)) continue;
    children.push({ name, isDirectory });
  }
  return children.sort(compareChildren);
}

async function walk(dir: string, level: number, prefix: string, state: WalkState): Promise<void> {
  const children = await readChildren(dir);
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child === undefined) continue;
    if (state.entries >= state.maxEntries) {
      state.truncated = true;
      return;
    }
    const isLast = index === children.length - 1;
    state.entries += 1;
    state.lines.push(`${prefix}${isLast ? LAST_BRANCH : BRANCH}${child.name}${child.isDirectory ? "/" : ""}`);
    if (!child.isDirectory || level >= state.depth) continue;
    await walk(
      path.join(dir, child.name),
      level + 1,
      `${prefix}${isLast ? LAST_INDENT : INDENT}`,
      state,
    );
    if (state.truncated) return;
  }
}

/**
 * Builds a compact, indented tree view of `root`.
 *
 * - node_modules, .git, dist and .cache are always skipped, as are dotfiles
 *   (except .env.example).
 * - Directories get a "/" and sort before files; both with localeCompare.
 * - On reaching `maxEntries` the walk stops and `truncated` is true.
 * - Symbolic links are not followed (and are therefore shown as a file), so
 *   circular references are impossible.
 *
 * @throws Error when `root` is not an existing directory; the message contains the path.
 */
export async function listTree(root: string, options: TreeOptions = {}): Promise<TreeResult> {
  const target = path.resolve(root);
  let isDirectory = false;
  try {
    isDirectory = (await fs.stat(target)).isDirectory();
  } catch {
    isDirectory = false;
  }
  if (!isDirectory) throw new Error(`not a directory: ${target}`);

  const state: WalkState = {
    lines: [`${target}/`],
    entries: 0,
    maxEntries: toCount(options.maxEntries, DEFAULT_MAX_ENTRIES),
    depth: Math.min(toCount(options.depth, DEFAULT_DEPTH), DEPTH_CEILING),
    truncated: false,
  };

  if (state.depth > 0) await walk(target, 1, "", state);

  return {
    text: state.lines.join("\n"),
    entries: state.entries,
    truncated: state.truncated,
  };
}
