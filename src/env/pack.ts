/**
 * Packing: read the env part of an agent home (`~/.roan`) into one snapshot.
 *
 * `workspace/`, `synced-workspace/` and `secrets/` are never opened. Those are
 * per-machine by design, and a snapshot that carried them would leak keys and
 * drag caches through the chain.
 */

import { isUtf8 } from "node:buffer";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  ENV_ROOT_DIRS,
  ENV_ROOT_FILES,
  ENV_SNAPSHOT_VERSION,
  MAX_ENV_ENTRY_BYTES,
  absoluteEnvPath,
  silentEnvLogger,
  type EnvEntry,
  type EnvLogger,
  type EnvSnapshot,
} from "./types.js";

/** SHA-256 of zero bytes; the identity of a directory entry. */
export const EMPTY_SHA256 = createHash("sha256").update(Buffer.alloc(0)).digest("hex");

export interface CollectOptions {
  /** Absolute agent home, normally `~/.roan`. */
  home: string;
  logger?: EnvLogger;
  /** Per-file ceiling; larger files are refused instead of silently dropped. */
  maxEntryBytes?: number;
  /**
   * Filled with managed paths that could not be read as env content (symlinks,
   * sockets, a directory where a file belongs). Apply uses this to notice that
   * "same hash" is not the same as "exactly the chain's env".
   */
  skipped?: string[];
}

export interface PackOptions extends CollectOptions {
  chainId: string;
  nodeId: string;
  /** Injectable clock so tests and replays are deterministic. */
  now?: Date;
}

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Canonical content hash over entries only — no chain id, node id or timestamp.
 * The same env on two machines hashes the same, which is what apply compares.
 */
export function hashEnvEntries(entries: readonly EnvEntry[]): string {
  const canonical = entries
    .slice()
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((entry) => [entry.path, entry.kind, entry.sha256] as const);
  return sha256Hex(JSON.stringify({ version: ENV_SNAPSHOT_VERSION, entries: canonical }));
}

function isMissing(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "ENOENT"
  );
}

async function statLoose(target: string) {
  try {
    return await fs.lstat(target);
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

async function readFileEntry(
  relPath: string,
  absolute: string,
  size: number,
  maxEntryBytes: number,
): Promise<EnvEntry> {
  if (size > maxEntryBytes) {
    throw new Error(
      `env file too large: ${relPath} is ${size} bytes (limit ${maxEntryBytes}); ` +
        "large assets belong in synced-workspace/, not in the chain",
    );
  }
  const bytes = await fs.readFile(absolute);
  const textual = isUtf8(bytes);
  return {
    path: relPath,
    kind: "file",
    sha256: sha256Hex(bytes),
    size: bytes.byteLength,
    encoding: textual ? "utf8" : "base64",
    content: textual ? bytes.toString("utf8") : bytes.toString("base64"),
  };
}

function noteSkipped(
  skipped: string[] | undefined,
  logger: EnvLogger,
  relPath: string,
  reason: string,
): void {
  skipped?.push(relPath);
  logger.warn(`env: skipping ${reason}: ${relPath}`);
}

async function walkDirectory(
  home: string,
  relDir: string,
  out: EnvEntry[],
  logger: EnvLogger,
  maxEntryBytes: number,
  skipped: string[] | undefined,
): Promise<void> {
  const absoluteDir = absoluteEnvPath(home, relDir);
  let dirents;
  try {
    dirents = await fs.readdir(absoluteDir, { withFileTypes: true });
  } catch (err) {
    if (isMissing(err)) return;
    throw err;
  }

  for (const dirent of dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const relPath = `${relDir}/${dirent.name}`;
    if (dirent.name.includes("\\") || dirent.name.includes("\0")) {
      noteSkipped(skipped, logger, relPath, "entry with an unsupported name");
      continue;
    }
    if (dirent.isSymbolicLink()) {
      noteSkipped(skipped, logger, relPath, "symlink (env must be plain files)");
      continue;
    }
    if (dirent.isDirectory()) {
      out.push(directoryEntry(relPath));
      await walkDirectory(home, relPath, out, logger, maxEntryBytes, skipped);
      continue;
    }
    if (dirent.isFile()) {
      const absolute = absoluteEnvPath(home, relPath);
      const stat = await fs.lstat(absolute);
      if (!stat.isFile()) {
        noteSkipped(skipped, logger, relPath, "non-regular file");
        continue;
      }
      out.push(await readFileEntry(relPath, absolute, stat.size, maxEntryBytes));
      continue;
    }
    noteSkipped(skipped, logger, relPath, "unsupported file type");
  }
}

function directoryEntry(relPath: string): EnvEntry {
  return {
    path: relPath,
    kind: "dir",
    sha256: EMPTY_SHA256,
    size: 0,
    encoding: "utf8",
    content: "",
  };
}

/**
 * Read the env as it is on disk, sorted by path: the five root files plus
 * everything under `memory/`, `skills/` and `mcp/`. Empty directories included.
 */
export async function collectEnvEntries(options: CollectOptions): Promise<EnvEntry[]> {
  const home = path.resolve(options.home);
  const logger = options.logger ?? silentEnvLogger;
  const maxEntryBytes = options.maxEntryBytes ?? MAX_ENV_ENTRY_BYTES;
  const entries: EnvEntry[] = [];
  const skipped = options.skipped;

  for (const fileName of ENV_ROOT_FILES) {
    const absolute = absoluteEnvPath(home, fileName);
    const stat = await statLoose(absolute);
    if (stat === null) continue;
    if (!stat.isFile()) {
      noteSkipped(skipped, logger, fileName, "a path that is not a regular file");
      continue;
    }
    entries.push(await readFileEntry(fileName, absolute, stat.size, maxEntryBytes));
  }

  for (const dirName of ENV_ROOT_DIRS) {
    const absolute = absoluteEnvPath(home, dirName);
    const stat = await statLoose(absolute);
    if (stat === null) continue;
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      noteSkipped(skipped, logger, dirName, "a path that is not a directory");
      continue;
    }
    entries.push(directoryEntry(dirName));
    await walkDirectory(home, dirName, entries, logger, maxEntryBytes, skipped);
  }

  return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * Pack this node's env. The result is what travels in the chain as an `env`
 * event; `entries` is the whole state, not a diff.
 */
export async function packEnv(options: PackOptions): Promise<EnvSnapshot> {
  const entries = await collectEnvEntries(options);
  return {
    version: ENV_SNAPSHOT_VERSION,
    chainId: options.chainId,
    nodeId: options.nodeId,
    createdAt: (options.now ?? new Date()).toISOString(),
    hash: hashEnvEntries(entries),
    entries,
  };
}
