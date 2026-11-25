/**
 * Two real nodes, two real sockets: replication from start to finish.
 *
 * The unit tests cover the individual parts with fake transports. This test
 * does the same over a WebSocketServer, so the combination of store, transport
 * and replication behaves the way it does in the daemon.
 */

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { it } from "node:test";
import { WebSocket, WebSocketServer } from "ws";

import { createMemoryStore, type MemoryStore } from "../../src/sync/memory-store.js";
import { replicate, type ReplicationSession } from "../../src/sync/replicate.js";
import { webSocketTransport } from "../../src/sync/ws-transport.js";
import type { ConflictReport, Event, Logger, PeerTransport } from "../../src/sync/types.js";

const quietLogger: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

const CHAIN = "gesprek";

function event(seq: number, node: string, id = `${node}-${seq}`): Event {
  return {
    v: 1,
    chain: CHAIN,
    seq,
    id,
    node,
    ts: 1_700_000_000_000 + seq,
    type: "bericht",
    data: { seq },
  };
}

function seed(store: MemoryStore, count: number, node: string): void {
  for (let seq = store.head() + 1; seq <= count; seq++) {
    const outcome = store.append(event(seq, node));
    assert.equal(outcome.status, "appended", `seed of seq ${seq} should succeed`);
  }
}

async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 4000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timeout: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

interface Pair {
  local: MemoryStore;
  remote: MemoryStore;
  sessions: ReplicationSession[];
  transports: PeerTransport[];
  close(): Promise<void>;
}

/**
 * Starts a server on port 0 and connects exactly one client. The server side
 * gets its own store and replication session, just like a second machine.
 */
async function connectPair(
  local: MemoryStore,
  remote: MemoryStore,
  onRemoteConflict?: (report: ConflictReport) => void,
  onLocalConflict?: (report: ConflictReport) => void,
): Promise<Pair> {
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address() as AddressInfo;

  const sessions: ReplicationSession[] = [];
  const transports: PeerTransport[] = [];

  server.on("connection", (socket) => {
    const transport = webSocketTransport(socket, "server");
    transports.push(transport);
    sessions.push(
      replicate({ store: remote, transport, logger: quietLogger, onConflict: onRemoteConflict }),
    );
  });

  const client = new WebSocket(`ws://127.0.0.1:${address.port}`);
  const clientTransport = webSocketTransport(client, "client");
  transports.push(clientTransport);
  sessions.push(
    replicate({ store: local, transport: clientTransport, logger: quietLogger, onConflict: onLocalConflict }),
  );

  return {
    local,
    remote,
    sessions,
    transports,
    async close(): Promise<void> {
      for (const session of sessions) session.close();
      for (const transport of transports) transport.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function headsAndIds(store: MemoryStore): { head: number; ids: string[] } {
  return { head: store.head(), ids: store.all().map((e) => e.id) };
}

it("two nodes with equal heads stay equal and then carry live events", async () => {
  const local = createMemoryStore({ chain: CHAIN, nodeId: "a" });
  const remote = createMemoryStore({ chain: CHAIN, nodeId: "b" });
  seed(local, 2, "a");
  seed(remote, 2, "a");

  // Starting point: equal heads, the same chain.
  assert.deepEqual(headsAndIds(local), headsAndIds(remote));

  const pair = await connectPair(local, remote);
  try {
    await until(() => pair.sessions.every((s) => s.status === "live"), "both sessions live");
    await until(
      () =>
        pair.sessions.every((session) => session.status === "live") &&
        local.head() === remote.head(),
      "heads stay equal",
    );

    assert.equal(local.head(), 2);
    assert.equal(remote.head(), 2);
    assert.deepEqual(headsAndIds(remote), headsAndIds(local));

    // Live event from a to b.
    local.append(event(3, "a"));
    await until(() => remote.head() === 3, "live event from a reaches b");
    assert.equal(remote.all()[2]?.id, "a-3");

    // And back: b writes seq 4, a receives it.
    remote.append(event(4, "b"));
    await until(() => local.head() === 4, "live event from b reaches a");
    assert.equal(local.all()[3]?.id, "b-4");

    assert.deepEqual(headsAndIds(remote), headsAndIds(local));
    assert.deepEqual(
      local.all().map((e) => e.seq),
      [1, 2, 3, 4],
    );
  } finally {
    await pair.close();
  }
});

it("a colliding seq is reported as a conflict and not merged silently", async () => {
  // Both sides share the same history up to and including seq 3, then each
  // writes its own seq 4. Equal heads, different id: hard conflict.
  const local = createMemoryStore({ chain: CHAIN, nodeId: "a" });
  const remote = createMemoryStore({ chain: CHAIN, nodeId: "b" });
  seed(local, 3, "a");
  seed(remote, 3, "a");
  assert.equal(local.append(event(4, "a")).status, "appended");
  assert.equal(remote.append(event(4, "b")).status, "appended");

  assert.equal(local.head(), remote.head());
  assert.notEqual(local.idAt(4), remote.idAt(4));

  const localConflicts: ConflictReport[] = [];
  const remoteConflicts: ConflictReport[] = [];
  const pair = await connectPair(
    local,
    remote,
    (report) => remoteConflicts.push(report),
    (report) => localConflicts.push(report),
  );

  try {
    await until(() => localConflicts.length === 1 && remoteConflicts.length === 1, "both sides report a conflict");

    const fromA = localConflicts[0];
    const fromB = remoteConflicts[0];
    assert.ok(fromA && fromB);

    // The side that reports it is local; the other node is the peer.
    assert.deepEqual(
      { ...fromA },
      {
        kind: "seq-id-mismatch",
        chain: CHAIN,
        seq: 4,
        localNode: "a",
        remoteNode: "b",
        localId: "a-4",
        remoteId: "b-4",
      },
    );
    assert.deepEqual(
      { ...fromB },
      {
        kind: "seq-id-mismatch",
        chain: CHAIN,
        seq: 4,
        localNode: "b",
        remoteNode: "a",
        localId: "b-4",
        remoteId: "a-4",
      },
    );

    // No side was chosen: each keeps its own event and nothing was added.
    assert.equal(local.head(), 4);
    assert.equal(remote.head(), 4);
    assert.equal(local.idAt(4), "a-4");
    assert.equal(remote.idAt(4), "b-4");
    assert.deepEqual(local.all().map((e) => e.seq), [1, 2, 3, 4]);
    assert.deepEqual(remote.all().map((e) => e.seq), [1, 2, 3, 4]);

    // The sessions stop; no work continues on a split chain.
    await until(
      () => pair.sessions.every((session) => session.status === "conflicted"),
      "both sessions sit at conflicted",
    );
  } finally {
    await pair.close();
  }
});
