import assert from "node:assert/strict";
import { test } from "node:test";

import { foldNodeRoster, nodesFromEvents, readNodes } from "./nodes.js";
import type { Event } from "../protocol/types.js";

function nodeEvent(seq: number, data: Record<string, unknown>): Event {
  return { v: 1, chain: "c", seq, id: `e${String(seq)}`, node: "writer", ts: seq, type: "node", data };
}

function removeEvent(seq: number, node: string, by = "writer"): Event {
  return {
    v: 1,
    chain: "c",
    seq,
    id: `e${String(seq)}`,
    node: by,
    ts: seq,
    type: "node_remove",
    data: { node, by },
  };
}

test("the newest announcement per node wins", () => {
  const roster = readNodes([
    nodeEvent(1, { node: "node-a", name: "Roans-Server", host: "100.64.0.1", port: 7412 }),
    nodeEvent(2, { node: "node-b", name: "Phone", host: "100.64.0.9", port: 7412 }),
    // The server moved: the old address is worse than none.
    nodeEvent(3, { node: "node-a", name: "Roans-Server", host: "100.64.0.2", port: 7412 }),
  ]);
  assert.deepEqual(
    roster.map((entry) => [entry.node, entry.host]),
    [
      ["node-a", "100.64.0.2"],
      ["node-b", "100.64.0.9"],
    ],
  );
});

/** A user rename is just the next announcement: it rides the chain and every
 *  device folds the same roster. */
test("a rename arrives as the newest fact, keeping the address", () => {
  const roster = readNodes([
    nodeEvent(1, { node: "node-a", name: "localhost", host: "100.64.0.9", port: 7412 }),
    nodeEvent(2, { node: "node-a", name: "Roans telefoon", host: "100.64.0.9", port: 7412 }),
  ]);
  assert.equal(roster.length, 1);
  assert.equal(roster[0]?.name, "Roans telefoon");
  assert.equal(roster[0]?.host, "100.64.0.9");
});

test("an announcement without its own node id falls back to the writer", () => {
  const roster = readNodes([nodeEvent(1, { name: "Writer zelf", host: "1.2.3.4", port: 7412 })]);
  assert.equal(roster.length, 1);
  assert.equal(roster[0]?.node, "writer");
  assert.equal(roster[0]?.name, "Writer zelf");
});

test("an announcement that is not an object is skipped, not fatal", () => {
  const broken: Event = { v: 1, chain: "c", seq: 1, id: "e1", node: "writer", ts: 1, type: "node", data: null };
  const roster = readNodes([broken, nodeEvent(2, { node: "node-a", name: "Ok" })]);
  assert.equal(roster.length, 1);
  assert.equal(roster[0]?.name, "Ok");
});

/* ------------------------------ membership ------------------------------- */

const twoNodes = [
  nodeEvent(1, { node: "node-a", name: "Roans-Server", host: "100.64.0.1", port: 7412 }),
  nodeEvent(2, { node: "node-b", name: "Phone", host: "100.64.0.9", port: 7412 }),
];

test("a removal hides a node from the roster", () => {
  const events = [...twoNodes, removeEvent(3, "node-b")];
  assert.deepEqual(
    nodesFromEvents(events).map((entry) => entry.node),
    ["node-a"],
  );
  assert.deepEqual([...foldNodeRoster(events).removed], ["node-b"]);
  // The same fold through the long-standing name, so a caller cannot get a
  // list that still offers a removed machine.
  assert.deepEqual(
    readNodes(events).map((entry) => entry.node),
    ["node-a"],
  );
});

test("a device that announces itself again comes back", () => {
  const events = [
    ...twoNodes,
    removeEvent(3, "node-b"),
    // The phone reconnects and says who it is: a live device is not a ghost.
    nodeEvent(4, { node: "node-b", name: "Phone", host: "100.64.0.9", port: 7412 }),
  ];
  assert.deepEqual(
    nodesFromEvents(events).map((entry) => entry.node),
    ["node-a", "node-b"],
  );
  assert.equal(foldNodeRoster(events).removed.size, 0);
});

test("removing the same node twice changes nothing", () => {
  const once = [...twoNodes, removeEvent(3, "node-b")];
  const twice = [...once, removeEvent(4, "node-b")];
  assert.deepEqual(nodesFromEvents(twice), nodesFromEvents(once));
  assert.deepEqual([...foldNodeRoster(twice).removed], ["node-b"]);
});

test("an announcement before the removal does not sneak back in", () => {
  const events = [
    nodeEvent(1, { node: "node-a", name: "Roans-Server", host: "100.64.0.1", port: 7412 }),
    removeEvent(2, "node-a"),
    // An older address is still only an announcement, but it arrives *before*
    // the removal in chain order, so the newest statement about node-a wins.
    nodeEvent(3, { node: "node-b", name: "Phone" }),
  ];
  assert.deepEqual(
    nodesFromEvents(events).map((entry) => entry.node),
    ["node-b"],
  );
});

test("a removal without a usable payload removes nobody", () => {
  const broken: Event = {
    v: 1,
    chain: "c",
    seq: 3,
    id: "e3",
    node: "writer",
    ts: 3,
    type: "node_remove",
    data: null,
  };
  assert.deepEqual(
    nodesFromEvents([...twoNodes, broken]).map((entry) => entry.node),
    ["node-a", "node-b"],
  );
});
