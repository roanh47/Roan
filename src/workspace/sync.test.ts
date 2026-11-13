import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Event } from "../protocol/types.js";
import { hashContent, scanWorkspace } from "./scan.js";
import { applyWorkspaceEvent } from "./sync.js";

function ws(seq: number, data: Record<string, unknown>, node = "n1"): Event {
  return { v: 1, chain: "c", seq, id: `w${String(seq)}`, node, ts: seq, type: "workspace", data };
}

test("a new file lands, and the same file twice is not rewritten", async () => {
  const root = await mkdtemp(join(tmpdir(), "roan-ws-"));
  try {
    const content = "hallo\n";
    const first = await applyWorkspaceEvent(root, ws(1, { op: "put", path: "a.txt", content, hash: hashContent(content) }));
    assert.equal(first.kind, "written");
    assert.equal(await readFile(join(root, "a.txt"), "utf8"), content);
    const again = await applyWorkspaceEvent(root, ws(2, { op: "put", path: "a.txt", content, hash: hashContent(content) }));
    assert.equal(again.kind, "same");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an edit based on what was on disk replaces it", async () => {
  const root = await mkdtemp(join(tmpdir(), "roan-ws-"));
  try {
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "a.txt"), "een\n");
    const changed = "twee\n";
    const outcome = await applyWorkspaceEvent(
      root,
      ws(3, { op: "put", path: "a.txt", content: changed, hash: hashContent(changed), base: hashContent("een\n") }),
    );
    assert.equal(outcome.kind, "written");
    assert.equal(await readFile(join(root, "a.txt"), "utf8"), changed);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("two edits to the same base keep both versions", async () => {
  const root = await mkdtemp(join(tmpdir(), "roan-ws-"));
  try {
    await writeFile(join(root, "a.txt"), "mijn versie\n");
    const theirs = "hun versie\n";
    const outcome = await applyWorkspaceEvent(
      root,
      ws(9, { op: "put", path: "a.txt", content: theirs, hash: hashContent(theirs), base: hashContent("basis\n") }, "node-b"),
    );
    assert.equal(outcome.kind, "conflict");
    assert.equal(await readFile(join(root, "a.txt"), "utf8"), "mijn versie\n");
    const kept = await readFile(join(root, "a.txt.conflict-node-b-9"), "utf8");
    assert.equal(kept, theirs);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a delete only removes a file nobody touched since", async () => {
  const root = await mkdtemp(join(tmpdir(), "roan-ws-"));
  try {
    await writeFile(join(root, "a.txt"), "x\n");
    const refused = await applyWorkspaceEvent(root, ws(4, { op: "delete", path: "a.txt", base: hashContent("anders\n") }));
    assert.equal(refused.kind, "conflict");
    const gone = await applyWorkspaceEvent(root, ws(5, { op: "delete", path: "a.txt", base: hashContent("x\n") }));
    assert.equal(gone.kind, "deleted");
    await assert.rejects(readFile(join(root, "a.txt"), "utf8"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("paths cannot escape the workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "roan-ws-"));
  try {
    const outcome = await applyWorkspaceEvent(root, ws(6, { op: "put", path: "../escape.txt", content: "nee", hash: hashContent("nee") }));
    assert.equal(outcome.kind, "refused");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the scan skips heavy directories and hashes what is left", async () => {
  const root = await mkdtemp(join(tmpdir(), "roan-ws-"));
  try {
    await mkdir(join(root, "node_modules", "x"), { recursive: true });
    await writeFile(join(root, "node_modules", "x", "big.js"), "ignore me");
    await writeFile(join(root, "main.ts"), "console.log(1)\n");
    const files = await scanWorkspace(root);
    assert.deepEqual([...files.keys()], ["main.ts"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
