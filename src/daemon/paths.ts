import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

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

export function resolvePaths(home = process.env["ROAN_HOME"] ?? join(homedir(), ".roan")): RoanPaths {
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

export async function ensurePaths(paths: RoanPaths): Promise<void> {
  for (const dir of [paths.home, paths.secrets, paths.workspace, paths.syncedWorkspace]) {
    await mkdir(dir, { recursive: true });
  }
}
