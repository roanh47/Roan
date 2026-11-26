import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket } from "ws";

import { startControlServer } from "./control.js";

/**
 * The app's client opens `/ws` and says hello without a token. That hello used
 * to be answered with 1008 ("peer protocol lives on /peer"), so the daemon
 * closed every client and the app showed "daemon not connected" while the
 * daemon was running fine. A peer hello (the one that carries the chain token)
 * must still be refused.
 */
function state() {
  return {
    onboarding: false,
    chain: "chain-1",
    node: "node-1",
    head: 7,
    peers: [],
    nodes: [],
    sessions: [],
    activeSession: null,
    invite: null,
  };
}

test("a control hello without a token gets hello and state on /ws", async () => {
  const server = await startControlServer({
    host: "127.0.0.1",
    port: 0,
    webDist: "/nonexistent",
    store: () => null,
    state: state as never,
    onMessage: () => {},
    onNewSession: () => "session-1",
    onCreate: () => Promise.resolve({ t: "chain", chain: "chain-1", node: "node-1" } as never),
    onJoin: () => Promise.resolve({ t: "chain", chain: "chain-1", node: "node-1" } as never),
    isLocal: () => true,
  });
  try {
    const url = `ws://127.0.0.1:${String(server.port)}/ws`;
    const frames: { t: string }[] = [];
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url);
      const timer = setTimeout(() => {
        reject(new Error("no answer to the control hello"));
      }, 5_000);
      socket.on("open", () => socket.send(JSON.stringify({ t: "hello", v: 1, chain: "chain-1", node: "node-1", haveSeq: 0 })));
      socket.on("message", (raw) => {
        const frame = JSON.parse(raw.toString()) as { t: string };
        frames.push(frame);
        if (frames.some((entry) => entry.t === "state")) {
          clearTimeout(timer);
          socket.close();
          resolve();
        }
      });
      socket.on("close", (code) => {
        if (!frames.some((entry) => entry.t === "state")) {
          clearTimeout(timer);
          reject(new Error(`socket closed ${String(code)} without state`));
        }
      });
    });
    // The connection greets on its own; what matters is that a tokenless hello
    // is answered instead of being closed with 1008, and that state arrives.
    assert.ok(frames.some((frame) => frame.t === "state"), "state must arrive");
  } finally {
    await server.close();
  }
});

test("a peer hello with a token is still refused on /ws", async () => {
  const server = await startControlServer({
    host: "127.0.0.1",
    port: 0,
    webDist: "/nonexistent",
    store: () => null,
    state: state as never,
    onMessage: () => {},
    onNewSession: () => "session-1",
    onCreate: () => Promise.resolve({ t: "chain", chain: "chain-1", node: "node-1" } as never),
    onJoin: () => Promise.resolve({ t: "chain", chain: "chain-1", node: "node-1" } as never),
    isLocal: () => true,
  });
  try {
    const url = `ws://127.0.0.1:${String(server.port)}/ws`;
    const code = await new Promise<number>((resolve, reject) => {
      const socket = new WebSocket(url);
      const timer = setTimeout(() => reject(new Error("socket stayed open")), 5_000);
      socket.on("open", () => socket.send(JSON.stringify({ t: "hello", v: 2, chain: "chain-1", token: "secret" })));
      socket.on("close", (closed) => {
        clearTimeout(timer);
        resolve(closed);
      });
    });
    assert.equal(code, 1008);
  } finally {
    await server.close();
  }
});
