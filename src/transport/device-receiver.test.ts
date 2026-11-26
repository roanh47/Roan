import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { grantsFromEvents, type DeviceRunner } from "../sync/device-control.js";
import { createMemoryStore, type MemoryStore } from "../sync/memory-store.js";
import type { Event } from "../sync/types.js";
import { TEST_CHAIN, syncBothWays, withTwoNodes } from "../testing/two-node.js";
import type { DeviceReqFrame } from "./protocol.js";
import { receiveDeviceRequest, type DeviceResultPayload, type DeviceReceiveOptions } from "./server.js";

const CHAIN = "gesprek";
const ME = "desktop";
const PEER = "laptop";

/** Records every argv; never starts a process. */
function recorder(): { run: DeviceRunner; calls: (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  return {
    calls,
    run: (argv) => {
      calls.push(argv);
      return `ran ${argv.join(" ")}`;
    },
  };
}

function grantEvent(seq: number, node: string, enabled: boolean): Event {
  return {
    v: 1,
    chain: CHAIN,
    seq,
    id: `grant-${String(seq)}`,
    node: "owner",
    ts: 1_700_000_000_000 + seq,
    type: "device_grant",
    data: { node, enabled },
  };
}

function storeWith(events: Event[] = []): MemoryStore {
  return createMemoryStore({ chain: CHAIN, nodeId: ME, events });
}

function requestFrame(node: string, command: string, extra: Record<string, unknown> = {}): DeviceReqFrame {
  return { t: "device_req", chain: CHAIN, node, command, ...extra } as DeviceReqFrame;
}

function results(store: MemoryStore): DeviceResultPayload[] {
  return store
    .all()
    .filter((event) => event.type === "device_result")
    .map((event) => event.data as DeviceResultPayload);
}

function lastResult(store: MemoryStore): DeviceResultPayload {
  const all = results(store);
  const last = all[all.length - 1];
  assert.ok(last !== undefined, "expected a device_result event");
  return last;
}

function options(store: MemoryStore, run: DeviceRunner): DeviceReceiveOptions {
  return {
    store,
    self: ME,
    chain: CHAIN,
    run,
    now: () => 1_700_000_000_999,
    nextId: () => "result-1",
  };
}

describe("receiveDeviceRequest", () => {
  it("runs an allowlisted command the chain granted and records the output", async () => {
    const store = storeWith([grantEvent(1, ME, true)]);
    const { run, calls } = recorder();

    await receiveDeviceRequest(requestFrame(ME, "uptime"), options(store, run));

    assert.equal(calls.length, 1, "the runner must be called once");
    assert.deepEqual(calls[0], ["uptime"], "the runner gets the allowlisted argv, nothing else");

    const result = lastResult(store);
    assert.deepEqual(result, { node: ME, command: "uptime", accepted: true, output: "ran uptime" });

    const event = store.all()[1];
    assert.ok(event !== undefined);
    assert.equal(event.type, "device_result");
    assert.equal(event.chain, CHAIN);
    assert.equal(event.node, ME);
    assert.equal(event.seq, 2);
    assert.equal(event.id, "result-1");
    assert.equal(event.ts, 1_700_000_000_999);
  });

  it("refuses a request without a grant and never calls the runner", async () => {
    const store = storeWith();
    const { run, calls } = recorder();

    await receiveDeviceRequest(requestFrame(ME, "uptime"), options(store, run));

    assert.equal(calls.length, 0, "no grant means the runner is never reached");
    assert.equal(store.head(), 1, "the refusal is still recorded");
    const result = lastResult(store);
    assert.equal(result.accepted, false);
    assert.equal(result.node, ME);
    assert.equal(result.command, "uptime");
    assert.match(result.reason ?? "", /no grant/);
    assert.equal("output" in result, false);
  });

  it("refuses a disabled grant and never calls the runner", async () => {
    const store = storeWith([grantEvent(1, ME, false)]);
    const { run, calls } = recorder();

    await receiveDeviceRequest(requestFrame(ME, "date"), options(store, run));

    assert.equal(calls.length, 0);
    assert.match(lastResult(store).reason ?? "", /disabled/);
  });

  it("ignores a grant made out to another node", async () => {
    const store = storeWith([grantEvent(1, PEER, true)]);
    const { run, calls } = recorder();

    await receiveDeviceRequest(requestFrame(ME, "date"), options(store, run));

    assert.equal(calls.length, 0, "a grant for a peer is not a grant for this node");
    assert.match(lastResult(store).reason ?? "", /no grant/);
  });

  it("refuses a command outside the allowlist and never calls the runner", async () => {
    const store = storeWith([grantEvent(1, ME, true)]);
    const { run, calls } = recorder();

    await receiveDeviceRequest(requestFrame(ME, "rm -rf /"), options(store, run));

    assert.equal(calls.length, 0);
    assert.match(lastResult(store).reason ?? "", /not in the allowlist/);
  });

  it("refuses a tampered argv and never calls the runner", async () => {
    const store = storeWith([grantEvent(1, ME, true)]);
    const { run, calls } = recorder();

    await receiveDeviceRequest(requestFrame(ME, "uptime", { argv: ["uptime", "--all"] }), options(store, run));

    assert.equal(calls.length, 0);
    assert.match(lastResult(store).reason ?? "", /argv/);
  });

  it("refuses a request addressed to another node and never calls the runner", async () => {
    const store = storeWith([grantEvent(1, PEER, true)]);
    const { run, calls } = recorder();

    await receiveDeviceRequest(requestFrame(PEER, "uptime"), options(store, run));

    assert.equal(calls.length, 0);
    assert.match(lastResult(store).reason ?? "", /another node/);
  });

  it("refuses a request that names another chain and never calls the runner", async () => {
    const store = storeWith([grantEvent(1, ME, true)]);
    const { run, calls } = recorder();

    await receiveDeviceRequest({ t: "device_req", chain: "andere", node: ME, command: "uptime" }, options(store, run));

    assert.equal(calls.length, 0);
    assert.match(lastResult(store).reason ?? "", /another chain/);
  });

  it("records a failing runner as a refusal instead of throwing", async () => {
    const store = storeWith([grantEvent(1, ME, true)]);
    const run: DeviceRunner = () => {
      throw new Error("execFile exploded");
    };

    await receiveDeviceRequest(requestFrame(ME, "uptime"), options(store, run));

    const result = lastResult(store);
    assert.equal(result.accepted, false);
    assert.match(result.reason ?? "", /runner failed: execFile exploded/);
  });

  it("never throws when the store itself refuses the result", async () => {
    const store = storeWith([grantEvent(1, ME, true)]);
    const broken: MemoryStore = {
      ...store,
      append: () => {
        throw new Error("disk is gone");
      },
    };
    const { run, calls } = recorder();

    await receiveDeviceRequest(requestFrame(ME, "uptime"), options(broken, run));

    assert.equal(calls.length, 1, "the command ran before the store failed");
    assert.equal(results(store).length, 0);
  });
});

describe("grant gate over two nodes", () => {
  it("only runs after the grant has replicated, and the result travels back", async () => {
    await withTwoNodes(async (a, b) => {
      const { run, calls } = recorder();

      await receiveDeviceRequest(
        { t: "device_req", chain: TEST_CHAIN, node: "b", command: "uname -a" },
        { store: b.store, self: "b", chain: TEST_CHAIN, run },
      );
      assert.equal(calls.length, 0, "before a grant exists on B, nothing runs");

      const refused = b.store.all()[0];
      assert.ok(refused !== undefined);
      assert.equal(refused.type, "device_result");
      assert.equal((refused.data as DeviceResultPayload).accepted, false);

      await a.append("device_grant", { node: "b", enabled: true });
      await syncBothWays(a, b);
      assert.equal(grantsFromEvents(b.store.since(1)).get("b")?.enabled, true);

      await receiveDeviceRequest(
        { t: "device_req", chain: TEST_CHAIN, node: "b", command: "uname -a" },
        { store: b.store, self: "b", chain: TEST_CHAIN, run },
      );
      assert.equal(calls.length, 1, "with the grant replicated, the runner is called once");
      assert.deepEqual(calls[0], ["uname", "-a"]);

      const accepted = b.store
        .all()
        .filter((event) => event.type === "device_result")
        .at(-1);
      assert.ok(accepted !== undefined);
      assert.deepEqual(accepted.data, {
        node: "b",
        command: "uname -a",
        accepted: true,
        output: "ran uname -a",
      });

      await syncBothWays(a, b);
      const seenByA = a.store.all().filter((event) => event.type === "device_result");
      assert.equal(seenByA.length, 2, "both outcomes replicate back to A");
      assert.equal((seenByA[1]?.data as DeviceResultPayload).accepted, true);
    });
  });
});
