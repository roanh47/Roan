import { test } from "node:test";
import assert from "node:assert/strict";
import { EventStore } from "../chain/store.js";
import { ChainNodeStore } from "./peer-store.js";
import type { Event } from "../sync/types.js";

const CHAIN = "chain-1";

function draft(seq: number, id: string): Event {
  return {
    v: 1,
    chain: CHAIN,
    seq,
    id,
    node: "node-a",
    ts: 1767225600000,
    type: "message",
    data: { text: "x" },
  };
}

test("since(0) means the whole chain, not an error", () => {
  const store = EventStore.open(":memory:");
  const node = new ChainNodeStore(store, "node-a", CHAIN);
  store.append(CHAIN, { id: "e1", node: "node-a", type: "message", data: { text: "a" } });
  store.append(CHAIN, { id: "e2", node: "node-a", type: "message", data: { text: "b" } });

  assert.equal(node.since(0).length, 2);
  assert.equal(node.since(1).length, 2);
  assert.equal(node.since(2).length, 1);
  store.close();
});

test("append writes only on head + 1 and reports duplicates and conflicts", () => {
  const store = EventStore.open(":memory:");
  const node = new ChainNodeStore(store, "node-a", CHAIN);

  assert.deepEqual(node.append(draft(1, "e1")), { status: "appended" });
  assert.deepEqual(node.append(draft(1, "e1")), { status: "duplicate" });
  assert.deepEqual(node.append(draft(1, "other")), { status: "conflict", existingId: "e1" });
  assert.deepEqual(node.append(draft(3, "e3")), { status: "conflict", existingId: "" });
  assert.equal(node.head(), 1);
  store.close();
});

test("a local write reaches subscribers; one applied from a peer does not echo", () => {
  const store = EventStore.open(":memory:");
  const node = new ChainNodeStore(store, "node-a", CHAIN);
  const seen: string[] = [];
  const stop = node.subscribe((event) => seen.push(event.id));

  // Local writers — the app's message, a turn — append through the store.
  store.append(CHAIN, { id: "local", node: "node-a", type: "message", data: { text: "x" } });
  assert.deepEqual(seen, ["local"]);

  // Replication applies what a peer sent through the node store, and that path
  // must stay silent or every node would push the same event round for ever.
  assert.deepEqual(node.append(draft(2, "remote")), { status: "appended" });
  assert.deepEqual(seen, ["local"], "an event from a peer must not be pushed back out");

  stop();
  store.append(CHAIN, { id: "after-stop", node: "node-a", type: "message", data: { text: "y" } });
  assert.deepEqual(seen, ["local"]);
  store.close();
});
