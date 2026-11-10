import { promises as fs } from "node:fs";
import type { Dirent } from "node:fs";
import path from "node:path";

export interface GlobOptions {
  limit?: number;
}

/** Harde bovengrens, ongeacht wat de aanroeper vraagt. */
const MAX_RESULTS = 500;

/** Mappen die we nooit inlopen: te groot en nooit interessant voor de agent. */
const IGNORED_DIRS = new Set(["node_modules", ".git"]);

const segmentCache = new Map<string, RegExp>();

/**
 * Eén glob-segment (`*` en `?`, geen `/`) naar een regex.
 * Het resultaat wordt gecachet: patronen herhalen zich vaak per map.
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
 * `*` matcht binnen één segment, `?` één teken. Een naam die met een punt
 * begint matcht alleen als het patroon zelf met een punt begint; zo blijven
 * verborgen mappen buiten beeld tenzij ze expliciet genoemd worden.
 */
function matchesSegment(segment: string, name: string): boolean {
  if (name.startsWith(".") && !segment.startsWith(".")) return false;
  return segmentToRegExp(segment).test(name);
}

/** Maak van een pad-patroon een lijst segmenten, zonder lege stukken. */
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
    // Onleesbare of verdwenen map: overslaan, nooit laten klappen.
    return null;
  }
}

/** Bewaar een treffer als pad relatief aan cwd, met forward slashes. */
function addMatch(absolute: string, state: WalkState): void {
  const relative = path.relative(state.cwd, absolute).split(path.sep).join("/");
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return;
  if (state.seen.has(relative)) return;
  state.seen.add(relative);
  state.matches.push(relative);
}

/**
 * Loop een map in en probeer `state.segments[index]` en verder te matchen.
 * `base` is het relatieve pad van `dir` ten opzichte van cwd.
 */
async function walk(dir: string, base: string, index: number, state: WalkState): Promise<void> {
  const segments = state.segments;
  if (index >= segments.length) return;
  const segment = segments[index];
  if (segment === undefined) return;
  const entries = await readEntries(dir);
  if (!entries) return;

  if (segment === "**") {
    // `**` matcht nul segmenten: probeer meteen het volgende patroondeel.
    if (index + 1 < segments.length) await walk(dir, base, index + 1, state);
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || IGNORED_DIRS.has(entry.name)) continue;
        const childBase = base === "" ? entry.name : `${base}/${entry.name}`;
        await walk(path.join(dir, entry.name), childBase, index, state);
      } else if (index + 1 === segments.length && !entry.name.startsWith(".")) {
        // `**` slokt dit bestand op als laatste segment.
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
 * Zoek bestanden onder `cwd` die aan `pattern` voldoen en geef ze gesorteerd
 * terug als relatieve paden met forward slashes. Ontbrekende of onleesbare
 * mappen leveren een lege lijst op in plaats van een fout.
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
    // Geen harde fout: geef terug wat we tot nu toe hebben.
  }
  state.matches.sort();
  return state.matches.slice(0, limit);
}
