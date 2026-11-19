import assert from "node:assert/strict";
import { test } from "node:test";

import { readNodes } from "./nodes.js";
import type { Event } from "../protocol/types.js";

function nodeEvent(seq: number, data: Record<string, unknown>): Event {
  return { v: 1, chain: "c", seq, id: `e${String(seq)}`, node: "writer", ts: seq, type: "node", data };
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
