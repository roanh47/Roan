/**
 * Applying: make this node's env exactly the chain's env.
 *
 * Rules:
 *  - Join adopts. The local env is never merged and never pushed back.
 *  - Everything is replaced, inside the env paths only. A path the snapshot does
 *    not contain is removed by parking it, not deleted.
 *  - Nothing outside `AGENTS.md`, `SOUL.md`, `USER.md`, `MEMORY.md`,
 *    `config.json`, `memory/`, `skills/` and `mcp/` is read, written or removed.
 *  - Idempotent: applying the same snapshot twice is a no-op the second time.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { collectEnvEntries, hashEnvEntries, type CollectOptions } from "./pack.js";
import { parkEnv } from "./park.js";
import { decodeEnvEntry, parseEnvSnapshot } from "./snapshot.js";
import {
  MAX_ENV_ENTRY_BYTES,
  absoluteEnvPath,
  resolveAgentHome,
  silentEnvLogger,
  type ApplyResult,
  type EnvEntry,
  type EnvLogger,
} from "./types.js";

export { parseEnvSnapshot, type ParseOptions } from "./snapshot.js";

export interface ApplyOptions {
  /** Agent home, normally `~/.roan`. */
  home?: string;
  logger?: EnvLogger;
  /** Recompute the content hash before applying anything. Default true. */
  verifyHash?: boolean;
  maxEntryBytes?: number;
  /** Injectable clock, used for the parked directory name. */
  now?: Date;
}

async function writeEntry(home: string, entry: EnvEntry): Promise<void> {
  const target = absoluteEnvPath(home, entry.path);
  if (entry.kind === "dir") {
    await fs.mkdir(target, { recursive: true });
    return;
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, decodeEnvEntry(entry));
}

/**
 * Replace the local env with `snapshot`.
 *
 * The previous env is parked first, so an interrupted apply never loses data.
 * The result is read back and hashed; a mismatch is an error, not a success.
 * Returns which files were written and which local entries were parked.
 */
export async function applyEnvSnapshot(
  snapshot: unknown,
  options: ApplyOptions = {},
): Promise<ApplyResult> {
  const home = resolveAgentHome(options.home);
  const logger = options.logger ?? silentEnvLogger;
  const maxEntryBytes = options.maxEntryBytes ?? MAX_ENV_ENTRY_BYTES;
  const parsed = parseEnvSnapshot(snapshot, {
    verifyHash: options.verifyHash ?? true,
    maxEntryBytes,
  });

  const collectOptions: CollectOptions = { home, logger, maxEntryBytes };
  const localResidue: string[] = [];
  const local = await collectEnvEntries({ ...collectOptions, skipped: localResidue });
  const localHash = hashEnvEntries(local);

  // Same content hash, and nothing in the managed trees that could not be read
  // (a symlink, say) — only then is the local env already the chain's env.
  if (localHash === parsed.hash && localResidue.length === 0) {
    logger.info("env: local env already matches the chain, nothing to do");
    return { hash: parsed.hash, applied: false, parkedPath: null, written: [], removed: [] };
  }

  const localByPath = new Map(local.map((entry) => [entry.path, entry] as const));
  const targetPaths = new Set(parsed.entries.map((entry) => entry.path));
  const written = parsed.entries
    .filter((entry) => entry.kind === "file" && localByPath.get(entry.path)?.sha256 !== entry.sha256)
    .map((entry) => entry.path);
  const removed = local.filter((entry) => !targetPaths.has(entry.path)).map((entry) => entry.path);

  const parked = await parkEnv({
    home,
    logger,
    now: options.now,
    reason: `apply env snapshot ${parsed.hash}`,
  });

  try {
    for (const entry of parsed.entries) {
      if (entry.kind === "dir") await writeEntry(home, entry);
    }
    for (const entry of parsed.entries) {
      if (entry.kind === "file") await writeEntry(home, entry);
    }

    // Read it back: if the result is not byte-for-byte the chain's env, say so
    // instead of reporting success.
    const appliedResidue: string[] = [];
    const applied = await collectEnvEntries({ ...collectOptions, skipped: appliedResidue });
    const appliedHash = hashEnvEntries(applied);
    if (appliedHash !== parsed.hash || appliedResidue.length > 0) {
      const extra =
        appliedResidue.length === 0 ? "" : `; leftover entries: ${appliedResidue.join(", ")}`;
      throw new Error(
        `env did not apply cleanly: expected ${parsed.hash}, found ${appliedHash}${extra}`,
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const where = parked === null ? "" : `; the previous env is parked at ${parked.path}`;
    throw new Error(`applying the env snapshot failed: ${message}${where}`);
  }

  logger.info(
    `env: applied ${parsed.hash} (${written.length} file(s) written, ${removed.length} removed)`,
  );

  return {
    hash: parsed.hash,
    applied: true,
    parkedPath: parked?.path ?? null,
    written: written.sort(),
    removed: removed.sort(),
  };
}
