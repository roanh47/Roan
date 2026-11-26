import { test } from "node:test";
import assert from "node:assert/strict";
import { EventStore } from "../chain/store.js";
import { ChainNodeStore } from "./peer-store.js";
import { ReplicationSession } from "../sync/replicate.js";
import type { Event, Frame, Logger, PeerTransport } from "../sync/types.js";

const CHAIN = "chain-1";

const quietLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

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

function fromPeer(seq: number, id: string, node: string): Event {
  return { ...draft(seq, id), node };
}

/** A transport a test feeds by hand and reads what the session put on it. */
class FakeTransport implements PeerTransport {
  readonly label: string;
  readonly sent: Frame[] = [];
  private messageHandler: ((raw: string) => void) | undefined;

  constructor(label: string) {
    this.label = label;
  }

  send(frame: Frame): void {
    this.sent.push(frame);
  }

  close(): void {}

  onMessage(handler: (raw: string) => void): void {
    this.messageHandler = handler;
  }

  onClose(): void {}

  deliver(frame: Frame): void {
    this.messageHandler?.(JSON.stringify(frame));
  }

  appends(): Event[] {
    return this.sent.flatMap((frame) => (frame.t === "append" ? [frame.event] : []));
  }
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

test("a local write reaches subscribers, and so does one applied from a peer", () => {
  const store = EventStore.open(":memory:");
  const node = new ChainNodeStore(store, "node-a", CHAIN);
  const seen: string[] = [];
  const stop = node.subscribe((event) => seen.push(event.id));

  // Local writers — the app's message, a turn — append through the store.
  store.append(CHAIN, { id: "local", node: "node-a", type: "message", data: { text: "x" } });
  assert.deepEqual(seen, ["local"]);

  // An event from a peer is just as real: a link to a *third* node has never
  // seen it and has to be able to forward it. Staying silent here is what kept
  // a branch on the node that received it and nowhere else.
  assert.deepEqual(node.append(draft(2, "remote")), { status: "appended" });
  assert.deepEqual(seen, ["local", "remote"]);

  stop();
  store.append(CHAIN, { id: "after-stop", node: "node-a", type: "message", data: { text: "y" } });
  assert.deepEqual(seen, ["local", "remote"]);
  store.close();
});

test("an event from one peer is forwarded to the other and not echoed to its sender", () => {
  const store = EventStore.open(":memory:");
  const node = new ChainNodeStore(store, "node-a", CHAIN);
  const b = new FakeTransport("inbound:node-b");
  const c = new FakeTransport("inbound:node-c");
  const fromB = new ReplicationSession({ store: node, transport: b, logger: quietLogger });
  const toC = new ReplicationSession({ store: node, transport: c, logger: quietLogger });
  fromB.start();
  toC.start();

  b.deliver({ t: "hello", v: 1, chain: CHAIN, node: "node-b", haveSeq: 0 });
  c.deliver({ t: "hello", v: 1, chain: CHAIN, node: "node-c", haveSeq: 0 });
  b.sent.length = 0;
  c.sent.length = 0;

  b.deliver({ t: "append", event: fromPeer(1, "b-1", "node-b") });

  assert.equal(node.head(), 1, "the event from B was not applied");
  assert.deepEqual(
    c.appends().map((event) => event.id),
    ["b-1"],
    "the event from B never reached C",
  );
  assert.deepEqual(
    b.appends().map((event) => event.id),
    [],
    "the event was sent back to the peer that wrote it",
  );

  fromB.close("done");
  toC.close("done");
  store.close();
});

test("a rebased branch from one peer is relayed to the other without an echo", () => {
  const store = EventStore.open(":memory:");
  const node = new ChainNodeStore(store, "node-a", CHAIN);
  store.append(CHAIN, { id: "a-1", node: "node-a", type: "message", data: { text: "own" } });
  const b = new FakeTransport("inbound:node-b");
  const c = new FakeTransport("inbound:node-c");
  const fromB = new ReplicationSession({ store: node, transport: b, logger: quietLogger });
  const toC = new ReplicationSession({ store: node, transport: c, logger: quietLogger });
  fromB.start();
  toC.start();
  b.deliver({ t: "hello", v: 1, chain: CHAIN, node: "node-b", haveSeq: 1 });
  c.deliver({ t: "hello", v: 1, chain: CHAIN, node: "node-c", haveSeq: 1 });
  b.sent.length = 0;
  c.sent.length = 0;

  // B wrote seq 1 too; ours is different, so B's branch rebases behind it.
  b.deliver({ t: "append", event: fromPeer(1, "b-1", "node-b") });

  assert.equal(node.idAt(2), "b-1");
  assert.deepEqual(c.appends().map((event) => event.id), ["b-1"]);
  assert.deepEqual(b.appends().map((event) => event.id), []);

  fromB.close("done");
  toC.close("done");
  store.close();
});
