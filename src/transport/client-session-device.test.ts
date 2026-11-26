import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";
import type { DeviceRunner } from "../sync/device-control.js";
import { createMemoryStore, type MemoryStore } from "../sync/memory-store.js";
import type { Event } from "../sync/types.js";
import { PeerSession } from "./client-session.js";
import { nullLogger } from "./logger.js";
import type { DeviceResultPayload } from "./server.js";

const CHAIN = "gesprek";
const TOKEN = "geheim";
const CLIENT_NODE = "a";
const PEER_NODE = "b";

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
  return createMemoryStore({ chain: CHAIN, nodeId: CLIENT_NODE, events });
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

/**
 * A bare ws peer that plays the remote node: it sends its hello, waits for the
 * client's hello, then pushes one `device_req`. No real chain, no real exec.
 */
async function withRemotePeer(
  reply: Record<string, unknown>,
  work: (endpoint: string) => Promise<void>,
): Promise<void> {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address() as AddressInfo;

  server.on("connection", (socket) => {
    socket.send(JSON.stringify({ t: "hello", v: 1, chain: CHAIN, node: PEER_NODE, haveSeq: 0 }));
    socket.once("message", () => {
      setTimeout(() => socket.send(JSON.stringify(reply)), 10);
    });
  });

  try {
    await work(`ws://127.0.0.1:${String(address.port)}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("peer session device receiver", () => {
  it("runs a granted command the dialled peer asks for", async () => {
    const store = storeWith([grantEvent(1, CLIENT_NODE, true)]);
    const { run, calls } = recorder();

    await withRemotePeer(
      { t: "device_req", chain: CHAIN, node: CLIENT_NODE, command: "date" },
      async (endpoint) => {
        const session = await PeerSession.open({
          endpoint,
          token: TOKEN,
          chain: CHAIN,
          node: CLIENT_NODE,
          haveSeq: () => 0,
          logger: nullLogger,
          connectTimeoutMs: 2_000,
          handshakeTimeoutMs: 2_000,
          maxPayloadBytes: 1 << 20,
          maxBufferedBytes: 1 << 20,
          maxEventsPerFrame: 100,
          onFrame: () => {},
          device: { store, run },
        });

        try {
          await until(() => results(store).length === 1, "device_result appended");
          assert.equal(calls.length, 1);
          assert.deepEqual(calls[0], ["date"]);
          assert.deepEqual(results(store)[0], {
            node: CLIENT_NODE,
            command: "date",
            accepted: true,
            output: "ran date",
          });
        } finally {
          session.close();
        }
      },
    );
  });

  it("refuses without a grant and never calls the runner", async () => {
    const store = storeWith();
    const { run, calls } = recorder();

    await withRemotePeer(
      { t: "device_req", chain: CHAIN, node: CLIENT_NODE, command: "uptime" },
      async (endpoint) => {
        const session = await PeerSession.open({
          endpoint,
          token: TOKEN,
          chain: CHAIN,
          node: CLIENT_NODE,
          haveSeq: () => 0,
          logger: nullLogger,
          connectTimeoutMs: 2_000,
          handshakeTimeoutMs: 2_000,
          maxPayloadBytes: 1 << 20,
          maxBufferedBytes: 1 << 20,
          maxEventsPerFrame: 100,
          onFrame: () => {},
          device: { store, run },
        });

        try {
          await until(() => results(store).length === 1, "refusal appended");
          assert.equal(calls.length, 0, "the runner is never reached without a grant");
          assert.equal(results(store)[0]?.accepted, false);
          assert.match(results(store)[0]?.reason ?? "", /no grant/);
          assert.equal(session.protocolError, null, "a refusal is not a protocol violation");
        } finally {
          session.close();
        }
      },
    );
  });
});
