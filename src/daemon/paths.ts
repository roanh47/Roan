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
  readonly workspace: string;
  readonly syncedWorkspace: string;
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
    database: join(home, "workspace", "chain.db"),
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

export async function ensurePaths(paths: RoanPaths): Promise<void> {
  for (const dir of [paths.home, paths.secrets, paths.workspace, paths.syncedWorkspace]) {
    await mkdir(dir, { recursive: true });
  }
}
