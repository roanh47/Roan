import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket } from "ws";

import { startControlServer } from "./control.js";

/**
 * The generic onRequest catch-all once swallowed every frame type it did not
 * know — including rename_session, whose dedicated handler sat below it. The
 * rename arrived, the daemon answered "unknown request", and no event ever
 * reached the chain. This pins the gate: a dedicated chain action must reach
 * its own handler, whatever handlers are registered.
 */
test("a rename_session frame reaches onRenameSession, not the generic onRequest", async () => {
  const renames: { session: string; title: string }[] = [];
  const renamedNodes: { node: string; name: string }[] = [];
  const requests: string[] = [];
  let pushed = 0;
  let left = 0;

  const server = await startControlServer({
    port: 0,
    store: () => null,
    state: () => ({ daemon: "test", onboarding: true, chain: null, node: "n", sessions: [], peers: [], invite: "", model: "", provider: null, logPort: 0, version: "test" }) as never,
    onMessage: () => {},
    onRenameSession: (session, title) => {
      renames.push({ session, title });
      server.sendState();
    },
    onLeaveChain: () => {
      left += 1;
    },
    onRenameNode: (node, name) => {
      renamedNodes.push({ node, name });
    },
    onRequest: (kind) => {
      requests.push(kind);
    },
    onCreate: () => Promise.resolve({ t: "chain", chain: "c", node: "n" } as never),
    onJoin: () => Promise.resolve({ t: "chain", chain: "c", node: "n" } as never),
    log: () => {},
  });

  const events: { t: string; data?: unknown }[] = [];
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${String(server.port)}/ws`);
    socket.on("open", () => {
      socket.send(JSON.stringify({ t: "rename_session", session: "s1", title: "Nieuwe naam" }));
      socket.send(JSON.stringify({ t: "rename_node", node: "node-1", name: "Roans-Server" }));
      socket.send(JSON.stringify({ t: "leave_chain" }));
      setTimeout(() => {
        socket.close();
        resolve();
      }, 300);
    });
    socket.on("message", (raw) => events.push(JSON.parse(String(raw)) as { t: string }));
    socket.on("error", reject);
  });
  // sendState is part of the rename contract: every window follows.
  await new Promise<void>((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${String(server.port)}/ws`);
    socket.on("open", () => {
      socket.send(JSON.stringify({ t: "state" }));
      socket.send(JSON.stringify({ t: "rename_session", session: "s1", title: "Nog een keer" }));
      setTimeout(() => {
        socket.close();
        resolve();
      }, 300);
    });
    socket.on("message", () => {
      pushed += 1;
    });
  });

  await server.close();

  assert.deepEqual(renames, [
    { session: "s1", title: "Nieuwe naam" },
    { session: "s1", title: "Nog een keer" },
  ]);
  assert.deepEqual(requests, [], "rename_session must not fall into the generic onRequest path");
  assert.ok(pushed >= 1, "a state frame came back after the rename");
  assert.equal(left, 1, "leave_chain reaches onLeaveChain, not the generic onRequest path");
  assert.deepEqual(renamedNodes, [{ node: "node-1", name: "Roans-Server" }]);
});
