import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  approveElevation,
  consumeElevation,
  createElevationStore,
  requestElevation,
  type ElevationStore,
} from "./elevation.js";

/** A store with a fake clock and predictable ids. */
function makeStore(): { store: ElevationStore; tick: (ms: number) => void } {
  let clock = 1_000;
  let next = 0;
  const store = createElevationStore({
    ttlMs: 1_000,
    now: () => clock,
    idFactory: () => {
      next += 1;
      return `id-${next}`;
    },
  });
  return {
    store,
    tick: (ms: number) => {
      clock += ms;
    },
  };
}

describe("elevation request", () => {
  it("returns a pending one-time id with the exact command", () => {
    const { store } = makeStore();
    const request = store.request("  systemctl restart nginx  ");

    assert.equal(request.id, "id-1");
    assert.equal(request.command, "  systemctl restart nginx  ");
    assert.equal(request.state, "pending");
    assert.equal(request.createdAtMs, 1_000);
    assert.equal(request.expiresAtMs, 2_000);
    assert.equal(request.approvedAtMs, null);
    assert.ok(Object.isFrozen(request));
  });

  it("accepts a per-request ttl and keeps ids unique", () => {
    const { store } = makeStore();
    const short = store.request("true", { ttlMs: 50 });
    const other = store.request("false");

    assert.equal(short.expiresAtMs, 1_050);
    assert.equal(other.id, "id-2");
    assert.notEqual(short.id, other.id);
  });

  it("refuses an empty command and an empty id", () => {
    const { store } = makeStore();
    assert.throws(() => store.request(""), /non-empty/);
    assert.throws(() => store.request("   "), /non-empty/);
    assert.throws(() => store.approve(""), /non-empty/);
    assert.throws(() => store.consume(" "), /non-empty/);
  });
});

describe("elevation lifecycle", () => {
  it("approves once and refuses the second approval", () => {
    const { store } = makeStore();
    const request = store.request("mount /dev/sdb1 /mnt");

    const first = store.approve(request.id);
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.request.state, "approved");
    assert.equal(first.request.approvedAtMs, 1_000);

    assert.deepEqual(store.approve(request.id), { ok: false, reason: "already-approved" });
    // The refused approval did not disturb the approved request.
    const inspected = store.inspect(request.id);
    assert.equal(inspected?.state, "approved");
    assert.equal(inspected?.approvedAtMs, 1_000);
  });

  it("consumes the command exactly once and kills the id", () => {
    const { store } = makeStore();
    const request = store.request("debugfs -w /dev/sdb1");
    store.approve(request.id);

    assert.deepEqual(store.consume(request.id), {
      ok: true,
      command: "debugfs -w /dev/sdb1",
    });
    assert.deepEqual(store.consume(request.id), { ok: false, reason: "reused" });
    assert.deepEqual(store.approve(request.id), { ok: false, reason: "reused" });
    assert.equal(store.inspect(request.id)?.state, "consumed");
  });

  it("refuses to consume before approval, then allows it after", () => {
    const { store } = makeStore();
    const request = store.request("iptables -L");

    assert.deepEqual(store.consume(request.id), { ok: false, reason: "not-approved" });
    store.approve(request.id);
    assert.equal(store.consume(request.id).ok, true);
  });

  it("expires on the ttl boundary and stays expired", () => {
    const { store, tick } = makeStore();
    const request = store.request("shutdown -r now", { ttlMs: 100 });

    tick(99);
    assert.equal(store.consume(request.id).ok, false);
    tick(1);
    assert.deepEqual(store.consume(request.id), { ok: false, reason: "expired" });
    assert.deepEqual(store.approve(request.id), { ok: false, reason: "expired" });
    assert.equal(store.inspect(request.id)?.state, "expired");
  });

  it("cannot be revived by approving after expiry", () => {
    const { store, tick } = makeStore();
    const request = store.request("reboot");
    tick(5_000);
    assert.deepEqual(store.approve(request.id), { ok: false, reason: "expired" });
    assert.deepEqual(store.consume(request.id), { ok: false, reason: "expired" });
  });

  it("reports unknown ids distinctly from reused and pending ones", () => {
    const { store } = makeStore();
    const request = store.request("true");

    assert.deepEqual(store.approve("never-issued"), { ok: false, reason: "unknown" });
    assert.deepEqual(store.consume("never-issued"), { ok: false, reason: "unknown" });
    assert.equal(store.inspect("never-issued"), undefined);

    assert.deepEqual(store.consume(request.id), { ok: false, reason: "not-approved" });
    assert.equal(store.approve(request.id).ok, true);
  });

  it("lists every retained request with its state", () => {
    const { store } = makeStore();
    const approved = store.request("a");
    const pending = store.request("b");
    const consumed = store.request("c");

    store.approve(approved.id);
    store.approve(consumed.id);
    store.consume(consumed.id);

    const states = store.list().map((view) => view.state);
    assert.equal(states.length, 3);
    assert.equal(states[0], "approved");
    assert.equal(states[1], "pending");
    assert.equal(states[2], "consumed");
    assert.equal(store.inspect(pending.id)?.state, "pending");
  });
});

describe("elevation store bounds", () => {
  it("refuses a new request when every retained slot is live", () => {
    const store = createElevationStore({ maxRecords: 2 });
    store.request("one");
    store.request("two");

    assert.throws(() => store.request("three"), /full/);
  });

  it("reuses the slot of a consumed request", () => {
    const store = createElevationStore({ maxRecords: 2 });
    const first = store.request("one");
    store.request("two");
    store.approve(first.id);
    store.consume(first.id);

    const third = store.request("three");
    assert.equal(store.inspect(third.id)?.state, "pending");
    assert.equal(store.list().length, 2);
  });

  it("rejects a non-positive ttl or capacity", () => {
    assert.throws(() => createElevationStore({ ttlMs: 0 }), /ttlMs/);
    assert.throws(() => createElevationStore({ maxRecords: -1 }), /maxRecords/);
  });
});

describe("standalone elevation functions", () => {
  it("walks one request through the shared store", () => {
    const request = requestElevation("systemctl daemon-reload");
    assert.equal(request.state, "pending");
    assert.notEqual(request.id.length, 0);

    assert.equal(approveElevation(request.id).ok, true);
    assert.deepEqual(consumeElevation(request.id), {
      ok: true,
      command: "systemctl daemon-reload",
    });
    assert.deepEqual(consumeElevation(request.id), { ok: false, reason: "reused" });
  });
});
