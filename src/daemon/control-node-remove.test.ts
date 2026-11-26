import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { WebSocket } from "ws";

import { nodesFromEvents } from "../chain/nodes.js";
import { EventStore } from "../chain/store.js";
import { startControlServer, type ControlServerOptions } from "./control.js";
import type { DaemonState } from "./control-protocol.js";
import { removeNode } from "./membership.js";

/**
 * The `node_remove` control frame, over the real socket the app uses.
 *
 * The daemon's own handler is only two lines around `removeNode` (broadcast the
 * event, push state), so the test wires the real `removeNode` to a real store
 * and checks both halves: a refusal has to reach the caller as a message, and a
 * removal has to land as a chain event that the state then folds away.
 */

const CHAIN = "gesprek";
const SELF = "node-self";
const PHONE = "node-b";
const MISSING_DIST = join(process.cwd(), "tmp-no-such-dist-" + String(process.pid));

function seededStore(): EventStore {
  const store = EventStore.open(":memory:");
  store.append(CHAIN, {
    id: "n-self",
    node: SELF,
    ts: 1,
    type: "node",
    data: { node: SELF, name: "Roans-Server", host: "100.64.0.1", port: 6769 },
  });
  store.append(CHAIN, {
    id: "n-phone",
    node: PHONE,
    ts: 2,
    type: "node",
    data: { node: PHONE, name: "Roans telefoon", host: "100.64.0.9", port: 6769 },
  });
  return store;
}

function stateOf(store: EventStore): DaemonState {
  return {
    onboarding: false,
    chain: CHAIN,
    node: SELF,
    head: store.head(CHAIN),
    peers: [],
    nodes: nodesFromEvents(store.read(CHAIN)).map((entry) => ({
      node: entry.node,
      name: entry.name,
      host: entry.host,
      port: entry.port,
    })),
    invite: null,
  };
}

async function withControl(
  run: (
    server: Awaited<ReturnType<typeof startControlServer>>,
    store: EventStore,
    frameLog: Record<string, unknown>[],
  ) => Promise<void>,
): Promise<void> {
  const store = seededStore();
  const frameLog: Record<string, unknown>[] = [];
  // The real handler pushes state through the server it lives on; the test has
  // to hand it the same handle after `startControlServer` resolves.
  let server: Awaited<ReturnType<typeof startControlServer>> | null = null;
  const options: ControlServerOptions = {
    port: 0,
    host: "127.0.0.1",
    webDist: MISSING_DIST,
    store: () => store,
    state: () => stateOf(store),
    onMessage: () => {},
    onRemoveNode: (wanted: string) => {
      const outcome = removeNode(store, CHAIN, SELF, wanted, () => `remove-${String(frameLog.length)}`);
      if (!outcome.ok) return outcome;
      if (outcome.event !== null) {
        frameLog.push({ t: "append", event: outcome.event });
        server?.sendState();
      }
      return { ok: true };
    },
    onCreate: () => Promise.resolve({ t: "chain", chain: CHAIN, node: SELF }),
    onJoin: () => Promise.resolve({ t: "chain", chain: CHAIN, node: SELF }),
  };
  server = await startControlServer(options);
  try {
    await run(server, store, frameLog);
  } finally {
    await server.close();
    store.close();
  }
}

function open(url: string): Promise<{ socket: WebSocket; frames: Record<string, unknown>[] }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const frames: Record<string, unknown>[] = [];
    socket.on("message", (data: unknown) => {
      try {
        frames.push(JSON.parse(String(data)) as Record<string, unknown>);
      } catch {
        // The control socket only speaks JSON; anything else is not ours.
      }
    });
    socket.once("open", () => resolve({ socket, frames }));
    socket.once("error", reject);
  });
}

async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timeout: " + label);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function states(frames: Record<string, unknown>[]): DaemonState[] {
  return frames
    .filter((frame) => frame["t"] === "state")
    .map((frame) => frame["data"] as DaemonState);
}

test("node_remove refuses to remove the device you are talking to", async () => {
  await withControl(async (server, store) => {
    const { socket, frames } = await open(`ws://127.0.0.1:${String(server.port)}/ws`);
    try {
      await until(() => frames.length > 0, "greeting");
      socket.send(JSON.stringify({ t: "node_remove", node: SELF }));
      await until(
        () => frames.some((frame) => frame["t"] === "control_error"),
        "the refusal",
      );
      const refusal = frames.find((frame) => frame["t"] === "control_error");
      assert.match(String(refusal?.["message"]), /a live device is not a ghost/);
      // A refusal writes nothing: no tombstone for a device that is here.
      assert.equal(store.head(CHAIN), 2);
      assert.equal(nodesFromEvents(store.read(CHAIN)).length, 2);
    } finally {
      socket.close();
    }
  });
});

test("node_remove takes another device out and the state says so", async () => {
  await withControl(async (server, store, frameLog) => {
    const { socket, frames } = await open(`ws://127.0.0.1:${String(server.port)}/ws`);
    try {
      await until(() => frames.length > 0, "greeting");
      assert.deepEqual(
        states(frames)[0]?.nodes.map((entry) => entry.node),
        [SELF, PHONE],
      );

      socket.send(JSON.stringify({ t: "node_remove", node: PHONE }));
      await until(
        () => states(frames).some((state) => state.nodes.every((entry) => entry.node !== PHONE)),
        "a state without the removed device",
      );

      const last = store.read(CHAIN).at(-1);
      assert.equal(last?.type, "node_remove");
      assert.deepEqual(last?.data, { node: PHONE, by: SELF });
      assert.equal(frameLog.length, 1, "the event is broadcast to the app windows");
      assert.equal(store.head(CHAIN), 3);
    } finally {
      socket.close();
    }
  });
});

test("node_remove without a device id answers with a message", async () => {
  await withControl(async (server) => {
    const { socket, frames } = await open(`ws://127.0.0.1:${String(server.port)}/ws`);
    try {
      await until(() => frames.length > 0, "greeting");
      socket.send(JSON.stringify({ t: "node_remove" }));
      await until(
        () => frames.some((frame) => frame["t"] === "control_error"),
        "the refusal",
      );
      const refusal = frames.find((frame) => frame["t"] === "control_error");
      assert.match(String(refusal?.["message"]), /needs the id of the device/);
    } finally {
      socket.close();
    }
  });
});
