import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { collectEnvEntries } from "./pack.js";

test("the provider key never travels in the env snapshot", async () => {
  const home = await mkdtemp(join(tmpdir(), "roan-env-"));
  try {
    await mkdir(home, { recursive: true });
    await writeFile(
      join(home, "config.json"),
      JSON.stringify({ baseUrl: "http://127.0.0.1:1234/v1", model: "m", provider: "lmstudio", apiKey: "sk-very-secret" }),
      "utf8",
    );
    const entries = await collectEnvEntries({ home });
    const config = entries.find((entry) => entry.path === "config.json");
    assert.ok(config !== undefined, "config.json should still travel");
    const text = typeof config.content === "string" ? config.content : "";
    assert.equal(text.includes("sk-very-secret"), false, "the key must not be in the entry");
    const parsed = JSON.parse(text) as Record<string, unknown>;
    assert.equal("apiKey" in parsed, false, "apiKey must be dropped");
    assert.equal(parsed["model"], "m", "the rest of the settings still travels");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
