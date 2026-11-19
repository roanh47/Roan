import assert from "node:assert/strict";
import { mkdtempSync, existsSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { leaveChain } from "./leave.js";
import { resolvePaths } from "./paths.js";

/** A temp home per test — the real ~/.roan is never touched. */
function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "roan-leave-"));
}

test("leaving archives the identity and the chain, nothing is deleted", () => {
  const home = tempHome();
  const paths = resolvePaths(home);
  mkdirSync(paths.secrets, { recursive: true });
  mkdirSync(paths.workspace, { recursive: true });
  writeFileSync(paths.identityFile, '{"chain":"c"}');
  writeFileSync(join(paths.workspace, "chain.db"), "db");
  writeFileSync(join(paths.workspace, "chain.db-wal"), "wal");

  const archive = leaveChain(paths, 1_700_000_000_000);

  assert.equal(existsSync(paths.identityFile), false);
  assert.equal(existsSync(archive), true);
  assert.equal(existsSync(join(paths.workspace, "chain.db")), false);
  assert.equal(existsSync(join(paths.workspace, "chain.db.left-1700000000000")), true);
  assert.equal(existsSync(join(paths.workspace, "chain.db-wal.left-1700000000000")), true);
  assert.deepEqual(readdirSync(paths.workspace).sort(), [
    "chain.db-wal.left-1700000000000",
    "chain.db.left-1700000000000",
  ]);
});

test("leaving without a chain refuses instead of inventing an archive", () => {
  const home = tempHome();
  const paths = resolvePaths(home);
  assert.throws(() => leaveChain(paths), /not in a chain/);
});

test("two leaves with the same stamp never overwrite each other", () => {
  const home = tempHome();
  const paths = resolvePaths(home);
  mkdirSync(paths.secrets, { recursive: true });
  writeFileSync(paths.identityFile, '{"chain":"c"}');

  leaveChain(paths, 5);
  writeFileSync(paths.identityFile, '{"chain":"c2"}');
  const second = leaveChain(paths, 5);

  assert.match(second, /left-5-2\.json$/);
  assert.equal(readdirSync(paths.secrets).length, 2);
});
