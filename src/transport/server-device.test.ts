import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WebSocket } from "ws";
import type { DeviceRunner } from "../sync/device-control.js";
import { createMemoryStore, type MemoryStore } from "../sync/memory-store.js";
import type { Event } from "../sync/types.js";
import { nullLogger } from "./logger.js";
import type { DeviceResultPayload } from "./server.js";
import { startPeerServer } from "./server.js";

const CHAIN = "gesprek";
const TOKEN = "geheim";
const SERVER_NODE = "b";
const CLIENT_NODE = "a";

function grantEvent(seq: number, node: string, enabled: boolean): Event {
  return {
    v: 1,
    chain: CHAIN,
    seq,
    id: `grant-${String(seq)}`,
    node: "owner",
    ts: 1_700_000_000_000 + seq,
    type: "device_grant",
    data: { node, enabled },
  };
}

function storeWith(events: Event[] = []): MemoryStore {
  return createMemoryStore({ chain: CHAIN, nodeId: SERVER_NODE, events });
}

function recorder(): { run: DeviceRunner; calls: (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  return {
    calls,
    run: (argv) => {
      calls.push(argv);
      return `ran ${argv.join(" ")}`;
    },
  };
}

async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timeout: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function results(store: MemoryStore): DeviceResultPayload[] {
  return store
    .all()
    .filter((event) => event.type === "device_result")
    .map((event) => event.data as DeviceResultPayload);
}

interface Live {
  readonly socket: WebSocket;
  readonly received: string[];
  send(frame: Record<string, unknown>): void;
}

/** A real ws client that completed the transport handshake. */
async function connect(port: number): Promise<Live> {
  const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/?token=${TOKEN}`);
  const received: string[] = [];
  socket.on("message", (data: unknown) => {
    received.push(String(data));
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", (error: Error) => reject(error));
  });
  socket.send(JSON.stringify({ t: "hello", v: 1, chain: CHAIN, node: CLIENT_NODE, haveSeq: 0 }));
  return {
    socket,
    received,
    send: (frame) => socket.send(JSON.stringify(frame)),
  };
}

describe("peer server device receiver", () => {
  it("runs a granted command and appends the device_result", async () => {
    const store = storeWith([grantEvent(1, SERVER_NODE, true)]);
    const { run, calls } = recorder();
    const forwarded: string[] = [];
    const server = await startPeerServer({
      node: SERVER_NODE,
      chain: CHAIN,
      token: TOKEN,
      host: "127.0.0.1",
      port: 0,
      logger: nullLogger,
      device: { store, run },
      onFrame: (_peer, frame) => forwarded.push(frame.t),
    });

    try {
      const live = await connect(server.port);
      live.send({ t: "device_req", chain: CHAIN, node: SERVER_NODE, command: "uptime" });
      await until(() => results(store).length === 1, "device_result appended");

      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0], ["uptime"], "the wire never chooses the argv");
      assert.deepEqual(results(store)[0], {
        node: SERVER_NODE,
        command: "uptime",
        accepted: true,
        output: "ran uptime",
      });
      assert.deepEqual(forwarded, [], "device_req is answered here, not forwarded to replication");
      live.socket.close();
    } finally {
      await server.close();
    }
  });

  it("refuses without a grant, never runs, and keeps the link open", async () => {
    const store = storeWith();
    const { run, calls } = recorder();
    const server = await startPeerServer({
      node: SERVER_NODE,
      chain: CHAIN,
      token: TOKEN,
      host: "127.0.0.1",
      port: 0,
      logger: nullLogger,
      device: { store, run },
    });

    try {
      const live = await connect(server.port);
      live.send({ t: "device_req", chain: CHAIN, node: SERVER_NODE, command: "df -h" });
      await until(() => results(store).length === 1, "refusal appended");

      assert.equal(calls.length, 0, "a refusal must never reach the runner");
      const result = results(store)[0];
      assert.equal(result?.accepted, false);
      assert.match(result?.reason ?? "", /no grant/);
      assert.equal(live.socket.readyState, WebSocket.OPEN, "a refusal is not a protocol error");
      live.socket.close();
    } finally {
      await server.close();
    }
  });

  it("ignores a device_req when device control is not configured", async () => {
    const store = storeWith([grantEvent(1, SERVER_NODE, true)]);
    const forwarded: string[] = [];
    const server = await startPeerServer({
      node: SERVER_NODE,
      chain: CHAIN,
      token: TOKEN,
      host: "127.0.0.1",
      port: 0,
      logger: nullLogger,
      onFrame: (_peer, frame) => forwarded.push(frame.t),
    });

    try {
      const live = await connect(server.port);
      live.send({ t: "device_req", chain: CHAIN, node: SERVER_NODE, command: "uptime" });
      await new Promise((resolve) => setTimeout(resolve, 100));

      assert.equal(store.head(), 1, "no result event without a configured receiver");
      assert.deepEqual(forwarded, []);
      assert.equal(live.socket.readyState, WebSocket.OPEN);
      live.socket.close();
    } finally {
      await server.close();
    }
  });
});
