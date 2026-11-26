import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { WebSocket } from "ws";

import { createMemoryStore } from "../sync/memory-store.js";
import type { Event } from "../sync/types.js";
import { startControlServer } from "./control.js";
import { isLoopbackAddress } from "./control-http.js";
import { PEER_PATH, peers as peerList, startPeers, stopPeers } from "./peers.js";

const CHAIN = "gesprek";
const TOKEN = "geheim-token";
const NODE = "node-b";
const MISSING_DIST = join(process.cwd(), "tmp-no-such-dist-" + String(process.pid));

function fakeStore(): ReturnType<typeof createMemoryStore> {
  const events: Event[] = [
    { v: 1, chain: CHAIN, seq: 1, id: "e1", node: NODE, ts: 1_700_000_000_000, type: "message", data: { text: "hoi" } },
  ];
  return createMemoryStore({ chain: CHAIN, nodeId: NODE, events });
}

interface Control {
  readonly port: number;
  readonly newSessions: string[];
}

async function control(
  options: { isLocal?: (address: string | undefined) => boolean } = {},
): Promise<{ server: Awaited<ReturnType<typeof startControlServer>>; seen: Control }> {
  const seen: Control = { port: 0, newSessions: [] };
  const server = await startControlServer({
    port: 0,
    host: "127.0.0.1",
    webDist: MISSING_DIST,
    store: () => null,
    state: () =>
      ({ onboarding: true, chain: null, node: NODE, head: 0, peers: [], nodes: [], invite: null }) as never,
    onMessage: () => {},
    onNewSession: (title?: string) => {
      seen.newSessions.push(title ?? "");
      return "session-1";
    },
    onCreate: () => Promise.resolve({ t: "chain", chain: CHAIN, node: NODE } as never),
    onJoin: () => Promise.resolve({ t: "chain", chain: CHAIN, node: NODE } as never),
    ...(options.isLocal === undefined ? {} : { isLocal: options.isLocal }),
  });
  return { server, seen };
}

function open(url: string): Promise<{ socket: WebSocket; frames: string[] }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const frames: string[] = [];
    socket.on("message", (data: unknown) => frames.push(String(data)));
    socket.once("open", () => resolve({ socket, frames }));
    socket.once("error", reject);
  });
}

/** Opens, and resolves with the HTTP status the server refused with. */
function refusal(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.on("error", (error: Error) => {
      const match = /Unexpected server response: (\d{3})/.exec(error.message);
      if (match) resolve(Number(match[1]));
      else reject(error);
    });
    socket.once("open", () => {
      socket.close();
      reject(new Error("the server accepted a connection it should have refused"));
    });
  });
}

function closedWith(socket: WebSocket): Promise<number> {
  return new Promise((resolve, reject) => {
    socket.once("close", (code: number) => resolve(code));
    socket.once("error", reject);
    setTimeout(() => reject(new Error("socket did not close")), 3_000);
  });
}

async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timeout: " + label);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("missing web/dist answers an honest page and still speaks the control protocol", async () => {
  const { server, seen } = await control();
  try {
    const page = await fetch(server.url + "/").then(async (res) => ({ status: res.status, body: await res.text() }));
    assert.equal(page.status, 503);
    assert.match(page.body, /not been built/i);

    const { socket, frames } = await open(`ws://127.0.0.1:${String(server.port)}/ws`);
    await until(() => frames.length > 0, "state frame on connect");
    assert.equal((JSON.parse(frames[0] ?? "{}") as { t: string }).t, "state");

    socket.send(JSON.stringify({ t: "new_session", title: "Nieuw" }));
    await until(() => frames.some((frame) => (JSON.parse(frame) as { t: string }).t === "new_session"), "new_session reply");
    const reply = frames
      .map((frame) => JSON.parse(frame) as { t: string; session?: string })
      .find((frame) => frame.t === "new_session");
    assert.equal(reply?.session, "session-1");
    assert.deepEqual(seen.newSessions, ["Nieuw"]);
    socket.close();
  } finally {
    await server.close();
  }
});

test("one port: static files, the control socket and peer sync all live there", async () => {
  const { server } = await control();
  const store = fakeStore();
  try {
    // Peers are mounted on the same HTTP server the app already uses.
    await startPeers({
      store,
      token: TOKEN,
      mount: (handler) => server.mountUpgrade(PEER_PATH, handler),
    });

    // A peer completes the transport handshake with the chain token.
    const peer = await open(`ws://127.0.0.1:${String(server.port)}${PEER_PATH}?token=${TOKEN}`);
    peer.socket.send(JSON.stringify({ t: "hello", v: 1, chain: CHAIN, node: "node-a", haveSeq: 0 }));
    await until(() => peer.frames.some((frame) => (JSON.parse(frame) as { t?: string }).t === "hello"), "peer hello");
    const hello = peer.frames
      .map((frame) => JSON.parse(frame) as { t: string; chain?: string })
      .find((frame) => frame.t === "hello");
    assert.equal(hello?.chain, CHAIN);
    await until(() => peerList().includes("node-a"), "peer counted as connected");

    // ...while the control socket on the same port still answers.
    const { socket, frames } = await open(`ws://127.0.0.1:${String(server.port)}/ws`);
    socket.send(JSON.stringify({ t: "state" }));
    await until(() => frames.some((frame) => (JSON.parse(frame) as { t?: string }).t === "state"), "state on /ws");
    assert.equal(server.port > 0, true);
    socket.close();
    peer.socket.close();
  } finally {
    await stopPeers();
    await server.close();
  }
});

test("a peer without the chain token is refused on /peer", async () => {
  const { server } = await control();
  try {
    await startPeers({
      store: fakeStore(),
      token: TOKEN,
      mount: (handler) => server.mountUpgrade(PEER_PATH, handler),
    });

    const anonymous = await open(`ws://127.0.0.1:${String(server.port)}${PEER_PATH}`);
    assert.equal(await closedWith(anonymous.socket), 4401, "no token, no peer link");

    const wrong = await open(`ws://127.0.0.1:${String(server.port)}${PEER_PATH}?token=nope`);
    assert.equal(await closedWith(wrong.socket), 4401, "a wrong token is not a peer link either");
    assert.deepEqual(peerList(), []);
  } finally {
    await stopPeers();
    await server.close();
  }
});

test("a peer connection on /ws is refused: the control path takes no chain token", async () => {
  const { server } = await control();
  try {
    assert.equal(await refusal(`ws://127.0.0.1:${String(server.port)}/ws?token=${TOKEN}`), 403);

    // Even without a token in the URL, a peer hello is not a control frame.
    const peer = await open(`ws://127.0.0.1:${String(server.port)}/ws`);
    peer.socket.send(JSON.stringify({ t: "hello", v: 1, chain: CHAIN, node: "node-a", haveSeq: 0 }));
    assert.equal(await closedWith(peer.socket), 1008);
  } finally {
    await server.close();
  }
});

test("/ws is loopback-only unless the daemon is told otherwise", async () => {
  const local = await control();
  try {
    assert.equal(isLoopbackAddress("127.0.0.1"), true);
    assert.equal(isLoopbackAddress("::1"), true);
    assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
    assert.equal(isLoopbackAddress("100.64.0.9"), false);
    assert.equal(isLoopbackAddress("192.168.1.20"), false);
    assert.equal(isLoopbackAddress("8.8.8.8"), false);
    assert.equal(isLoopbackAddress(undefined), false);
  } finally {
    await local.server.close();
  }

  // The same gate, driven by an address the server treats as remote.
  const remote = await control({ isLocal: () => false });
  try {
    assert.equal(await refusal(`ws://127.0.0.1:${String(remote.server.port)}/ws`), 403);
    // Static files stay reachable: the page is not the secret, the socket is.
    const page = await fetch(remote.server.url + "/");
    assert.equal(page.status, 503);
  } finally {
    await remote.server.close();
  }

  // ROAN_ALLOW_REMOTE_CONTROL=1 is expressed as "everyone is local".
  const open2 = await control({ isLocal: () => true });
  try {
    const { socket, frames } = await open(`ws://127.0.0.1:${String(open2.server.port)}/ws`);
    await until(() => frames.length > 0, "state frame when remote control is allowed");
    socket.close();
  } finally {
    await open2.server.close();
  }
});
