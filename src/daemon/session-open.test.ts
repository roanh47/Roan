import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { WebSocket } from "ws";

import { readSessions } from "../chain/sessions.js";
import { EventStore } from "../chain/store.js";
import { assertConverged, syncBothWays, withTwoNodes } from "../testing/two-node.js";
import { startControlServer } from "./control.js";
import { openSession } from "./session-open.js";

/**
 * What the daemon does for `new_session`: the id rules, and the event itself.
 *
 * A conversation is chain state, so the test uses the real store and the real
 * fold — the id the app is told is the id the drawer will show, on this device
 * and on every other one.
 */

const CHAIN = "gesprek";
const NODE = "node-self";

/** The chat `onCreate` leaves behind, so the drawer is never empty. */
function createdChain(): EventStore {
  const store = EventStore.open(":memory:");
  store.append(CHAIN, {
    id: "event-seed",
    node: NODE,
    ts: 1,
    type: "session",
    data: { id: "seed-chat", title: "New chat" },
  });
  return store;
}

function sessionIds(store: EventStore): string[] {
  return readSessions(store.read(CHAIN)).sessions.map((entry) => entry.id);
}

/** Deterministic ids, so a reused id is impossible to miss in the assertions. */
function counter(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `id-${String(next)}`;
  };
}

test("two new chats get two ids, and one after a message gets a third", () => {
  const store = createdChain();
  try {
    const issued = new Set<string>();
    const newId = counter();

    // The untouched "New chat" that onboarding left behind is adopted: it is a
    // conversation that already exists and nobody has said anything in.
    const first = openSession(store, CHAIN, NODE, issued, { reuseEmpty: true, newId });
    const second = openSession(store, CHAIN, NODE, issued, { reuseEmpty: true, newId });

    assert.notEqual(first.id, second.id);
    assert.equal(first.created, false, "the onboarding chat is adopted, not duplicated");
    assert.equal(second.created, true);
    assert.equal(store.head(CHAIN), 2);

    // A message lands in the second conversation; from then on it is not empty.
    store.append(CHAIN, {
      id: "event-message",
      node: NODE,
      ts: 2,
      type: "message",
      data: { text: "hoi", session: second.id },
    });

    const third = openSession(store, CHAIN, NODE, issued, { reuseEmpty: true, newId });
    assert.equal(third.created, true);
    assert.notEqual(third.id, second.id);
    assert.notEqual(third.id, first.id);

    assert.deepEqual(sessionIds(store), ["seed-chat", second.id, third.id]);
    assert.equal(new Set([first.id, second.id, third.id]).size, 3);
  } finally {
    store.close();
  }
});

test("an untouched chat that is already there is adopted instead of duplicated", () => {
  const store = createdChain();
  try {
    const issued = new Set<string>();
    const opened = openSession(store, CHAIN, NODE, issued, { reuseEmpty: true, newId: counter() });
    assert.deepEqual(opened, { id: "seed-chat", created: false, event: null });
    assert.equal(store.head(CHAIN), 1, "adopting writes nothing");
    assert.deepEqual(sessionIds(store), ["seed-chat"]);
  } finally {
    store.close();
  }
});

test("a chat with a message is never adopted", () => {
  const store = createdChain();
  try {
    store.append(CHAIN, {
      id: "event-message",
      node: NODE,
      ts: 2,
      type: "message",
      data: { text: "hoi", session: "seed-chat" },
    });
    const opened = openSession(store, CHAIN, NODE, new Set<string>(), {
      reuseEmpty: true,
      newId: counter(),
    });
    assert.equal(opened.created, true);
    assert.notEqual(opened.id, "seed-chat");
  } finally {
    store.close();
  }
});

test("an explicit title always starts a conversation of its own", () => {
  const store = createdChain();
  try {
    const opened = openSession(store, CHAIN, NODE, new Set<string>(), {
      reuseEmpty: true,
      title: "Planning",
      newId: counter(),
    });
    assert.equal(opened.created, true);
    assert.equal(opened.event?.type, "session");
    assert.deepEqual(opened.event?.data, { id: opened.id, title: "Planning" });
    assert.deepEqual(sessionIds(store), ["seed-chat", opened.id]);
  } finally {
    store.close();
  }
});

test("no two conversations ever share an id", () => {
  const store = createdChain();
  try {
    const issued = new Set<string>();
    const newId = counter();
    const ids: string[] = [];
    for (let round = 1; round <= 4; round += 1) {
      const opened = openSession(store, CHAIN, NODE, issued, { reuseEmpty: true, newId });
      ids.push(opened.id);
      // Every round the previous chat has something in it, so nothing is
      // adopted and every answer is a start.
      store.append(CHAIN, {
        id: `event-message-${String(round)}`,
        node: NODE,
        ts: 10 + round,
        type: "message",
        data: { text: `vraag ${String(round)}`, session: opened.id },
      });
    }
    assert.equal(new Set(ids).size, ids.length);
    const events = store.read(CHAIN).filter((event) => event.type === "session");
    const sessionEventIds = events.map((event) => (event.data as { id: string }).id);
    assert.equal(new Set(sessionEventIds).size, sessionEventIds.length);
    assert.deepEqual(sessionIds(store), ids);
  } finally {
    store.close();
  }
});

test("a new conversation reaches the other device as a session event", async () => {
  await withTwoNodes(async (a, b) => {
    const opened = a.store.disk.append(CHAIN, {
      id: "event-chat",
      node: "a",
      ts: 5,
      type: "session",
      data: { id: "chat-1", title: "Nieuw gesprek" },
    });
    assert.equal(opened.type, "session");

    await syncBothWays(a, b);
    assertConverged(a, b);

    const seen = readSessions(b.store.all() as unknown as import("../protocol/types.js").Event[]);
    assert.deepEqual(
      seen.sessions.map((entry) => entry.id),
      ["chat-1"],
    );
    assert.equal(b.store.all().at(-1)?.type, "session");
  });
});

/* -------------------------------------------------------------------------- */
/* Over the control socket                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The frames the app actually exchanges. `main.ts` wires `onNewSession` to
 * `openSession` and answers with the id; this repeats that wiring against the
 * real server so the reply and the chain cannot drift apart.
 */

test("two new chats over the socket answer with two different ids, and a third after a message with a third", async () => {
  const missingDist = join(process.cwd(), "tmp-no-such-dist-" + String(process.pid));

  const store = createdChain();
  const issued = new Set<string>();
  const newId = counter();
  let server: Awaited<ReturnType<typeof startControlServer>> | null = null;
  server = await startControlServer({
    port: 0,
    host: "127.0.0.1",
    webDist: missingDist,
    store: () => store,
    state: () => ({
      onboarding: false,
      chain: CHAIN,
      node: NODE,
      head: store.head(CHAIN),
      peers: [],
      nodes: [],
      invite: null,
      sessions: readSessions(store.read(CHAIN)).sessions.map((entry) => ({
        id: entry.id,
        title: entry.title,
        messages: entry.messages,
      })),
    }),
    onMessage: () => {},
    onNewSession: (title?: string) => {
      const opened = openSession(store, CHAIN, NODE, issued, {
        ...(title === undefined ? {} : { title }),
        reuseEmpty: true,
        newId,
      });
      server?.sendState();
      return opened.id;
    },
    onCreate: () => Promise.resolve({ t: "chain", chain: CHAIN, node: NODE }),
    onJoin: () => Promise.resolve({ t: "chain", chain: CHAIN, node: NODE }),
  });

  const frames: { t?: string; session?: string }[] = [];
  const socket = new WebSocket(`ws://127.0.0.1:${String(server.port)}/ws`);
  await new Promise<void>((resolve, reject) => {
    socket.on("message", (raw: unknown) => frames.push(JSON.parse(String(raw)) as { t?: string }));
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });

  const replies = (): string[] =>
    frames.filter((frame) => frame.t === "new_session").map((frame) => String(frame.session));

  const ask = async (expected: number): Promise<void> => {
    socket.send(JSON.stringify({ t: "new_session" }));
    const deadline = Date.now() + 3_000;
    while (replies().length < expected) {
      if (Date.now() > deadline) throw new Error("timeout: new_session reply");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };

  try {
    await ask(1);
    await ask(2);
    const [first, second] = replies();
    assert.ok(first !== undefined && second !== undefined);
    assert.notEqual(first, second);

    store.append(CHAIN, {
      id: "event-message",
      node: NODE,
      ts: 20,
      type: "message",
      data: { text: "hoi", session: second },
    });

    await ask(3);
    const third = replies()[2];
    assert.ok(third !== undefined);
    assert.notEqual(third, second);
    assert.notEqual(third, first);

    // Every id the app was told is a conversation the chain really holds.
    const known = readSessions(store.read(CHAIN)).sessions.map((entry) => entry.id);
    assert.ok(known.includes(first));
    assert.ok(known.includes(second));
    assert.ok(known.includes(third));
  } finally {
    socket.close();
    await server.close();
    store.close();
  }
});
