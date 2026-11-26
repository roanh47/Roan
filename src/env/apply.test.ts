import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { applyEnvSnapshot } from "./apply.js";
import { hashEnvEntries, packEnv } from "./pack.js";
import type { EnvEntry } from "./types.js";

/**
 * A build that predates the secret redaction publishes the provider key inside
 * config.json. Applying that snapshot on a newer node must drop the key and
 * still report a clean apply: comparing the read-back against the peer's raw
 * hash failed, the daemon parked the env and exited.
 */
test("a snapshot that still carries the api key applies cleanly and loses the key", async () => {
  const source = await mkdtemp(join(tmpdir(), "roan-env-src-"));
  const target = await mkdtemp(join(tmpdir(), "roan-env-dst-"));
  try {
    const settings = { baseUrl: "http://127.0.0.1:1234/v1", model: "m", apiKey: "sk-old-peer-secret" };
    await writeFile(join(source, "config.json"), JSON.stringify(settings), "utf8");

    // What an old peer would have published: the packed snapshot with the key
    // put back in, and the hash recomputed over that content.
    const snapshot = await packEnv({ home: source, chainId: "chain-1", nodeId: "node-peer" });
    const entries = snapshot.entries.map((entry): EnvEntry => {
      if (entry.kind !== "file" || entry.path !== "config.json" || typeof entry.content !== "string") return entry;
      const text = JSON.stringify(settings);
      const bytes = Buffer.from(text, "utf8");
      return { ...entry, content: text, size: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") };
    });
    const oldPeer = { ...snapshot, entries, hash: hashEnvEntries(entries) };

    const result = await applyEnvSnapshot(oldPeer, { home: target });
    assert.ok(result.written.includes("config.json"));

    const written = JSON.parse(await readFile(join(target, "config.json"), "utf8")) as Record<string, unknown>;
    assert.equal("apiKey" in written, false, "the key must not be written");
    assert.equal(written["model"], "m", "the rest of the settings still applies");
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
});
