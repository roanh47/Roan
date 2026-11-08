/**
 * Parking: move the local env aside before a join replaces it.
 *
 * Moving, never deleting. If anything goes wrong halfway through an apply, the
 * previous state is still on disk under `~/.roan/workspace/parked/<timestamp>/`
 * and the error names that path.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  ENV_ROOT_DIRS,
  ENV_ROOT_FILES,
  assertManagedEnvPath,
  resolveAgentHome,
  silentEnvLogger,
  type EnvLogger,
  type ParkResult,
} from "./types.js";

export interface ParkOptions {
  /** Agent home, normally `~/.roan`. */
  home?: string;
  /** Injectable clock; the timestamp in the directory name comes from it. */
  now?: Date;
  logger?: EnvLogger;
  /** Where parked copies go; defaults to `<home>/workspace/parked`. */
  parkedRoot?: string;
  /** Free-text note stored in the parked `park.json` manifest. */
  reason?: string;
}

interface FsCode {
  code?: unknown;
}

function hasCode(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && (err as FsCode).code === code;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch (err) {
    if (hasCode(err, "ENOENT")) return false;
    throw err;
  }
}

/** Filesystem-safe UTC stamp: `2026-11-08T21-46-12-123Z`. */
function timestampFor(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function createParkDirectory(parkedRoot: string, stamp: string): Promise<string> {
  await fs.mkdir(parkedRoot, { recursive: true });
  for (let attempt = 1; attempt <= 100; attempt++) {
    const candidate = path.join(parkedRoot, attempt === 1 ? stamp : `${stamp}-${attempt}`);
    try {
      await fs.mkdir(candidate);
      return candidate;
    } catch (err) {
      if (!hasCode(err, "EEXIST")) throw err;
    }
  }
  throw new Error(`could not create a unique parked directory under ${parkedRoot}`);
}

async function movePath(from: string, to: string): Promise<void> {
  try {
    await fs.rename(from, to);
    return;
  } catch (err) {
    // A home on another mount is unusual but not impossible. Copy first, and
    // only remove the source once the copy is complete.
    if (!hasCode(err, "EXDEV")) throw err;
  }
  await fs.cp(from, to, {
    recursive: true,
    force: false,
    errorOnExist: true,
    preserveTimestamps: true,
    verbatimSymlinks: true,
  });
  await fs.rm(from, { recursive: true, force: false });
}

/** The managed paths that exist right now, at the root of the home. */
async function existingManagedPaths(home: string): Promise<string[]> {
  const found: string[] = [];
  for (const relPath of [...ENV_ROOT_FILES, ...ENV_ROOT_DIRS]) {
    if (await pathExists(path.join(home, relPath))) found.push(relPath);
  }
  return found;
}

/**
 * Move the current env into `~/.roan/workspace/parked/<timestamp>/`.
 *
 * Only the env's own paths are moved. `secrets/`, `workspace/` and
 * `synced-workspace/` are not touched. Returns `null` when there is no env on
 * disk yet (a first join on a fresh machine), so callers can skip the manifest.
 */
export async function parkEnv(options: ParkOptions = {}): Promise<ParkResult | null> {
  const home = resolveAgentHome(options.home);
  const logger = options.logger ?? silentEnvLogger;
  const existing = await existingManagedPaths(home);
  if (existing.length === 0) {
    logger.info("env: nothing to park, the local env is empty");
    return null;
  }

  const now = options.now ?? new Date();
  const parkedRoot = options.parkedRoot ?? path.join(home, "workspace", "parked");
  const directory = await createParkDirectory(parkedRoot, timestampFor(now));

  const moved: string[] = [];
  try {
    for (const relPath of existing) {
      const guarded = assertManagedEnvPath(relPath);
      const from = path.join(home, guarded);
      const to = path.join(directory, guarded);
      await fs.mkdir(path.dirname(to), { recursive: true });
      await movePath(from, to);
      moved.push(guarded);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `parking the env failed after moving ${moved.length} of ${existing.length} paths ` +
        `(${message}); nothing was deleted, the parked copy is at ${directory}`,
    );
  }

  const manifest = {
    createdAt: now.toISOString(),
    home,
    reason: options.reason ?? "env replace",
    moved,
  };
  await fs.writeFile(path.join(directory, "park.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  logger.info(`env: parked ${moved.length} path(s) at ${directory}`);

  return { path: directory, createdAt: manifest.createdAt, moved };
}
