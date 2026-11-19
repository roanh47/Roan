import { mkdir, rename, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

/** The home on every platform: `~/.Roan`, capital R. */
const HOME_DIR = ".Roan";
/** Installs from before the capital-R decision live here; moved once at boot. */
const LEGACY_HOME_DIR = ".roan";

/** Every path the app owns. `ROAN_HOME` exists for tests, not for users. */
export interface RoanPaths {
  readonly home: string;
  readonly secrets: string;
  /** The agent's own desk: what it writes here stays on this machine. */
  readonly workspace: string;
  /** The folder whose contents ride the chain as events. */
  readonly syncedWorkspace: string;
  /** Machine state the agent owns but never reads as content: the chain, the db. */
  readonly state: string;
  readonly database: string;
  readonly configFile: string;
  readonly identityFile: string;
}

export function resolvePaths(home = process.env["ROAN_HOME"] ?? join(homedir(), HOME_DIR)): RoanPaths {
  return {
    home,
    secrets: join(home, "secrets"),
    workspace: join(home, "workspace"),
    syncedWorkspace: join(home, "synced-workspace"),
    state: join(home, "state"),
    database: join(home, "state", "chain.db"),
    configFile: join(home, "config.json"),
    identityFile: join(home, "secrets", "identity.json"),
  };
}

/**
 * Moves a pre-capital install into `~/.Roan`, once, before anything opens the
 * database. A rename keeps the chain, the keys and the workspace in one step —
 * nothing is copied, nothing is left behind. When both directories exist the
 * new one wins and the legacy one is left alone for the user to inspect.
 *
 * Only a home named `.Roan` is migrated: its legacy sibling is the lowercase
 * `.roan` in the same parent. An explicit `ROAN_HOME` with another name owns
 * its layout. Android's `filesDir/.Roan` matches by name — the Kotlin side
 * renames first, so the attempt here finds no legacy and does nothing.
 */
export async function migrateLegacyHome(paths: RoanPaths): Promise<
  "moved" | "new-only" | "none" | "both" | "env"
> {
  if (basename(paths.home) !== HOME_DIR) return "env";
  const legacy = join(dirname(paths.home), LEGACY_HOME_DIR);
  const exists = async (path: string): Promise<boolean> => {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  };
  const legacyExists = await exists(legacy);
  const homeExists = await exists(paths.home);
  if (!legacyExists) return homeExists ? "new-only" : "none";
  if (homeExists) return "both";
  await rename(legacy, paths.home);
  return "moved";
}

/**
 * The workspace used to hold the chain database, which made "what the agent
 * writes" and "what the machine owns" the same folder. They are not: `state/`
 * is machine bookkeeping, `workspace/` is the agent's desk. This moves the
 * database once, before anything opens it — a rename, nothing copied — and
 * leaves any other workspace content where it is.
 *
 * A database already in `state/` means the move happened; the one in
 * `workspace/` is then a leftover to leave alone.
 */
export async function migrateStateSplit(paths: RoanPaths): Promise<"moved" | "none" | "both"> {
  const exists = async (path: string): Promise<boolean> => {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  };
  const oldDb = join(paths.workspace, "chain.db");
  const newDb = paths.database;
  const oldExists = await exists(oldDb);
  const newExists = await exists(newDb);
  if (!oldExists) return "none";
  if (newExists) return "both";
  await mkdir(paths.state, { recursive: true });
  // WAL and SHM belong to the database: they move with it, or the chain comes
  // back with a torn tail on a machine that still has them cached.
  for (const suffix of ["", "-wal", "-shm"]) {
    const live = `${oldDb}${suffix}`;
    if (await exists(live)) await rename(live, `${newDb}${suffix}`);
  }
  return "moved";
}

export async function ensurePaths(paths: RoanPaths): Promise<void> {
  for (const dir of [paths.home, paths.secrets, paths.workspace, paths.syncedWorkspace, paths.state]) {
    await mkdir(dir, { recursive: true });
  }
}
