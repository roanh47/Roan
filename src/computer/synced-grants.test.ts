import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { settingsGrantStore } from "./synced-grants.js";

function harness() {
  let grants: Record<string, number> = {};
  let clock = 1_000;
  const store = settingsGrantStore(
    () => grants,
    (next) => {
      grants = next;
    },
    () => clock,
  );
  return {
    store,
    saved: () => grants,
    tick: (ms: number) => {
      clock += ms;
    },
    // What another device sees after the config synced: the same map.
    synced: () => settingsGrantStore(() => grants, () => undefined, () => clock),
  };
}

describe("synced computer use permissions", () => {
  it("writes a permission into the settings and reads it back", () => {
    const { store, saved } = harness();
    assert.deepEqual(store.check("chat-1"), { granted: false, reason: "no-grant" });
    const grant = store.grantSession("chat-1", { ttlMs: 60_000 });
    assert.equal(grant.expiresAtMs, 61_000);
    assert.deepEqual(saved(), { "chat-1": 61_000 });
    assert.equal(store.isGranted("chat-1"), true);
  });

  it("counts on a device that only has the synced settings", () => {
    const { store, synced } = harness();
    store.grantSession("chat-1", { ttlMs: 60_000 });
    assert.equal(synced().isGranted("chat-1"), true);
    assert.equal(synced().isGranted("chat-2"), false);
  });

  it("ends by itself, and an ended entry is dropped at the next write", () => {
    const { store, saved, tick } = harness();
    store.grantSession("chat-1", { ttlMs: 60_000 });
    tick(60_000);
    assert.deepEqual(store.check("chat-1"), { granted: false, reason: "expired" });
    store.grantSession("chat-2", { ttlMs: 60_000 });
    assert.deepEqual(Object.keys(saved()), ["chat-2"]);
  });

  it("is taken back at once, everywhere", () => {
    const { store, saved, synced } = harness();
    store.grantSession("chat-1", { ttlMs: 60_000 });
    assert.equal(store.revokeSession("chat-1"), true);
    assert.deepEqual(saved(), {});
    assert.equal(synced().isGranted("chat-1"), false);
    assert.equal(store.revokeSession("chat-1"), false);
  });

  it("refuses a permission without a conversation or without a duration", () => {
    const { store } = harness();
    assert.throws(() => store.grantSession("  "), /needs a conversation/);
    assert.throws(() => store.grantSession("chat-1", { ttlMs: 0 }), /duration above zero/);
  });
});
