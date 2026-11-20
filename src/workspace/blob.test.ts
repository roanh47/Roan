import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Event, EventType } from "../protocol/types.js";

import { BlobSlate, blobChunks, hashBuffer, parseBlobEvent } from "./blob.js";
import { scanWorkspace } from "./scan.js";
import { applyWorkspaceEvent } from "./sync.js";

function event(seq: number, type: EventType, data: unknown): Event {
  return { v: 1, chain: "c", seq, id: `e${String(seq)}`, node: "n", ts: seq, type, data };
}

test("chunking is a lossless round trip, however many parts", () => {
  const small = Buffer.from("hallo blobkanaal");
  const one = blobChunks(small, 8);
  assert.equal(one.length, 2);
  assert.equal(Buffer.concat(one.map((part) => Buffer.from(part.data, "base64"))).toString("utf8"), "hallo blobkanaal");

  const big = Buffer.alloc(700 * 1024, 7);
  const parts = blobChunks(big, 256 * 1024);
  assert.equal(parts.length, 3);
  const back = Buffer.concat(parts.map((part) => Buffer.from(part.data, "base64")));
  assert.equal(hashBuffer(back), hashBuffer(big));
});

test("the slate releases a file only when the set is complete and honest", () => {
  const buffer = Buffer.alloc(600 * 1024, 3);
  const hash = hashBuffer(buffer);
  const slate = new BlobSlate();
  const parts = blobChunks(buffer, 256 * 1024);
  for (const [index, part] of parts.entries()) {
    const complete = slate.add(event(index + 1, "blob", { hash, path: "groot.bin", ...part }));
    assert.equal(complete, index === parts.length - 1);
  }
  const whole = slate.get(hash);
  assert.ok(whole !== null);
  assert.equal(whole.length, buffer.length);

  // An incomplete set stays locked, a lying chunk never becomes a file.
  const other = new BlobSlate();
  const first = blobChunks(buffer, 256 * 1024)[0] as { chunk: number; chunks: number; data: string };
  other.add(event(1, "blob", { hash, path: "groot.bin", ...first }));
  assert.equal(other.get(hash), null);
  const liar = new BlobSlate();
  const lie = blobChunks(Buffer.alloc(600 * 1024, 9), 256 * 1024);
  for (const part of lie) liar.add(event(part.chunk + 1, "blob", { hash, path: "groot.bin", ...part }));
  assert.equal(liar.get(hash), null);
});

test("parseBlobEvent rejects shapes that are not ours", () => {
  assert.equal(parseBlobEvent(event(1, "workspace", {})), null);
  assert.equal(parseBlobEvent(event(1, "blob", "geen object")), null);
  assert.equal(parseBlobEvent(event(1, "blob", { hash: "af", path: "x", chunk: 0, chunks: 1, data: "QQ==" })), null);
  assert.equal(parseBlobEvent(event(1, "blob", { hash: "a".repeat(64), path: "../x", chunk: 0, chunks: 1, data: "QQ==" })), null);
  const good = parseBlobEvent(event(1, "blob", { hash: "a".repeat(64), path: "x.bin", chunk: 1, chunks: 3, data: "QQ==" }));
  assert.ok(good !== null);
  assert.equal(good.chunks, 3);
});

test("the scan splits: text rides alone, big and binary ride the blob lane", async () => {
  const root = await mkdtemp(join(tmpdir(), "roan-blob-"));
  try {
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "klein.txt"), "gewoon tekst");
    await writeFile(join(root, "groot.txt"), "x".repeat(600 * 1024));
    await writeFile(join(root, "plaat.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a, 0x1a, 0x0a]));
    const scanned = await scanWorkspace(root);
    assert.deepEqual([...scanned.files.keys()], ["klein.txt"]);
    assert.deepEqual([...scanned.blobs.keys()].sort(), ["groot.txt", "plaat.png"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a blob put writes the reassembled file; missing chunks refuse honestly", async () => {
  const root = await mkdtemp(join(tmpdir(), "roan-blob-"));
  try {
    const buffer = Buffer.alloc(600 * 1024, 5);
    const hash = hashBuffer(buffer);
    const slate = new BlobSlate();
    for (const part of blobChunks(buffer, 256 * 1024)) {
      slate.add(event(part.chunk + 1, "blob", { hash, path: "groot.bin", ...part }));
    }
    const put = event(9, "workspace", { op: "put", path: "groot.bin", blobHash: hash, bytes: buffer.length });
    const outcome = await applyWorkspaceEvent(root, put, slate);
    assert.deepEqual(outcome, { kind: "written", path: "groot.bin" });
    const { readFile } = await import("node:fs/promises");
    const onDisk = await readFile(join(root, "groot.bin"));
    assert.equal(hashBuffer(onDisk), hash);

    const emptySlate = new BlobSlate();
    const refused = await applyWorkspaceEvent(root, put, emptySlate);
    assert.deepEqual(refused, { kind: "refused", path: "groot.bin", reason: "chunks missing" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
