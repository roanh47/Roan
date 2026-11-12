/**
 * Twee echte nodes, twee echte sockets: replicatie van begin tot eind.
 *
 * De unit-tests dekken de losse onderdelen met nep-transports. Deze test doet
 * hetzelfde over een WebSocketServer, zodat de combinatie van store, transport
 * en replicatie zich gedraagt zoals in de daemon.
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
    assert.equal(outcome.status, "appended", `seed van seq ${seq} moet lukken`);
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
 * Start een server op poort 0 en verbindt precies één client. De serverkant
 * krijgt zijn eigen store en replicatiesessie, net als een tweede machine.
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

it("twee nodes met gelijke heads blijven gelijk en dragen daarna live events", async () => {
  const local = createMemoryStore({ chain: CHAIN, nodeId: "a" });
  const remote = createMemoryStore({ chain: CHAIN, nodeId: "b" });
  seed(local, 2, "a");
  seed(remote, 2, "a");

  // Uitgangspunt: gelijke heads, dezelfde keten.
  assert.deepEqual(headsAndIds(local), headsAndIds(remote));

  const pair = await connectPair(local, remote);
  try {
    await until(() => pair.sessions.every((s) => s.status === "live"), "beide sessies live");
    await until(
      () =>
        pair.sessions.every((session) => session.status === "live") &&
        local.head() === remote.head(),
      "heads blijven gelijk",
    );

    assert.equal(local.head(), 2);
    assert.equal(remote.head(), 2);
    assert.deepEqual(headsAndIds(remote), headsAndIds(local));

    // Live event van a naar b.
    local.append(event(3, "a"));
    await until(() => remote.head() === 3, "live event van a komt aan bij b");
    assert.equal(remote.all()[2]?.id, "a-3");

    // En terug: b schrijft seq 4, a krijgt hem.
    remote.append(event(4, "b"));
    await until(() => local.head() === 4, "live event van b komt aan bij a");
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

it("een botsende seq wordt als conflict gemeld en niet stil samengevoegd", async () => {
  // Beide kanten hebben dezelfde geschiedenis tot en met seq 3 en schrijven
  // daarna allebei hun eigen seq 4. Gelijke heads, verschillende id: hard conflict.
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
    await until(() => localConflicts.length === 1 && remoteConflicts.length === 1, "beide kanten melden conflict");

    const fromA = localConflicts[0];
    const fromB = remoteConflicts[0];
    assert.ok(fromA && fromB);

    // De kant die het meldt is lokaal; de andere node is de peer.
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

    // Geen kant is gekozen: elk houdt zijn eigen event en er is niets bijgekomen.
    assert.equal(local.head(), 4);
    assert.equal(remote.head(), 4);
    assert.equal(local.idAt(4), "a-4");
    assert.equal(remote.idAt(4), "b-4");
    assert.deepEqual(local.all().map((e) => e.seq), [1, 2, 3, 4]);
    assert.deepEqual(remote.all().map((e) => e.seq), [1, 2, 3, 4]);

    // De sessies stoppen; er wordt niet doorgewerkt op een gesplitste keten.
    await until(
      () => pair.sessions.every((session) => session.status === "conflicted"),
      "beide sessies staan op conflicted",
    );
  } finally {
    await pair.close();
  }
});
