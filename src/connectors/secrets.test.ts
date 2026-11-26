import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { readConnectorToken } from "./secrets.js";

const TOKEN = "fixture-token-not-real-1234";

async function withDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "roan-connector-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeTokenFile(dir: string, text: string, mode = 0o600): Promise<string> {
  const path = join(dir, "github.json");
  await writeFile(path, text, { mode });
  await chmod(path, mode);
  return path;
}

describe("readConnectorToken", () => {
  it("reads the token from a private file", async () => {
    await withDir(async (dir) => {
      const path = await writeTokenFile(dir, JSON.stringify({ token: TOKEN }));
      assert.equal(await readConnectorToken(path), TOKEN);
    });
  });

  it("reads a named field", async () => {
    await withDir(async (dir) => {
      const path = await writeTokenFile(dir, JSON.stringify({ githubToken: TOKEN }));
      assert.equal(await readConnectorToken(path, { field: "githubToken" }), TOKEN);
      await assert.rejects(readConnectorToken(path), /no non-empty "token"/u);
    });
  });

  it("refuses a group- or world-readable file", { skip: process.platform === "win32" }, async () => {
    await withDir(async (dir) => {
      const path = await writeTokenFile(dir, JSON.stringify({ token: TOKEN }), 0o644);
      await assert.rejects(readConnectorToken(path), /chmod 600/u);
    });
  });

  it("refuses a missing file, bad JSON and a non-object", async () => {
    await withDir(async (dir) => {
      await assert.rejects(readConnectorToken(join(dir, "absent.json")), /cannot read/u);
      const broken = await writeTokenFile(dir, "{");
      await assert.rejects(readConnectorToken(broken), /not valid JSON/u);
      const array = await writeTokenFile(dir, "[1,2,3]");
      await assert.rejects(readConnectorToken(array), /JSON object/u);
    });
  });

  it("never quotes the token in an error", async () => {
    await withDir(async (dir) => {
      const path = await writeTokenFile(dir, JSON.stringify({ token: "" }));
      await assert.rejects(readConnectorToken(path), (error) => {
        assert.equal((error as Error).message.includes(TOKEN), false);
        return true;
      });

      const readable = await writeTokenFile(dir, JSON.stringify({ token: TOKEN }), 0o644);
      await assert.rejects(readConnectorToken(readable), (error) => {
        assert.equal((error as Error).message.includes(TOKEN), false);
        return true;
      });
    });
  });

  it("rejects a blank path", async () => {
    await assert.rejects(readConnectorToken("  "), /non-empty string/u);
  });
});
