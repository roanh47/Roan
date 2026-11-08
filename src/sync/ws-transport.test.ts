import assert from "node:assert/strict";
import { it } from "node:test";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import { createMemoryStore } from "./memory-store.js";
import { replicate } from "./replicate.js";
import { webSocketTransport } from "./ws-transport.js";
import type { Event, Logger, PeerTransport } from "./types.js";

const quietLogger: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

function event(seq: number, node: string): Event {
  return { v: 1, chain: "gesprek", seq, id: `${node}-${seq}`, node, ts: 1_700_000_000_000 + seq, type: "bericht", data: null };
}

async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timeout: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

it("repliceert over een echte ws-socket, inclusief live appends", async () => {
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address() as AddressInfo;

  const local = createMemoryStore({ chain: "gesprek", nodeId: "a" });
  const remote = createMemoryStore({ chain: "gesprek", nodeId: "b" });
  for (let seq = 1; seq <= 3; seq++) local.append(event(seq, "a"));

  const sessions: { close(): void }[] = [];
  const transports: PeerTransport[] = [];

  server.on("connection", (socket) => {
    const transport = webSocketTransport(socket, "server");
    transports.push(transport);
    sessions.push(replicate({ store: remote, transport, logger: quietLogger }));
  });

  const client = new WebSocket(`ws://127.0.0.1:${address.port}`);
  const clientTransport = webSocketTransport(client, "client");
  transports.push(clientTransport);
  sessions.push(replicate({ store: local, transport: clientTransport, logger: quietLogger }));

  await until(() => remote.head() === 3, "server haalt in");
  assert.deepEqual(remote.all().map((e) => e.id), ["a-1", "a-2", "a-3"]);

  client.send(JSON.stringify({ t: "noop" })); // vreemd frame mag niets breken
  local.append(event(4, "a"));
  await until(() => remote.head() === 4, "live append komt aan");

  remote.append(event(5, "b"));
  await until(() => local.head() === 5, "terugweg komt aan");
  assert.equal(local.all().length, 5);

  for (const session of sessions) session.close();
  for (const transport of transports) transport.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
