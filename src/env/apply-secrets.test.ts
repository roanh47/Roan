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
 * Secrets belong to a device. An incoming config without a key must not erase
 * the local one: applying such a snapshot left every node without provider
 * credentials, and the only symptom was a message that never got an answer.
 */
test("an incoming config without a key keeps the local key", async () => {
  const source = await mkdtemp(join(tmpdir(), "roan-env-nokey-"));
  const target = await mkdtemp(join(tmpdir(), "roan-env-key-"));
  try {
    await writeFile(join(source, "config.json"), JSON.stringify({ model: "remote-model", provider: "lmstudio" }), "utf8");
    await writeFile(
      join(target, "config.json"),
      JSON.stringify({ model: "old", provider: "lmstudio", apiKey: "sk-local-secret" }),
      "utf8",
    );

    const snapshot = await packEnv({ home: source, chainId: "chain-1", nodeId: "node-peer" });
    await applyEnvSnapshot(snapshot, { home: target });

    const written = JSON.parse(await readFile(join(target, "config.json"), "utf8")) as Record<string, unknown>;
    assert.equal(written["apiKey"], "sk-local-secret", "the device keeps its own key");
    assert.equal(written["model"], "remote-model", "the incoming settings still apply");
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
});

test("an incoming config with a key wins", async () => {
  const source = await mkdtemp(join(tmpdir(), "roan-env-keysrc-"));
  const target = await mkdtemp(join(tmpdir(), "roan-env-keydst-"));
  try {
    await writeFile(join(source, "config.json"), JSON.stringify({ model: "m", apiKey: "sk-from-chain" }), "utf8");
    await writeFile(join(target, "config.json"), JSON.stringify({ model: "old", apiKey: "sk-local" }), "utf8");

    const snapshot = await packEnv({ home: source, chainId: "chain-1", nodeId: "node-peer" });
    // packEnv strips the key on the way out, so put it back the way a build
    // that predates the redaction would have published it.
    const entries = snapshot.entries.map((entry): EnvEntry => {
      if (entry.path !== "config.json" || entry.kind !== "file") return entry;
      const text = JSON.stringify({ model: "m", apiKey: "sk-from-chain" });
      const bytes = Buffer.from(text, "utf8");
      return { ...entry, content: text, size: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") };
    });
    await applyEnvSnapshot({ ...snapshot, entries, hash: hashEnvEntries(entries) }, { home: target });

    const written = JSON.parse(await readFile(join(target, "config.json"), "utf8")) as Record<string, unknown>;
    // The chain's copy is redacted on the way in, so what the device ends up
    // with is its own key — never the peer's.
    assert.equal(written["apiKey"], "sk-local", "the device keeps its own key");
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
});
