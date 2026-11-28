import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { mcpHeaders } from "../mcp/client.js";
import {
  isConnectionId,
  loadConnectionToken,
  removeConnectionToken,
  saveConnectionToken,
} from "./connection-tokens.js";

describe("connection tokens", () => {
  it("keeps a token per connection and forgets it on request", async () => {
    const secrets = await mkdtemp(path.join(tmpdir(), "roan-secrets-"));
    try {
      assert.equal(await loadConnectionToken(secrets, "github"), null);
      await saveConnectionToken(secrets, "github", "  tok-123  ");
      assert.equal(await loadConnectionToken(secrets, "github"), "tok-123");
      assert.equal(await loadConnectionToken(secrets, "linear"), null);
      await removeConnectionToken(secrets, "github");
      assert.equal(await loadConnectionToken(secrets, "github"), null);
      await removeConnectionToken(secrets, "github");
    } finally {
      await rm(secrets, { recursive: true, force: true });
    }
  });

  it("refuses an empty token and an id that is not a plain name", async () => {
    const secrets = await mkdtemp(path.join(tmpdir(), "roan-secrets-"));
    try {
      await assert.rejects(saveConnectionToken(secrets, "github", "   "), /token is empty/);
      await assert.rejects(saveConnectionToken(secrets, "../escape", "tok"), /not a usable connection id/);
      assert.equal(await loadConnectionToken(secrets, "../escape"), null);
      assert.equal(isConnectionId("git-hub.1"), true);
      assert.equal(isConnectionId("a/b"), false);
      assert.equal(isConnectionId(""), false);
    } finally {
      await rm(secrets, { recursive: true, force: true });
    }
  });
});

describe("the headers of a connection", () => {
  it("carry the token and the session only when there is one", () => {
    const plain = mcpHeaders({ token: null, session: null });
    assert.equal(plain["authorization"], undefined);
    assert.equal(plain["mcp-session-id"], undefined);
    assert.equal(plain["content-type"], "application/json");

    const signedIn = mcpHeaders({ token: "tok-123", session: "s-9" });
    assert.equal(signedIn["authorization"], "Bearer tok-123");
    assert.equal(signedIn["mcp-session-id"], "s-9");
    assert.equal(mcpHeaders({ token: "", session: null })["authorization"], undefined);
  });
});
