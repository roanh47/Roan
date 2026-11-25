import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryStore, type MemoryStore } from "./memory-store.js";
import { ReplicationSession, replicate } from "./replicate.js";
import type { ConflictReport, Event, Frame, Logger, PeerTransport } from "./types.js";

const quietLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function captureLogger(): Logger & { errors: string[] } {
  const errors: string[] = [];
  return {
    errors,
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: (message: string) => {
      errors.push(message);
    },
  };
}

function event(seq: number, node: string, id = `${node}-${seq}`): Event {
  return { v: 1, chain: "gesprek", seq, id, node, ts: 1_700_000_000_000 + seq, type: "bericht", data: { seq } };
}

function seed(store: MemoryStore, count: number, node = store.nodeId): void {
  for (let seq = store.head() + 1; seq <= count; seq++) {
    store.append(event(seq, node));
  }
}

function seqs(store: MemoryStore): number[] {
  return store.all().map((e) => e.seq);
}

class FakeTransport implements PeerTransport {
  readonly label: string;
  readonly sent: Frame[] = [];
  closedWith: string | undefined;
  private messageHandler: ((raw: string) => void) | undefined;
  private closeHandler: ((reason?: string) => void) | undefined;

  constructor(label: string) {
    this.label = label;
  }

  send(frame: Frame): void {
    if (this.closedWith !== undefined) return;
    this.sent.push(frame);
  }

  close(reason?: string): void {
    if (this.closedWith !== undefined) return;
    this.closedWith = reason ?? "closed";
  }

  onMessage(handler: (raw: string) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: (reason?: string) => void): void {
    this.closeHandler = handler;
  }

  /** Test hook: pretend the peer sent this frame. */
  deliver(frame: Frame | string): void {
    const raw = typeof frame === "string" ? frame : JSON.stringify(frame);
    this.messageHandler?.(raw);
  }

  /** Test hook: pretend the connection drops. */
  drop(reason = "peer gone"): void {
    this.closedWith = reason;
    this.closeHandler?.(reason);
  }

  lastFrame(): Frame | undefined {
    return this.sent[this.sent.length - 1];
  }
}

/** Two transports that pass frames straight to each other, like two ends of a socket. */
function link(): [FakeTransport, FakeTransport] {
  const left = new FakeTransport("links");
  const right = new FakeTransport("rechts");
  const leftSend = left.send.bind(left);
  const rightSend = right.send.bind(right);
  left.send = (frame: Frame): void => {
    leftSend(frame);
    right.deliver(JSON.stringify(frame));
  };
  right.send = (frame: Frame): void => {
    rightSend(frame);
    left.deliver(JSON.stringify(frame));
  };
  return [left, right];
}

function setOf(store: MemoryStore): Set<string> {
  return new Set(store.all().map((e) => e.id));
}

describe("replication", () => {
  it("peer is ahead: the local side catches up, fine", () => {
    const local = createMemoryStore({ chain: "gesprek", nodeId: "a" });
    const remote = createMemoryStore({ chain: "gesprek", nodeId: "b" });
    seed(remote, 5);

    const [ta, tb] = link();
    const session = replicate({ store: local, transport: ta, logger: quietLogger });
    const peer = replicate({ store: remote, transport: tb, logger: quietLogger });

    assert.deepEqual(seqs(local), [1, 2, 3, 4, 5]);
    assert.deepEqual(
      local.all().map((e) => e.id),
      remote.all().map((e) => e.id),
    );
    assert.equal(session.status, "live");
    assert.equal(peer.status, "live");

    session.close();
    peer.close();
  });

  it("peer is behind: we send what it is missing", () => {
    const local = createMemoryStore({ chain: "gesprek", nodeId: "a" });
    const remote = createMemoryStore({ chain: "gesprek", nodeId: "b" });
    seed(local, 4);
    seed(remote, 1, "a");

    const [ta, tb] = link();
    const session = replicate({ store: local, transport: ta, logger: quietLogger });
    const peer = replicate({ store: remote, transport: tb, logger: quietLogger });

    assert.deepEqual(seqs(remote), [1, 2, 3, 4]);
    assert.deepEqual(seqs(local), [1, 2, 3, 4]);

    session.close();
    peer.close();
  });

  it("empty side requests the missing events with a hello", () => {
    const local = createMemoryStore({ chain: "gesprek", nodeId: "a" });
    const transport = new FakeTransport("peer");
    const session = new ReplicationSession({ store: local, transport, logger: quietLogger });
    session.start();

    // Peer says it has seq 7; we have nothing.
    transport.deliver({ t: "hello", v: 1, chain: "gesprek", node: "b", haveSeq: 7 });

    const hellos = transport.sent.filter((f) => f.t === "hello");
    assert.equal(hellos.length, 2);
    assert.equal(hellos[1]?.t === "hello" ? hellos[1].haveSeq : -1, 0);
    assert.equal(session.status, "live");

    // The same hello twice must not produce a second request.
    transport.deliver({ t: "hello", v: 1, chain: "gesprek", node: "b", haveSeq: 7 });
    assert.equal(transport.sent.filter((f) => f.t === "hello").length, 2);

    session.close();
  });

  it("same seq but a different id becomes a branch: both events survive", () => {
    const local = createMemoryStore({ chain: "gesprek", nodeId: "a" });
    seed(local, 3, "a");
    const transport = new FakeTransport("peer");
    const reports: ConflictReport[] = [];
    const session = new ReplicationSession({
      store: local,
      transport,
      logger: captureLogger(),
      onConflict: (report) => reports.push(report),
    });
    session.start();

    transport.deliver({ t: "hello", v: 1, chain: "gesprek", node: "b", haveSeq: 3 });
    // Peer sends its own seq 3 with a different id.
    transport.deliver({ t: "append", event: event(3, "b", "b-3-ander") });

    // The link stays alive and the reporting stays visible.
    assert.equal(session.status, "live");
    assert.equal(reports.length, 1);
    assert.deepEqual(reports[0], {
      kind: "seq-id-mismatch",
      chain: "gesprek",
      seq: 3,
      localNode: "a",
      remoteNode: "b",
      localId: "a-3",
      remoteId: "b-3-ander",
    });
    // Our branch still sits in its place; theirs rebases behind it.
    assert.equal(local.idAt(3), "a-3");
    assert.equal(local.head(), 4);
    assert.equal(local.idAt(4), "b-3-ander");
    assert.notEqual(transport.closedWith, "conflict");

    session.close();
  });

  it("a branch inside an events batch keeps going: the rest rebases behind it", () => {
    const local = createMemoryStore({ chain: "gesprek", nodeId: "a" });
    seed(local, 2, "a");
    const transport = new FakeTransport("peer");
    const session = new ReplicationSession({ store: local, transport, logger: quietLogger });
    session.start();

    transport.deliver({
      t: "events",
      events: [event(2, "b", "b-2-ander"), event(3, "b")],
    });

    assert.equal(session.status, "live");
    assert.equal(local.head(), 4);
    assert.equal(local.idAt(3), "b-2-ander");
    assert.equal(local.idAt(4), "b-3");
    session.close();
  });

  it("two writers on the same seq: both sides keep both branches", () => {
    // The mirror contract: each side keeps its own branch in place and
    // rebases the other behind it. Both events then exist everywhere.
    const left = createMemoryStore({ chain: "gesprek", nodeId: "a" });
    const right = createMemoryStore({ chain: "gesprek", nodeId: "b" });
    seed(left, 3, "a");
    right.append(event(1, "a", "a-1"));
    right.append(event(2, "a", "a-2"));
    right.append(event(3, "a", "a-3"));
    // Both write seq 4 at the same time, each with its own id.
    left.append(event(4, "a", "links-4"));
    right.append(event(4, "b", "rechts-4"));

    const leftTransport = new FakeTransport("rechts");
    const rightTransport = new FakeTransport("links");
    const leftSession = new ReplicationSession({
      store: left,
      transport: leftTransport,
      logger: quietLogger,
    });
    const rightSession = new ReplicationSession({
      store: right,
      transport: rightTransport,
      logger: quietLogger,
    });
    leftSession.start();
    rightSession.start();

    // Connect them: each other's hello and then their own divergence.
    rightTransport.deliver({ t: "hello", v: 1, chain: "gesprek", node: "a", haveSeq: 4 });
    leftTransport.deliver({ t: "hello", v: 1, chain: "gesprek", node: "b", haveSeq: 4 });
    leftTransport.deliver({ t: "append", event: event(4, "b", "rechts-4") });
    rightTransport.deliver({ t: "append", event: event(4, "a", "links-4") });

    assert.equal(leftSession.status, "live");
    assert.equal(rightSession.status, "live");
    // Left: own branch first, then theirs.
    assert.equal(left.idAt(4), "links-4");
    assert.equal(left.idAt(5), "rechts-4");
    // Right: mirrored.
    assert.equal(right.idAt(4), "rechts-4");
    assert.equal(right.idAt(5), "links-4");
    // And neither of them has lost anything.
    assert.equal(left.head(), 5);
    assert.equal(right.head(), 5);

    leftSession.close();
    rightSession.close();
  });

  it("duplicate ids are ignored", () => {
    const local = createMemoryStore({ chain: "gesprek", nodeId: "a" });
    const transport = new FakeTransport("peer");
    const session = new ReplicationSession({ store: local, transport, logger: quietLogger });
    session.start();

    const e1 = event(1, "b");
    transport.deliver({ t: "append", event: e1 });
    transport.deliver({ t: "append", event: e1 });
    transport.deliver({ t: "events", events: [e1, event(2, "b")] });

    assert.deepEqual(seqs(local), [1, 2]);
    assert.equal(local.head(), 2);
    session.close();
  });

  it("events that arrive too early are buffered until the gap closes", () => {
    const local = createMemoryStore({ chain: "gesprek", nodeId: "a" });
    const transport = new FakeTransport("peer");
    const session = new ReplicationSession({ store: local, transport, logger: quietLogger });
    session.start();

    transport.deliver({ t: "append", event: event(3, "b") });
    transport.deliver({ t: "append", event: event(1, "b") });
    assert.deepEqual(seqs(local), [1]);
    assert.equal(session.buffered, 1);

    transport.deliver({ t: "append", event: event(2, "b") });
    assert.deepEqual(seqs(local), [1, 2, 3]);
    assert.equal(session.buffered, 0);
    assert.equal(local.head(), 3);
    session.close();
  });

  it("live appends keep flowing after the handshake", () => {
    const local = createMemoryStore({ chain: "gesprek", nodeId: "a" });
    const remote = createMemoryStore({ chain: "gesprek", nodeId: "b" });
    const [ta, tb] = link();
    const session = replicate({ store: local, transport: ta, logger: quietLogger });
    const peer = replicate({ store: remote, transport: tb, logger: quietLogger });

    local.append(event(1, "a"));
    assert.deepEqual(seqs(remote), [1]);

    remote.append(event(2, "b"));
    assert.deepEqual(seqs(local), [1, 2]);

    // Back and forth without an echo loop: every event appears exactly once.
    local.append(event(3, "a"));
    assert.deepEqual(seqs(remote), [1, 2, 3]);
    assert.equal(remote.all().length, 3);
    assert.equal(local.all().length, 3);

    session.close();
    peer.close();
  });

  it("a local event after a gap sends a catch-up instead of a loose event", () => {
    const local = createMemoryStore({ chain: "gesprek", nodeId: "a" });
    seed(local, 2);
    const transport = new FakeTransport("peer");
    const session = new ReplicationSession({ store: local, transport, logger: quietLogger });
    session.start();
    transport.deliver({ t: "hello", v: 1, chain: "gesprek", node: "b", haveSeq: 0 });

    local.append(event(3, "a"));
    local.append(event(4, "a"));

    const appends = transport.sent.filter((f) => f.t === "append");
    assert.equal(appends.length, 2);
    assert.equal(session.status, "live");
    session.close();
  });

  it("foreign frames (tool_req) are ignored", () => {
    const local = createMemoryStore({ chain: "gesprek", nodeId: "a" });
    const transport = new FakeTransport("peer");
    const errors: string[] = [];
    const session = new ReplicationSession({
      store: local,
      transport,
      logger: quietLogger,
      onError: (error) => errors.push(error.code),
    });
    session.start();

    transport.deliver('{"t":"tool_req","id":"x"}');
    assert.equal(errors.length, 0);
    assert.equal(session.status, "idle");
    session.close();
  });

  it("broken json is a protocol error", () => {
    const local = createMemoryStore({ chain: "gesprek", nodeId: "a" });
    const transport = new FakeTransport("peer");
    const errors: string[] = [];
    const session = new ReplicationSession({
      store: local,
      transport,
      logger: quietLogger,
      onError: (error) => errors.push(error.code),
    });
    session.start();

    transport.deliver("{niet json");
    assert.deepEqual(errors, ["bad-frame"]);
    assert.equal(session.status, "failed");
    assert.equal(transport.closedWith, "bad-frame");
  });

  it("another chain is refused", () => {
    const local = createMemoryStore({ chain: "gesprek", nodeId: "a" });
    const transport = new FakeTransport("peer");
    const errors: string[] = [];
    const session = new ReplicationSession({
      store: local,
      transport,
      logger: quietLogger,
      onError: (error) => errors.push(error.code),
    });
    session.start();

    transport.deliver({ t: "hello", v: 1, chain: "andere-keten", node: "b", haveSeq: 0 });
    assert.deepEqual(errors, ["chain-mismatch"]);
    assert.equal(session.status, "failed");
    assert.equal(local.head(), 0);
  });

  it("both sides equal: only an anchor, nothing changes", () => {
    const local = createMemoryStore({ chain: "gesprek", nodeId: "a" });
    const remote = createMemoryStore({ chain: "gesprek", nodeId: "b" });
    seed(local, 3, "a");
    seed(remote, 3, "a");
    const before = setOf(local);

    const [ta, tb] = link();
    const session = replicate({ store: local, transport: ta, logger: quietLogger });
    const peer = replicate({ store: remote, transport: tb, logger: quietLogger });

    assert.equal(session.status, "live");
    assert.equal(peer.status, "live");
    assert.deepEqual(setOf(local), before);
    assert.equal(local.head(), 3);
    assert.equal(remote.head(), 3);

    session.close();
    peer.close();
  });
});
