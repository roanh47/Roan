/**
 * The env is the part of `~/.roan` that travels in the chain: config, identity
 * files, memory notes, skills and MCP definitions. It is the agent itself, so a
 * joining node adopts it as-is — no merge, no push.
 *
 * Everything else stays on the machine: `secrets/` (never travels),
 * `workspace/` (scratch, caches, logs) and `synced-workspace/` (synced by
 * Syncthing, not by the chain). Those paths are not "managed" and no function in
 * this folder will read, write or move them.
 */

import os from "node:os";
import path from "node:path";

/** Bumped only when the snapshot shape changes incompatibly. */
export const ENV_SNAPSHOT_VERSION = 1;

/** Root files of the agent home that belong to the env. Case-sensitive on purpose. */
export const ENV_ROOT_FILES = [
  "AGENTS.md",
  "SOUL.md",
  "USER.md",
  "MEMORY.md",
  "config.json",
  "cron.json",
  "hooks.json",
] as const;

/** Root directories of the agent home that belong to the env. */
export const ENV_ROOT_DIRS = ["memory", "skills", "mcp"] as const;

export const ENV_ROOT_FILE_SET: ReadonlySet<string> = new Set(ENV_ROOT_FILES);
export const ENV_ROOT_DIR_SET: ReadonlySet<string> = new Set(ENV_ROOT_DIRS);

/** Largest single file the env may carry. Big blobs belong in `synced-workspace/`. */
export const MAX_ENV_ENTRY_BYTES = 8 * 1024 * 1024;

export type EnvEntryKind = "file" | "dir";
export type EnvEntryEncoding = "utf8" | "base64";

/**
 * One file or directory, addressed relative to the agent home with `/`
 * separators. Directories are explicit so an empty directory survives the trip.
 */
export interface EnvEntry {
  /** Relative POSIX path, e.g. `skills/ccna/SKILL.md`. */
  path: string;
  kind: EnvEntryKind;
  /** SHA-256 of the file bytes; the empty-string hash for a directory. */
  sha256: string;
  /** Byte length of the file; 0 for a directory. */
  size: number;
  encoding: EnvEntryEncoding;
  /** File content (`""` for a directory). */
  content: string;
}

/**
 * A whole env at one point in time.
 *
 * `hash` is the content hash over the entries only: two nodes with the same env
 * produce the same hash, regardless of who packed it or when. That is what makes
 * applying idempotent.
 */
export interface EnvSnapshot {
  version: typeof ENV_SNAPSHOT_VERSION;
  /** Chain the env belongs to; provenance only, not part of `hash`. */
  chainId: string;
  /** Node that packed it; provenance only, not part of `hash`. */
  nodeId: string;
  /** ISO-8601 pack time; provenance only, not part of `hash`. */
  createdAt: string;
  /** 64 hex chars: content hash of `entries`. */
  hash: string;
  /** Sorted by `path`, directories included. */
  entries: EnvEntry[];
}

/** What a park did. `null` from `parkEnv` means there was nothing to park. */
export interface ParkResult {
  /** Absolute path of `~/.roan/workspace/parked/<timestamp>/`. */
  path: string;
  createdAt: string;
  /** Relative paths that were moved into `path`. */
  moved: string[];
}

export interface ApplyResult {
  /** Snapshot content hash that is now the local state. */
  hash: string;
  /** False when the local env already matched and nothing was touched. */
  applied: boolean;
  /** Where the previous local env was moved, or null when there was nothing. */
  parkedPath: string | null;
  /** Files created or overwritten (relative paths), sorted. */
  written: string[];
  /** Local entries absent from the snapshot and therefore parked, sorted. */
  removed: string[];
}

/** Injected, never imported: the core does not print. */
export interface EnvLogger {
  info(message: string): void;
  warn(message: string): void;
}

export const silentEnvLogger: EnvLogger = {
  info: () => {},
  warn: () => {},
};

/**
 * The agent home. `~/.roan` on every platform; the caller may override it for
 * tests or for a node that keeps its home elsewhere.
 */
export function resolveAgentHome(home?: string): string {
  return path.resolve(home ?? path.join(os.homedir(), ".roan"));
}

/** Normalise a snapshot path to `a/b/c`; rejects anything that could escape. */
export function normaliseEnvPath(raw: string): string {
  if (raw.length === 0) throw new Error("env path is empty");
  if (raw.includes("\\")) throw new Error(`env path must use '/' separators: ${raw}`);
  if (raw.includes("\0")) throw new Error("env path contains a NUL byte");
  if (raw.startsWith("/") || /^[A-Za-z]:/.test(raw)) {
    throw new Error(`env path must be relative: ${raw}`);
  }
  const segments = raw.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new Error(`env path has an empty or traversing segment: ${raw}`);
    }
  }
  return segments.join("/");
}

/**
 * True when `raw` is one of the env's own paths. Everything outside this set —
 * `secrets/`, `workspace/`, `synced-workspace/`, a stray file in the home root —
 * is never read, written, moved or removed.
 */
export function isManagedEnvPath(raw: string): boolean {
  let normalised: string;
  try {
    normalised = normaliseEnvPath(raw);
  } catch {
    return false;
  }
  const segments = normalised.split("/");
  const first = segments[0];
  if (first === undefined) return false;
  if (segments.length === 1) {
    return ENV_ROOT_FILE_SET.has(normalised) || ENV_ROOT_DIR_SET.has(normalised);
  }
  return ENV_ROOT_DIR_SET.has(first);
}

/** Same check, but throws with a message that names the refused path. */
export function assertManagedEnvPath(raw: string): string {
  const normalised = normaliseEnvPath(raw);
  if (!isManagedEnvPath(normalised)) {
    throw new Error(`refusing to touch path outside the env: ${raw}`);
  }
  return normalised;
}

/** Root-file paths must be files, root-dir paths must be directories. */
export function isKindAllowed(pathRaw: string, kind: EnvEntryKind): boolean {
  const segments = pathRaw.split("/");
  if (segments.length === 1) {
    if (ENV_ROOT_FILE_SET.has(pathRaw)) return kind === "file";
    if (ENV_ROOT_DIR_SET.has(pathRaw)) return kind === "dir";
    return false;
  }
  return kind === "file" || kind === "dir";
}

/** Absolute path for a managed relative path; keeps `path.join` from escaping. */
export function absoluteEnvPath(home: string, relPath: string): string {
  const normalised = assertManagedEnvPath(relPath);
  const absolute = path.resolve(home, normalised);
  const relative = path.relative(home, absolute);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`env path escapes the agent home: ${relPath}`);
  }
  return absolute;
}
