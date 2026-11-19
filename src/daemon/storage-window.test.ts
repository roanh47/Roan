import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openStorageWindow } from "./storage-window.js";

/** Temp tree per test — never a real Android storage. */
function tree(): { base: string; photos: string; downloads: string } {
  const root = mkdtempSync(join(tmpdir(), "roan-storage-"));
  const photos = join(root, "Pictures");
  const downloads = join(root, "Download");
  mkdirSync(photos, { recursive: true });
  mkdirSync(downloads, { recursive: true });
  return { base: join(root, "files"), photos, downloads };
}

test("the window opens: symlinks appear next to the home, pointing at the real storages", async () => {
  const { base, photos, downloads } = tree();
  const result = await openStorageWindow({
    base,
    targets: { pictures: photos, downloads },
    canWriteShared: async () => true,
  });
  assert.deepEqual(result, { created: ["pictures", "downloads"], existed: [], refused: null });
  assert.deepEqual(readdirSync(join(base, "pictures")), readdirSync(photos));

  rmSync(base, { recursive: true, force: true });
});

test("without All files access the window refuses with a reason, not a silent nothing", async () => {
  const { base } = tree();
  const result = await openStorageWindow({
    base,
    targets: { pictures: "/nowhere" },
    canWriteShared: async () => false,
  });
  assert.equal(result.created.length, 0);
  assert.match(String(result.refused), /All files access/);
  rmSync(base, { recursive: true, force: true });
});

test("an existing real folder is left alone and reported as existing", async () => {
  const { base, photos } = tree();
  mkdirSync(join(base, "pictures"), { recursive: true });
  writeFileSync(join(base, "pictures", "own-file.txt"), "van de agent");
  const result = await openStorageWindow({
    base,
    targets: { pictures: photos },
    canWriteShared: async () => true,
  });
  assert.deepEqual(result, { created: [], existed: ["pictures"], refused: null });
  rmSync(base, { recursive: true, force: true });
});

test("a stale symlink to a vanished target is repointed", async () => {
  const { base, photos } = tree();
  mkdirSync(base, { recursive: true });
  const stale = join(base, "pictures");
  symlinkSync("/vanished", stale, "dir");
  const result = await openStorageWindow({
    base,
    targets: { pictures: photos },
    canWriteShared: async () => true,
  });
  assert.deepEqual(result.created, ["pictures"]);
  assert.deepEqual(readdirSync(stale), readdirSync(photos));
  rmSync(base, { recursive: true, force: true });
});
