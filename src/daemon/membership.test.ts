import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { exportChain, importChain } from "../chain/export.js";
import { nodesFromEvents } from "../chain/nodes.js";
import { EventStore } from "../chain/store.js";
import { withTempDir } from "../testing/temp-dir.js";
import { assertConverged, syncBothWays, withTwoNodes } from "../testing/two-node.js";
import { CANNOT_REMOVE_SELF, removeNode } from "./membership.js";

const CHAIN = "gesprek";
const SELF = "node-self";
const PHONE = "node-b";

/** Two devices, both announced, with this one first. */
function seed(store: EventStore): void {
  store.append(CHAIN, {
    id: "n-self",
    node: SELF,
    ts: 1,
    type: "node",
    data: { node: SELF, name: "Roans-Server", host: "100.64.0.1", port: 6769 },
  });
  store.append(CHAIN, {
    id: "n-phone",
    node: PHONE,
    ts: 2,
    type: "node",
    data: { node: PHONE, name: "Roans telefoon", host: "100.64.0.9", port: 6769 },
  });
}

function withStore<T>(run: (store: EventStore) => T): T {
  const store = EventStore.open(":memory:");
  try {
    return run(store);
  } finally {
    store.close();
  }
}

test("the store accepts node_remove as a chain event", () => {
  withStore((store) => {
    seed(store);
    const event = store.append(CHAIN, {
      id: "remove-1",
      node: SELF,
      ts: 3,
      type: "node_remove",
      data: { node: PHONE, by: SELF },
    });
    assert.equal(event.type, "node_remove");
    const read = store.eventById(CHAIN, "remove-1");
    assert.deepEqual(read?.data, { node: PHONE, by: SELF });
  });
});

test("a removal names the device that asked for it", () => {
  withStore((store) => {
    seed(store);
    const outcome = removeNode(store, CHAIN, SELF, PHONE, () => "event-1");
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.node, PHONE);
    assert.equal(outcome.name, "Roans telefoon");
    assert.equal(outcome.event?.type, "node_remove");
    assert.deepEqual(outcome.event?.data, { node: PHONE, by: SELF });
    assert.equal(store.head(CHAIN), 3);
    assert.deepEqual(
      nodesFromEvents(store.read(CHAIN)).map((entry) => entry.node),
      [SELF],
    );
  });
});

test("a device is found by the name a person would say", () => {
  withStore((store) => {
    seed(store);
    const outcome = removeNode(store, CHAIN, SELF, "Roans telefoon", () => "event-1");
    assert.equal(outcome.ok, true);
    assert.deepEqual(
      nodesFromEvents(store.read(CHAIN)).map((entry) => entry.node),
      [SELF],
    );
  });
});

test("removing your own node is refused, by id and by name", () => {
  withStore((store) => {
    seed(store);
    const byId = removeNode(store, CHAIN, SELF, SELF, () => "event-1");
    assert.equal(byId.ok, false);
    if (!byId.ok) assert.equal(byId.message, CANNOT_REMOVE_SELF);

    const byName = removeNode(store, CHAIN, SELF, "Roans-Server", () => "event-2");
    assert.equal(byName.ok, false);
    if (!byName.ok) assert.equal(byName.message, CANNOT_REMOVE_SELF);

    // Nothing was written: a refusal is not a tombstone.
    assert.equal(store.head(CHAIN), 2);
    assert.deepEqual(
      nodesFromEvents(store.read(CHAIN)).map((entry) => entry.node),
      [SELF, PHONE],
    );
  });
});

test("removing a device that is not in the chain says so", () => {
  withStore((store) => {
    seed(store);
    const outcome = removeNode(store, CHAIN, SELF, "node-nowhere");
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.match(outcome.message, /no machine called "node-nowhere"/);
      // The message lists who is there, so the answer is actionable.
      assert.match(outcome.message, /Roans-Server/);
    }
    assert.equal(store.head(CHAIN), 2);
  });
});

test("removing twice is idempotent", () => {
  withStore((store) => {
    seed(store);
    let counter = 0;
    const newId = (): string => `event-${String(++counter)}`;
    const first = removeNode(store, CHAIN, SELF, PHONE, newId);
    assert.equal(first.ok, true);
    if (first.ok) assert.notEqual(first.event, null);
    const once = nodesFromEvents(store.read(CHAIN));
    assert.equal(store.head(CHAIN), 3);

    const second = removeNode(store, CHAIN, SELF, PHONE, newId);
    assert.equal(second.ok, true);
    // Nothing is written the second time, and the list is the same.
    if (second.ok) assert.equal(second.event, null);
    assert.equal(store.head(CHAIN), 3);
    assert.deepEqual(nodesFromEvents(store.read(CHAIN)), once);
    assert.deepEqual(
      nodesFromEvents(store.read(CHAIN)).map((entry) => entry.node),
      [SELF],
    );
  });
});

test("a node_remove survives export and import", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "chain.jsonl");
    const written = withStore((source) => {
      seed(source);
      removeNode(source, CHAIN, SELF, PHONE, () => "event-1");
      return exportChain(source, CHAIN, path);
    });
    assert.equal(written.count, 3);

    withStore((target) => {
      const outcome = importChain(target, CHAIN, path);
      assert.deepEqual(outcome, { imported: 3, skipped: 0 });
      assert.deepEqual(
        target.read(CHAIN).map((event) => event.type),
        ["node", "node", "node_remove"],
      );
      assert.deepEqual(
        nodesFromEvents(target.read(CHAIN)).map((entry) => entry.node),
        [SELF],
      );
    });
  }, "node-remove-export-");
});

test("a removal reaches the other device, and a re-announcement brings the node back", async () => {
  await withTwoNodes(async (a, b) => {
    const roster = (node: typeof a): string[] =>
      nodesFromEvents(node.store.all() as unknown as import("../protocol/types.js").Event[]).map(
        (entry) => entry.node,
      );

    await a.append("node", { node: "a", name: "Laptop", host: "100.64.0.1", port: 6769 });
    await b.append("node", { node: "b", name: "Telefoon", host: "100.64.0.9", port: 6769 });
    await a.append("node_remove", { node: "b", by: "a" });

    await syncBothWays(a, b);
    assertConverged(a, b);
    // Both devices fold the same statement: the phone is out of the chain.
    assert.deepEqual(roster(a), ["a"]);
    assert.deepEqual(roster(b), ["a"]);

    // The phone is running again and announces itself; a live device is not a
    // ghost, so the tombstone is cleared on every device.
    await b.append("node", { node: "b", name: "Telefoon", host: "100.64.0.9", port: 6769 });
    await syncBothWays(a, b);
    assertConverged(a, b);
    assert.deepEqual(roster(a), ["a", "b"]);
    assert.deepEqual(roster(b), ["a", "b"]);
  });
});
