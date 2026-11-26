import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { bytesLabel, listWorkspace, mimeFor, readWorkspaceFile } from "./library.js";

async function world(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "roan-lib-"));
  await mkdir(join(root, "notes", "diep"), { recursive: true });
  await writeFile(join(root, "a.txt"), "hallo\n");
  await writeFile(join(root, "notes", "b.md"), "# titel\n");
  await writeFile(join(root, "notes", "diep", "c.csv"), "x,y\n1,2\n");
  await writeFile(join(root, ".env"), "SECRET=1\n");
  await mkdir(join(root, ".git"), { recursive: true });
  await writeFile(join(root, ".git", "config"), "[core]\n");
  return root;
}

test("the listing is sorted, typed and carries real sizes", async () => {
  const root = await world();
  try {
    const entries = await listWorkspace(root);
    assert.deepEqual(
      entries.map((entry) => [entry.path, entry.kind]),
      [
        ["a.txt", "file"],
        ["notes", "dir"],
        ["notes/b.md", "file"],
        ["notes/diep", "dir"],
        ["notes/diep/c.csv", "file"],
      ],
    );
    assert.equal(entries[0]?.bytes, "hallo\n".length);
    assert.equal(entries[1]?.bytes, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dotfiles and dot-directories are never listed", async () => {
  const root = await world();
  try {
    const paths = (await listWorkspace(root)).map((entry) => entry.path);
    assert.ok(!paths.some((path) => path.includes(".git") || path.startsWith(".")));
    // And reading one is refused too: the listing not inviting it is not enough.
    await assert.rejects(readWorkspaceFile(root, ".env"), /dotfile/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the depth cap keeps a deep tree from becoming a dump", async () => {
  const root = await world();
  try {
    const shallow = await listWorkspace(root, { maxDepth: 1 });
    assert.deepEqual(shallow.map((entry) => entry.path), ["a.txt", "notes"]);
    const two = await listWorkspace(root, { maxDepth: 2 });
    assert.deepEqual(two.map((entry) => entry.path), ["a.txt", "notes", "notes/b.md", "notes/diep"]);
    await assert.rejects(listWorkspace(root, { maxDepth: 0 }), /maxDepth/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the entry cap stops the walk where it says it does", async () => {
  const root = await world();
  try {
    const capped = await listWorkspace(root, { maxEntries: 2 });
    assert.equal(capped.length, 2);
    assert.deepEqual(capped.map((entry) => entry.path), ["a.txt", "notes"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a symbolic link is not followed, so the listing stays inside the root", async () => {
  const root = await world();
  const outside = await mkdtemp(join(tmpdir(), "roan-outside-"));
  try {
    await writeFile(join(outside, "geheim.txt"), "nee\n");
    await symlink(outside, join(root, "link"));
    const paths = (await listWorkspace(root)).map((entry) => entry.path);
    assert.ok(!paths.includes("link"));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("reading answers bytes and a mime type", async () => {
  const root = await world();
  try {
    const file = await readWorkspaceFile(root, "notes/diep/c.csv");
    assert.equal(file.bytes.toString("utf8"), "x,y\n1,2\n");
    assert.equal(file.mime, "text/csv");
    assert.equal(file.path, "notes/diep/c.csv");
    assert.equal(mimeFor("a/b/x.TS"), "text/plain");
    assert.equal(mimeFor("maakbestand"), "application/octet-stream");
    assert.equal(mimeFor(".env"), "application/octet-stream");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a path that escapes the workspace is refused, however it is spelled", async () => {
  const root = await world();
  const outside = await mkdtemp(join(tmpdir(), "roan-outside-"));
  try {
    await writeFile(join(outside, "geheim.txt"), "nee\n");
    await assert.rejects(readWorkspaceFile(root, "../geheim.txt"), /escapes the workspace/);
    await assert.rejects(readWorkspaceFile(root, join(outside, "geheim.txt")), /escapes the workspace/);
    await symlink(join(outside, "geheim.txt"), join(root, "lok.txt"));
    await assert.rejects(readWorkspaceFile(root, "lok.txt"), /escapes the workspace/);
    await assert.rejects(readWorkspaceFile(root, ""), /no path/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("a file over the byte cap is refused with its real size, not truncated", async () => {
  const root = await world();
  try {
    await writeFile(join(root, "groot.txt"), "x".repeat(2048));
    await assert.rejects(readWorkspaceFile(root, "groot.txt", 1024), /2048 bytes, over the 1024 byte preview cap/);
    const fits = await readWorkspaceFile(root, "groot.txt", 2048);
    assert.equal(fits.bytes.length, 2048);
    await assert.rejects(readWorkspaceFile(root, "notes"), /is a directory/);
    await assert.rejects(readWorkspaceFile(root, "erisniet.txt"), /does not exist/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sizes read as a person writes them", () => {
  assert.equal(bytesLabel(0), "0 B");
  assert.equal(bytesLabel(999), "999 B");
  assert.equal(bytesLabel(2048), "2 kB");
  assert.equal(bytesLabel(3 * 1024 * 1024), "3.0 MB");
});
