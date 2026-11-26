import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryStore, type MemoryStore } from "./memory-store.js";
import { canonicalIds, compareBranches, orderBranches, sameEvents } from "./order.js";
import { ReplicationSession } from "./replicate.js";
import type { Event, Frame, Logger, PeerTransport } from "./types.js";

const CHAIN = "gesprek";
const TS = 1_700_000_000_000;

const quietLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function draft(seq: number, node: string, id: string, ts: number): Event {
  return { v: 1, chain: CHAIN, seq, id, node, ts, type: "message", data: { id } };
}

/** One end of a synchronous duplex link; the frame arrives before `send` returns. */
class Wire implements PeerTransport {
  readonly label: string;
  private messageHandler: ((raw: string) => void) | undefined;
  private peer: Wire | undefined;
  readonly sent: Frame[] = [];

  constructor(label: string) {
    this.label = label;
  }

  static pair(leftLabel: string, rightLabel: string): [Wire, Wire] {
    const left = new Wire(leftLabel);
    const right = new Wire(rightLabel);
    left.peer = right;
    right.peer = left;
    return [left, right];
  }

  send(frame: Frame): void {
    this.sent.push(frame);
    this.peer?.receive(JSON.stringify(frame));
  }

  close(): void {}

  onMessage(handler: (raw: string) => void): void {
    this.messageHandler = handler;
  }

  onClose(): void {}

  private receive(raw: string): void {
    this.messageHandler?.(raw);
  }
}

interface MeshNode {
  readonly store: MemoryStore;
  readonly sessions: ReplicationSession[];
}

/**
 * Links every node to every other node *after* the stores exist, so a test can
 * let two writers take the same seq before anything can be exchanged.
 */
function wire(nodes: Map<string, MemoryStore>): Map<string, MeshNode> {
  const wired = new Map<string, MeshNode>();
  for (const [id, store] of nodes) wired.set(id, { store, sessions: [] });
  const ids = [...nodes.keys()];

  for (let left = 0; left < ids.length; left++) {
    for (let right = left + 1; right < ids.length; right++) {
      const leftId = ids[left];
      const rightId = ids[right];
      if (leftId === undefined || rightId === undefined) continue;
      const leftNode = wired.get(leftId);
      const rightNode = wired.get(rightId);
      if (leftNode === undefined || rightNode === undefined) continue;
      const [leftWire, rightWire] = Wire.pair(`${leftId}->${rightId}`, `${rightId}->${leftId}`);
      leftNode.sessions.push(
        new ReplicationSession({ store: leftNode.store, transport: leftWire, logger: quietLogger }),
      );
      rightNode.sessions.push(
        new ReplicationSession({ store: rightNode.store, transport: rightWire, logger: quietLogger }),
      );
    }
  }
  return wired;
}

function emptyStores(nodeIds: readonly string[]): Map<string, MemoryStore> {
  const stores = new Map<string, MemoryStore>();
  for (const id of nodeIds) stores.set(id, createMemoryStore({ chain: CHAIN, nodeId: id }));
  return stores;
}

function startAll(nodes: Map<string, MeshNode>): void {
  // The hello is the request: every link compares heads and merges what differs.
  for (const node of nodes.values()) for (const session of node.sessions) session.start();
}

function closeAll(nodes: Map<string, MeshNode>): void {
  for (const node of nodes.values()) for (const session of node.sessions) session.close("done");
}

describe("branch order", () => {
  it("sorts by timestamp, then node, then id", () => {
    const early = draft(3, "b", "b-1", 1_000);
    const late = draft(3, "a", "a-1", 2_000);
    const tieNodeA = draft(3, "a", "z", 1_000);
    const tieNodeB = draft(3, "b", "a", 1_000);
    const ordered = orderBranches([late, tieNodeB, tieNodeA, early]);
    assert.deepEqual(
      ordered.map((event) => event.id),
      ["z", "a", "b-1", "a-1"],
    );
    assert.equal(compareBranches(early, early), 0);
    assert.ok(compareBranches(early, late) < 0);
    assert.ok(compareBranches(late, early) > 0);
  });

  it("orders events with the same timestamp and node by id", () => {
    const first = draft(1, "a", "aaa", 500);
    const second = draft(1, "a", "bbb", 500);
    assert.deepEqual(orderBranches([second, first]).map((event) => event.id), ["aaa", "bbb"]);
  });

  it("two observers that receive one contested group in either order place it the same way", () => {
    const deliver = (order: readonly string[]): string[] => {
      const store = createMemoryStore({ chain: CHAIN, nodeId: "kijker" });
      const transport = new FakeOneWay("peer");
      new ReplicationSession({ store, transport, logger: quietLogger });
      // A gap first: the group competes for seq 2 while the store is empty, so
      // it waits until seq 1 arrives.
      const events: Record<string, Event> = {
        late: draft(2, "c", "late", TS + 50),
        early: draft(2, "a", "early", TS),
      };
      transport.deliver({
        t: "events",
        events: order.map((key) => {
          const event = events[key];
          if (event === undefined) throw new Error(`no such event: ${key}`);
          return event;
        }),
      });
      transport.deliver({ t: "append", event: draft(1, "a", "first", TS - 50) });
      return store.all().map((event) => event.id);
    };

    const forwards = deliver(["late", "early"]);
    const backwards = deliver(["early", "late"]);
    assert.deepEqual(forwards, ["first", "early", "late"]);
    assert.deepEqual(backwards, forwards, "arrival order decided the order, not the rule");
  });
});

/** A transport that only receives; enough for "what does this node make of this". */
class FakeOneWay implements PeerTransport {
  readonly label: string;
  private messageHandler: ((raw: string) => void) | undefined;

  constructor(label: string) {
    this.label = label;
  }

  send(): void {}

  close(): void {}

  onMessage(handler: (raw: string) => void): void {
    this.messageHandler = handler;
  }

  onClose(): void {}

  deliver(frame: Frame): void {
    this.messageHandler?.(JSON.stringify(frame));
  }
}

describe("three and four simultaneous writers", () => {
  it("three writers keep every branch and agree on the order", () => {
    const writers = ["a", "b", "c"];
    const stores = emptyStores([...writers, "observer"]);
    // Each writer takes seq 1 before any link exists: a real collision.
    for (const id of writers) {
      const store = stores.get(id);
      assert.ok(store !== undefined);
      store.append(draft(1, id, `${id}-1`, TS));
    }
    const nodes = wire(stores);
    startAll(nodes);

    const chains = writers.map((id) => nodes.get(id)?.store.all() ?? []);
    const observer = nodes.get("observer")?.store.all() ?? [];
    assert.equal(observer.length, writers.length, "the observer is missing a branch");

    for (const [index, chain] of chains.entries()) {
      assert.equal(chain.length, writers.length, `node ${writers[index] ?? "?"} lost a branch`);
      assert.ok(sameEvents(chain, observer), `node ${writers[index] ?? "?"} holds other events`);
      assert.deepEqual(canonicalIds(chain), canonicalIds(observer), "the chains do not project to one order");
    }
    // Mirror: a writer keeps its own branch in front of the others'.
    for (const [index, id] of writers.entries()) {
      assert.equal(chains[index]?.[0]?.node, id);
    }
    closeAll(nodes);
  });

  it("four writers keep every branch and agree on the order", () => {
    const writers = ["a", "b", "c", "d"];
    const stores = emptyStores([...writers, "observer"]);
    for (const id of writers) {
      const store = stores.get(id);
      assert.ok(store !== undefined);
      store.append(draft(1, id, `${id}-1`, TS));
    }
    const nodes = wire(stores);
    startAll(nodes);

    const observer = nodes.get("observer")?.store.all() ?? [];
    assert.equal(observer.length, writers.length, "the observer is missing a branch");
    const canonical = canonicalIds(observer);

    for (const id of writers) {
      const chain = nodes.get(id)?.store.all() ?? [];
      assert.equal(chain.length, writers.length, `node ${id} lost a branch`);
      assert.ok(sameEvents(chain, observer), `node ${id} holds other events`);
      assert.deepEqual(canonicalIds(chain), canonical, `node ${id} computes another order`);
      assert.equal(chain[0]?.node, id, `node ${id} does not keep its own branch first`);
    }
    closeAll(nodes);
  });

  it("a branch written later still reaches a node two links away", () => {
    // A line, not a mesh: a—b—c. c never talks to a; only relaying gets it there.
    const a = createMemoryStore({ chain: CHAIN, nodeId: "a" });
    const b = createMemoryStore({ chain: CHAIN, nodeId: "b" });
    const c = createMemoryStore({ chain: CHAIN, nodeId: "c" });
    const [aToB, bToA] = Wire.pair("a->b", "b->a");
    const [bToC, cToB] = Wire.pair("b->c", "c->b");
    const sessions = [
      new ReplicationSession({ store: a, transport: aToB, logger: quietLogger }),
      new ReplicationSession({ store: b, transport: bToA, logger: quietLogger }),
      new ReplicationSession({ store: b, transport: bToC, logger: quietLogger }),
      new ReplicationSession({ store: c, transport: cToB, logger: quietLogger }),
    ];
    for (const session of sessions) session.start();

    c.append(draft(1, "c", "c-1", TS));
    assert.deepEqual(
      a.all().map((event) => event.id),
      ["c-1"],
      "an event two links away did not arrive",
    );
    for (const session of sessions) session.close("done");
  });
});
