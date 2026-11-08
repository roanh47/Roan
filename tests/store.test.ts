import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { EventStore } from "../src/chain/store.js";

function tempDb(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "roan-store-"));
  return { dir, path: join(dir, "chain.sqlite") };
}

test("100 appended events survive a reopen in seq order", (t) => {
  const { dir, path } = tempDb();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const first = EventStore.open(path);
  t.after(() => first.close());

  for (let i = 0; i < 100; i += 1) {
    const stored = first.append("chain-a", {
      id: `evt-${i}`,
      node: "node-1",
      ts: 1_700_000_000_000 + i,
      type: "message",
      data: { i, text: `event ${i}` },
    });
    assert.equal(stored.seq, i + 1);
    assert.equal(stored.chain, "chain-a");
    assert.equal(stored.v, 1);
  }

  assert.equal(first.head("chain-a"), 100);
  first.close();

  const second = EventStore.open(path);
  t.after(() => second.close());

  const events = second.read("chain-a", 1, 200);
  assert.equal(events.length, 100);
  assert.deepEqual(
    events.map((event) => event.seq),
    Array.from({ length: 100 }, (_, i) => i + 1),
  );
  assert.deepEqual(
    events.map((event) => event.id),
    Array.from({ length: 100 }, (_, i) => `evt-${i}`),
  );
  assert.deepEqual(events[42]?.data, { i: 42, text: "event 42" });
  assert.equal(second.head("chain-a"), 100);

  const page = second.read("chain-a", 51, 10);
  assert.deepEqual(
    page.map((event) => event.seq),
    [51, 52, 53, 54, 55, 56, 57, 58, 59, 60],
  );

  assert.deepEqual(second.chains(), [{ chain: "chain-a", count: 100, head: 100 }]);
});

test("append with an existing id is a no-op that returns the stored event", (t) => {
  const { dir, path } = tempDb();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const store = EventStore.open(path);
  t.after(() => store.close());

  const original = store.append("c", {
    id: "same-id",
    node: "n1",
    ts: 10,
    type: "turn_start",
    data: { step: 1 },
  });
  const replay = store.append("c", {
    id: "same-id",
    node: "n1",
    ts: 10,
    type: "turn_start",
    data: { step: 1 },
  });

  assert.deepEqual(replay, original);
  assert.equal(store.head("c"), 1);
  assert.equal(store.read("c").length, 1);

  // The same id in a different chain is a distinct event.
  const other = store.append("d", {
    id: "same-id",
    node: "n1",
    ts: 11,
    type: "turn_start",
    data: null,
  });
  assert.equal(other.seq, 1);
  assert.deepEqual(store.chains(), [
    { chain: "c", count: 1, head: 1 },
    { chain: "d", count: 1, head: 1 },
  ]);
});

test("unknown chains read empty and head at 0", (t) => {
  const { dir, path } = tempDb();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const store = EventStore.open(path);
  t.after(() => store.close());

  assert.deepEqual(store.read("missing"), []);
  assert.equal(store.head("missing"), 0);
  assert.deepEqual(store.chains(), []);
});

test("append rejects a mismatched chain and unknown event types", (t) => {
  const { dir, path } = tempDb();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const store = EventStore.open(path);
  t.after(() => store.close());

  assert.throws(() =>
    store.append("a", {
      chain: "b",
      id: "x",
      node: "n",
      ts: 1,
      type: "message",
      data: null,
    }),
  );
  assert.throws(() =>
    store.append("a", {
      id: "y",
      node: "n",
      ts: 1,
      type: "nonsense" as unknown as "message",
      data: null,
    }),
  );
  assert.equal(store.head("a"), 0);
});
