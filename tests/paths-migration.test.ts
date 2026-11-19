import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  ensurePaths,
  migrateLegacyHome,
  migrateStateSplit,
  resolvePaths,
} from "../src/daemon/paths.js";

/**
 * The capital-R migration. Installs from before 2026-11-18 keep their chain in
 * `~/.roan`; the first boot after the rename moves it once and nothing is
 * lost. Every case runs against a temporary home, never the real one.
 */
async function readFileOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

test("the default home is ~/.Roan, capital R", () => {
  delete process.env["ROAN_HOME"];
  const paths = resolvePaths();
  assert.equal(paths.home, join(homedir(), ".Roan"));
  assert.equal(paths.database, join(paths.home, "state", "chain.db"));
});

/** The chain database leaves the agent's desk for the machine's drawer. */
test("the state split moves chain.db with its WAL and SHM, once", async () => {
  const root = mkdtempSync(join(tmpdir(), "roan-state-moved-"));
  try {
    await mkdir(join(root, ".Roan", "workspace"), { recursive: true });
    await writeFile(join(root, ".Roan", "workspace", "chain.db"), "db");
    await writeFile(join(root, ".Roan", "workspace", "chain.db-wal"), "wal");
    await writeFile(join(root, ".Roan", "workspace", "chain.db-shm"), "shm");
    const paths = resolvePaths(join(root, ".Roan"));

    assert.equal(await migrateStateSplit(paths), "moved");
    assert.equal(await readFileOrNull(join(paths.database)), "db");
    assert.equal(await readFileOrNull(`${paths.database}-wal`), "wal");
    assert.equal(await readFileOrNull(`${paths.database}-shm`), "shm");
    assert.equal(await readFileOrNull(join(root, ".Roan", "workspace", "chain.db")), null);

    // The second boot finds state/chain.db and does nothing.
    assert.equal(await migrateStateSplit(paths), "none");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a home already split leaves its leftovers alone", async () => {
  const root = mkdtempSync(join(tmpdir(), "roan-state-both-"));
  try {
    await mkdir(join(root, ".Roan", "workspace"), { recursive: true });
    await mkdir(join(root, ".Roan", "state"), { recursive: true });
    await writeFile(join(root, ".Roan", "workspace", "chain.db"), "old leftover");
    await writeFile(join(root, ".Roan", "state", "chain.db"), "live");
    const paths = resolvePaths(join(root, ".Roan"));

    assert.equal(await migrateStateSplit(paths), "both");
    assert.equal(await readFileOrNull(join(paths.database)), "live");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a legacy ~/.roan is moved once, contents intact", async () => {
  const root = mkdtempSync(join(tmpdir(), "roan-mig-moved-"));
  try {
    await mkdir(join(root, ".roan", "workspace"), { recursive: true });
    await writeFile(join(root, ".roan", "workspace", "chain.db"), "chain");
    const paths = resolvePaths(join(root, ".Roan"));

    assert.equal(await migrateLegacyHome(paths), "moved");
    assert.equal(
      await readFileOrNull(join(root, ".Roan", "workspace", "chain.db")),
      "chain",
    );

    // The second boot finds only the new home and does nothing.
    assert.equal(await migrateLegacyHome(paths), "new-only");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("when both homes exist the new one wins and the legacy one stays", async () => {
  const root = mkdtempSync(join(tmpdir(), "roan-mig-both-"));
  try {
    await mkdir(join(root, ".roan"), { recursive: true });
    await mkdir(join(root, ".Roan"), { recursive: true });
    await writeFile(join(root, ".roan", "old.txt"), "old");
    await writeFile(join(root, ".Roan", "new.txt"), "new");
    const paths = resolvePaths(join(root, ".Roan"));

    assert.equal(await migrateLegacyHome(paths), "both");
    assert.equal(await readFileOrNull(join(root, ".roan", "old.txt")), "old");
    assert.equal(await readFileOrNull(join(root, ".Roan", "new.txt")), "new");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an explicit ROAN_HOME owns its layout and is never migrated", async () => {
  const root = mkdtempSync(join(tmpdir(), "roan-mig-env-"));
  try {
    const paths = resolvePaths(join(root, "x-home"));
    assert.equal(await migrateLegacyHome(paths), "env");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a fresh machine with neither home is none until the dirs exist", async () => {
  const root = mkdtempSync(join(tmpdir(), "roan-mig-none-"));
  try {
    const paths = resolvePaths(join(root, ".Roan"));
    assert.equal(await migrateLegacyHome(paths), "none");
    await ensurePaths(paths);
    assert.equal(await migrateLegacyHome(paths), "new-only");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
