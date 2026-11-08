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
    this.closedWith = reason ?? "dicht";
  }

  onMessage(handler: (raw: string) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: (reason?: string) => void): void {
    this.closeHandler = handler;
  }

  /** Testbesturing: doe alsof de peer dit frame stuurde. */
  deliver(frame: Frame | string): void {
    const raw = typeof frame === "string" ? frame : JSON.stringify(frame);
    this.messageHandler?.(raw);
  }

  /** Testbesturing: doe alsof de verbinding wegvalt. */
  drop(reason = "peer weg"): void {
    this.closedWith = reason;
    this.closeHandler?.(reason);
  }

  lastFrame(): Frame | undefined {
    return this.sent[this.sent.length - 1];
  }
}

/** Twee transparanten die elkaar direct doorgeven, als twee uiteinden van een socket. */
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

describe("replicatie", () => {
  it("peer loopt voor: lokale kant haalt in, in orde", () => {
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

  it("peer loopt achter: wij sturen wat hij mist", () => {
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

  it("lege kant vraagt ontbrekende events op met een hello", () => {
    const local = createMemoryStore({ chain: "gesprek", nodeId: "a" });
    const transport = new FakeTransport("peer");
    const session = new ReplicationSession({ store: local, transport, logger: quietLogger });
    session.start();

    // Peer zegt dat hij seq 7 heeft; wij hebben niets.
    transport.deliver({ t: "hello", v: 1, chain: "gesprek", node: "b", haveSeq: 7 });

    const hellos = transport.sent.filter((f) => f.t === "hello");
    assert.equal(hellos.length, 2);
    assert.equal(hellos[1]?.t === "hello" ? hellos[1].haveSeq : -1, 0);
    assert.equal(session.status, "live");

    // Twee keer dezelfde hello mag geen tweede verzoek opleveren.
    transport.deliver({ t: "hello", v: 1, chain: "gesprek", node: "b", haveSeq: 7 });
    assert.equal(transport.sent.filter((f) => f.t === "hello").length, 2);

    session.close();
  });

  it("gelijke seq maar andere id is een hard conflict, geen keuze", () => {
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

    const voor = local.all().map((e) => e.id);
    transport.deliver({ t: "hello", v: 1, chain: "gesprek", node: "b", haveSeq: 3 });
    // Peer stuurt zijn eigen seq 3 met een andere id.
    transport.deliver({ t: "append", event: event(3, "b", "b-3-ander") });

    assert.equal(session.status, "conflicted");
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
    // Niets overschreven en niets bijgekomen.
    assert.deepEqual(
      local.all().map((e) => e.id),
      voor,
    );
    assert.equal(local.idAt(3), "a-3");
    assert.equal(transport.closedWith, "conflict");

    session.close();
  });

  it("conflict in een events-batch stopt de batch meteen", () => {
    const local = createMemoryStore({ chain: "gesprek", nodeId: "a" });
    seed(local, 2, "a");
    const transport = new FakeTransport("peer");
    const session = new ReplicationSession({ store: local, transport, logger: quietLogger });
    session.start();

    transport.deliver({
      t: "events",
      events: [event(2, "b", "b-2-ander"), event(3, "b")],
    });

    assert.equal(session.status, "conflicted");
    assert.equal(local.head(), 2);
    session.close();
  });

  it("dubbele ids worden genegeerd", () => {
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

  it("events die te vroeg binnenkomen worden gebufferd tot het gat dicht is", () => {
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

  it("live appends blijven lopen na de handshake", () => {
    const local = createMemoryStore({ chain: "gesprek", nodeId: "a" });
    const remote = createMemoryStore({ chain: "gesprek", nodeId: "b" });
    const [ta, tb] = link();
    const session = replicate({ store: local, transport: ta, logger: quietLogger });
    const peer = replicate({ store: remote, transport: tb, logger: quietLogger });

    local.append(event(1, "a"));
    assert.deepEqual(seqs(remote), [1]);

    remote.append(event(2, "b"));
    assert.deepEqual(seqs(local), [1, 2]);

    // Heen en weer zonder echo-lus: elk event staat er precies één keer.
    local.append(event(3, "a"));
    assert.deepEqual(seqs(remote), [1, 2, 3]);
    assert.equal(remote.all().length, 3);
    assert.equal(local.all().length, 3);

    session.close();
    peer.close();
  });

  it("een lokaal event na een gat stuurt een catch-up in plaats van een los event", () => {
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

  it("vreemde frames (tool_req) worden genegeerd", () => {
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

  it("kapotte json is een protocolfout", () => {
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

  it("een andere keten wordt geweigerd", () => {
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

  it("beide kanten gelijk: alleen een anchor, niets verandert", () => {
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
