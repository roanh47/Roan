import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { WebSocketServer, type WebSocket } from "ws";

import { connect, ControlClientError } from "../sdk/client.js";

/**
 * The control port, end to end against a fake daemon.
 *
 * This test lives in `tests/` rather than beside `sdk/client.ts` because the
 * sdk is outside `tsconfig`'s rootDir: `npx tsx --test tests/*.test.ts` is the
 * gate that compiles and runs it with the repo's own tsx. The fake speaks the
 * real frame shapes from `src/daemon/control.ts` — no real daemon, no port
 * 7411, nothing chain-shaped is written.
 */

interface FakeDaemon {
  readonly url: string;
  /** Every frame the fake received, in order. */
  readonly frames: Record<string, unknown>[];
}

interface FakeOptions {
  /** Send the greeting state frame the real daemon sends on connect. */
  readonly greet?: Record<string, unknown>;
  readonly answer?: (frame: Record<string, unknown>, socket: WebSocket) => void;
}

async function withFakeDaemon(
  options: FakeOptions,
  run: (daemon: FakeDaemon) => Promise<void>,
): Promise<void> {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  const frames: Record<string, unknown>[] = [];
  server.on("connection", (socket) => {
    if (options.greet !== undefined) socket.send(JSON.stringify({ t: "state", data: options.greet }));
    socket.on("message", (raw) => {
      const frame = JSON.parse(String(raw)) as Record<string, unknown>;
      frames.push(frame);
      options.answer?.(frame, socket);
    });
  });
  try {
    await run({ url: `ws://127.0.0.1:${String(port)}/`, frames });
  } finally {
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function stateData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    onboarding: false,
    chain: "chain-a",
    node: "node-a",
    head: 4,
    peers: ["node-b"],
    nodes: [{ node: "node-a", name: "laptop", host: "10.0.0.2", port: 7420, live: true }],
    invite: "code",
    model: "m1",
    provider: "p1",
    sessions: [{ id: "s1", title: "first", messages: 2 }],
    activeSession: "s1",
    ...overrides,
  };
}

/** A port nobody listens on: bound once to learn a free one, then released. */
async function freePort(): Promise<number> {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/**
 * `send()`/`append()` resolve when the frame is written, which is before the
 * fake has parsed it. Nothing here is acknowledged by a reply (the daemon does
 * not answer an append), so the test waits for the far side to catch up.
 */
async function waitForFrames(frames: unknown[], wanted: number): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (frames.length < wanted) {
    if (Date.now() > deadline) {
      throw new Error(`the fake daemon saw ${String(frames.length)} frames, expected ${String(wanted)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("state() sends one state frame and returns the daemon's data", async () => {
  await withFakeDaemon(
    {
      answer: (frame, socket) => {
        if (frame["t"] === "state") socket.send(JSON.stringify({ t: "state", data: stateData() }));
      },
    },
    async ({ url, frames }) => {
      const client = connect(url, { timeoutMs: 2_000 });
      try {
        const state = await client.state();
        assert.deepEqual(state.chain, "chain-a");
        assert.deepEqual(state.head, 4);
        assert.deepEqual(state.nodes.map((node) => node.name), ["laptop"]);
        assert.deepEqual(frames, [{ t: "state" }]);
      } finally {
        client.close();
      }
    },
  );
});

test("send() writes an append frame with text, session and an event id", async () => {
  await withFakeDaemon({}, async ({ url, frames }) => {
    const client = connect(url, { timeoutMs: 2_000 });
    try {
      const first = await client.send("hello", "s1");
      const second = await client.send("again");
      assert.notEqual(first, second);
      await waitForFrames(frames, 2);

      assert.equal(frames.length, 2);
      assert.equal(frames[0]?.["t"], "append");
      const event = frames[0]?.["event"] as { id?: unknown; data?: unknown };
      assert.equal(event.id, first);
      assert.deepEqual(event.data, { text: "hello", session: "s1" });

      const secondEvent = frames[1]?.["event"] as { data?: unknown };
      assert.deepEqual(secondEvent.data, { text: "again" });
    } finally {
      client.close();
    }
  });
});

test("append() honours a caller-supplied event id and refuses empty text", async () => {
  await withFakeDaemon({}, async ({ url, frames }) => {
    const client = connect(url, { timeoutMs: 2_000 });
    try {
      const id = await client.append({ id: "own-id", data: { text: "hi" } });
      assert.equal(id, "own-id");
      await waitForFrames(frames, 1);
      assert.equal((frames[0]?.["event"] as { id?: unknown }).id, "own-id");

      await assert.rejects(() => client.append({ data: { text: "   " } }), (error: unknown) => {
        assert.ok(error instanceof ControlClientError);
        assert.equal(error.code, "bad_reply");
        return true;
      });
      assert.equal(frames.length, 1, "an empty message must not reach the daemon");
    } finally {
      client.close();
    }
  });
});

test("export() correlates on req and returns the reply data", async () => {
  const reply = { ok: true, path: "/home/roan/exports/chain-1.jsonl", shared: null, count: 12 };
  await withFakeDaemon(
    {
      answer: (frame, socket) => {
        if (frame["t"] === "export") socket.send(JSON.stringify({ t: "reply", id: frame["req"], data: reply }));
      },
    },
    async ({ url, frames }) => {
      const client = connect(url, { timeoutMs: 2_000 });
      try {
        const exported = await client.export("chain");
        assert.deepEqual(exported, reply);

        assert.equal(frames.length, 1);
        assert.equal(frames[0]?.["t"], "export");
        assert.equal(frames[0]?.["what"], "chain");
        assert.equal(typeof frames[0]?.["req"], "string");
        assert.equal(frames[0]?.["id"], undefined, "id belongs to the request data, not the correlation");
      } finally {
        client.close();
      }
    },
  );
});

test("a refused export is data, not an exception", async () => {
  await withFakeDaemon(
    {
      answer: (frame, socket) => {
        if (frame["t"] === "export") {
          socket.send(JSON.stringify({ t: "reply", id: frame["req"], data: { ok: false, error: "unknown conversation" } }));
        }
      },
    },
    async ({ url }) => {
      const client = connect(url, { timeoutMs: 2_000 });
      try {
        assert.deepEqual(await client.export("nope"), { ok: false, error: "unknown conversation" });
      } finally {
        client.close();
      }
    },
  );
});

test("a reply with a foreign id is ignored and the request times out with a clear error", async () => {
  await withFakeDaemon(
    {
      answer: (frame, socket) => {
        if (frame["t"] === "plan_mode") {
          socket.send(JSON.stringify({ t: "reply", id: "someone-else", data: { ok: true } }));
        }
      },
    },
    async ({ url }) => {
      const client = connect(url, { timeoutMs: 120 });
      try {
        await assert.rejects(() => client.request("plan_mode", { enabled: true }), (error: unknown) => {
          assert.ok(error instanceof ControlClientError);
          assert.equal(error.code, "timeout");
          assert.match(error.message, /plan_mode/);
          return true;
        });
      } finally {
        client.close();
      }
    },
  );
});

test("connect() reports an unreachable control port as connect_failed", async () => {
  const port = await freePort();
  const client = connect(`ws://127.0.0.1:${String(port)}/`, { timeoutMs: 1_500 });
  try {
    await assert.rejects(() => client.state(), (error: unknown) => {
      assert.ok(error instanceof ControlClientError);
      assert.equal(error.code, "connect_failed");
      return true;
    });
    // The failure sticks: a second call must not hang or invent a state.
    await assert.rejects(() => client.request("take_shared"), (error: unknown) => {
      assert.ok(error instanceof ControlClientError);
      assert.equal(error.code, "connect_failed");
      return true;
    });
  } finally {
    client.close();
  }
});

test("close() rejects a request that is still waiting", async () => {
  await withFakeDaemon({}, async ({ url }) => {
    const client = connect(url, { timeoutMs: 5_000 });
    const pending = client.request("goal", { text: "ship it" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    client.close();
    await assert.rejects(pending, (error: unknown) => {
      assert.ok(error instanceof ControlClientError);
      assert.equal(error.code, "closed");
      return true;
    });
  });
});

test("request() refuses the kinds that are not request/reply", async () => {
  const client = connect("ws://127.0.0.1:1/", { timeoutMs: 200 });
  try {
    await assert.rejects(() => client.request("state"), (error: unknown) => {
      assert.ok(error instanceof ControlClientError);
      assert.equal(error.code, "bad_reply");
      return true;
    });
  } finally {
    client.close();
  }
});

test("request() carries a caller-supplied correlation for tool_approve", async () => {
  await withFakeDaemon(
    {
      answer: (frame, socket) => {
        if (frame["t"] === "tool_approve") {
          socket.send(JSON.stringify({ t: "reply", id: frame["req"], data: { ok: true, tool: "run_shell", learned: true } }));
        }
      },
    },
    async ({ url, frames }) => {
      const client = connect(url, { timeoutMs: 2_000 });
      try {
        // The daemon reads `req` as the approval id, so it is the correlation id too.
        const reply = await client.request("tool_approve", { allow: true }, "approval-1");
        assert.deepEqual(reply, { ok: true, tool: "run_shell", learned: true });
        assert.equal(frames[0]?.["req"], "approval-1");
        assert.equal(frames[0]?.["t"], "tool_approve");
        assert.equal(frames[0]?.["allow"], true);
      } finally {
        client.close();
      }
    },
  );
});

test("request() keeps its own frame type when request data names t or req", async () => {
  await withFakeDaemon(
    {
      answer: (frame, socket) => socket.send(JSON.stringify({ t: "reply", id: frame["req"], data: { ok: true } })),
    },
    async ({ url, frames }) => {
      const client = connect(url, { timeoutMs: 2_000 });
      try {
        assert.deepEqual(await client.request("plan_mode", { t: "append", req: "not-the-address" }), { ok: true });
        assert.equal(frames[0]?.["t"], "plan_mode");
        assert.equal(typeof frames[0]?.["req"], "string");
        assert.notEqual(frames[0]?.["req"], "not-the-address");
      } finally {
        client.close();
      }
    },
  );
});

test("send() drops an empty session instead of naming a conversation with \"\"", async () => {
  await withFakeDaemon({}, async ({ url, frames }) => {
    const client = connect(url, { timeoutMs: 2_000 });
    try {
      await client.send("hello", "");
      await waitForFrames(frames, 1);
      assert.deepEqual((frames[0]?.["event"] as { data?: unknown }).data, { text: "hello" });
    } finally {
      client.close();
    }
  });
});
