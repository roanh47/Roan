import { promises as fs } from "node:fs";
import type { Dirent } from "node:fs";
import path from "node:path";

export interface GlobOptions {
  limit?: number;
}

/** Hard upper bound, regardless of what the caller asks for. */
const MAX_RESULTS = 500;

/** Directories we never enter: too large and never interesting to the agent. */
const IGNORED_DIRS = new Set(["node_modules", ".git"]);

const segmentCache = new Map<string, RegExp>();

/**
 * One glob segment (`*` and `?`, no `/`) to a regex.
 * The result is cached: patterns often repeat per directory.
 */
function segmentToRegExp(segment: string): RegExp {
  const cached = segmentCache.get(segment);
  if (cached) return cached;
  let source = "";
  for (const char of segment) {
    if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  const regex = new RegExp(`^${source}$`);
  segmentCache.set(segment, regex);
  return regex;
}

/**
 * `*` matches within one segment, `?` one character. A name that starts with
 * a dot only matches if the pattern itself starts with a dot; that way
 * hidden directories stay out of sight unless they are named explicitly.
 */
function matchesSegment(segment: string, name: string): boolean {
  if (name.startsWith(".") && !segment.startsWith(".")) return false;
  return segmentToRegExp(segment).test(name);
}

/** Turns a path pattern into a list of segments, without empty pieces. */
function normalizePattern(pattern: string): string[] {
  let value = pattern.trim().replace(/\\/g, "/");
  while (value.startsWith("./")) value = value.slice(2);
  value = value.replace(/^\/+/, "").replace(/\/+$/, "");
  return value.split("/").filter((segment) => segment.length > 0);
}

interface WalkState {
  cwd: string;
  segments: string[];
  seen: Set<string>;
  matches: string[];
}

async function readEntries(dir: string): Promise<Dirent[] | null> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    // Unreadable or vanished directory: skip it, never let it crash.
    return null;
  }
}

/** Stores a hit as a path relative to cwd, with forward slashes. */
function addMatch(absolute: string, state: WalkState): void {
  const relative = path.relative(state.cwd, absolute).split(path.sep).join("/");
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return;
  if (state.seen.has(relative)) return;
  state.seen.add(relative);
  state.matches.push(relative);
}

/**
 * Walks into a directory and tries to match `state.segments[index]` and beyond.
 * `base` is the relative path of `dir` with respect to cwd.
 */
async function walk(dir: string, base: string, index: number, state: WalkState): Promise<void> {
  const segments = state.segments;
  if (index >= segments.length) return;
  const segment = segments[index];
  if (segment === undefined) return;
  const entries = await readEntries(dir);
  if (!entries) return;

  if (segment === "**") {
    // `**` matches zero segments: try the next pattern part right away.
    if (index + 1 < segments.length) await walk(dir, base, index + 1, state);
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || IGNORED_DIRS.has(entry.name)) continue;
        const childBase = base === "" ? entry.name : `${base}/${entry.name}`;
        await walk(path.join(dir, entry.name), childBase, index, state);
      } else if (index + 1 === segments.length && !entry.name.startsWith(".")) {
        // `**` swallows this file as the last segment.
        addMatch(path.join(dir, entry.name), state);
      }
    }
    return;
  }

  const last = index + 1 === segments.length;
  for (const entry of entries) {
    if (!matchesSegment(segment, entry.name)) continue;
    const childBase = base === "" ? entry.name : `${base}/${entry.name}`;
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      await walk(path.join(dir, entry.name), childBase, index + 1, state);
    } else if (last) {
      addMatch(path.join(dir, entry.name), state);
    }
  }
}

/**
 * Finds files under `cwd` that match `pattern` and returns them sorted as
 * relative paths with forward slashes. Missing or unreadable directories
 * yield an empty list instead of an error.
 */
export async function glob(pattern: string, cwd: string, options: GlobOptions = {}): Promise<string[]> {
  const requested = options.limit ?? MAX_RESULTS;
  const limit = Number.isFinite(requested)
    ? Math.min(Math.max(Math.floor(requested), 0), MAX_RESULTS)
    : MAX_RESULTS;
  if (limit === 0) return [];

  const segments = normalizePattern(pattern);
  if (segments.length === 0) return [];

  const root = path.resolve(cwd);
  try {
    const info = await fs.stat(root);
    if (!info.isDirectory()) return [];
  } catch {
    return [];
  }

  const state: WalkState = { cwd: root, segments, seen: new Set<string>(), matches: [] };
  try {
    await walk(root, "", 0, state);
  } catch {
    // Not a hard error: return what we have so far.
  }
  state.matches.sort();
  return state.matches.slice(0, limit);
}
