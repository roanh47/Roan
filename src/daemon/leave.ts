import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";

import type { RoanPaths } from "./paths.js";

/**
 * Leaving is not deleting: the identity and the chain move aside under a
 * timestamped name, so a leave is always undoable with a file move. The
 * daemon comes back up without an identity, which is onboarding — create a
 * new chain, or join one from a code.
 *
 * The move happens before anything else reads them again, so there is no
 * window in which a half-left chain still answers.
 */
export function leaveChain(paths: RoanPaths, now = Date.now()): string {
  if (!existsSync(paths.identityFile)) {
    throw new Error("this node is not in a chain");
  }
  const archive = freeName(paths.secrets, "identity", ".json", String(now));
  renameSync(paths.identityFile, archive);

  // WAL and SHM belong to the database: they move with it or the archive
  // resurrects with a torn tail on a machine that still has them cached.
  for (const suffix of ["", "-wal", "-shm"]) {
    const live = `${paths.state}/chain.db${suffix}`;
    if (existsSync(live)) renameSync(live, freeName(paths.state, `chain.db${suffix}`, "", String(now)));
  }
  return archive;
}

/** `name.left-<stamp>`, plus `-2`, `-3`… when the same stamp leaves twice. */
function freeName(dir: string, name: string, ext: string, stamp: string): string {
  let candidate = join(dir, `${name}.left-${stamp}${ext}`);
  let counter = 2;
  while (existsSync(candidate)) {
    candidate = join(dir, `${name}.left-${stamp}-${String(counter)}${ext}`);
    counter += 1;
  }
  return candidate;
}
