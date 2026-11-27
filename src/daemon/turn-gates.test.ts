/**
 * The three gates that can end a turn without an answer: the step budget,
 * the owner's interrupt and the stall watchdog. Each one has its own test, and
 * each one leaves a `turn_end` that says *why* — a turn that stops is not the
 * same as a turn that finished, and the chain has to be able to tell.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { Socket } from "node:net";
import { test } from "node:test";

import { EventStore } from "../chain/store.js";
import { runTurn } from "./turn-runner.js";
import type { Event } from "../protocol/types.js";
import type { Tool } from "../types.js";
import { createStubProvider, type StubProvider } from "../testing/stub-provider.js";
import { withTempDir } from "../testing/temp-dir.js";

const CHAIN = "chain-gates";
const NODE = "test-node";
const SESSION = "session-gates";
/** No key: the stub does not check one, and an empty string is what a local server gets. */
const NO_KEY = "";

function seedSession(): EventStore {
  const store = EventStore.open(":memory:");
  const append = (type: Event["type"], data: unknown): void => {
    store.append(CHAIN, { id: randomUUID(), node: NODE, type, data });
  };
  append("session", { id: SESSION, title: "Gates" });
  append("message", { text: "Do the thing", session: SESSION });
  return store;
}

function readChain(store: EventStore): Event[] {
  return store.read(CHAIN, 1, 100_000) as unknown as Event[];
}

/** The single `turn_end` of the turn, or a failure that names what was found. */
function turnEnd(store: EventStore): Record<string, unknown> {
  const ends = readChain(store).filter((event) => event.type === "turn_end");
  assert.equal(ends.length, 1, "a turn writes exactly one turn_end");
  const end = ends[0];
  assert.ok(end !== undefined);
  return end.data as Record<string, unknown>;
}

function errorMessages(store: EventStore): string[] {
  return readChain(store)
    .filter((event) => event.type === "error")
    .map((event) => String((event.data as { message?: unknown }).message ?? ""));
}

function quietTool(): Tool {
  return {
    name: "noop",
    description: "does nothing",
    parameters: { type: "object", properties: {} },
    run(): Promise<string> {
      return Promise.resolve("ok");
    },
  };
}

interface TurnOptions {
  readonly baseUrl: string;
  readonly dir: string;
  readonly store: EventStore;
  readonly maxSteps?: number;
  readonly stallTimeoutMs?: number;
  readonly signal?: AbortSignal;
}

async function runGatedTurn(options: TurnOptions): Promise<void> {
  await runTurn(
    {
      store: options.store,
      chain: CHAIN,
      node: NODE,
      provider: { baseUrl: options.baseUrl, apiKey: NO_KEY, model: "stub-model" },
      cwd: options.dir,
      systemPrompt: "You are Roan.",
      tools: [quietTool()],
      session: SESSION,
      onAppend: () => undefined,
      ...(options.maxSteps !== undefined ? { maxSteps: options.maxSteps } : {}),
      ...(options.stallTimeoutMs !== undefined ? { stallTimeoutMs: options.stallTimeoutMs } : {}),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    },
    "Do the thing",
  );
}

/**
 * A provider that accepts the request and then says nothing at all — the
 * "still thinking" that never ends. It answers no byte, so only the watchdog
 * can end the turn.
 */
async function createSilentProvider(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const sockets = new Set<Socket>();
  const server = createServer((_request, response) => {
    response.on("error", () => undefined);
    // Deliberately no write, no end: the connection stays open and silent.
  });
  server.on("connection", (socket: Socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error(`silent provider: expected a TCP address, got ${JSON.stringify(address)}`);
  }
  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}/v1`,
    close: async (): Promise<void> => {
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

function toolCallScript(count: number): { chunks: { id: string; name: string; arguments: string }[] }[] {
  return Array.from({ length: count }, (_value, index) => ({
    chunks: [{ id: `call-${String(index)}`, name: "noop", arguments: "{}" }],
  }));
}

async function withStore(work: (store: EventStore) => Promise<void>): Promise<void> {
  const store = seedSession();
  try {
    await work(store);
  } finally {
    store.close();
  }
}

test("a provider that only calls tools stops on the budget, after exactly one grace call", async () => {
  const stub: StubProvider = await createStubProvider(toolCallScript(20));
  try {
    await withTempDir(async (dir) => {
      await withStore(async (store) => {
        await runGatedTurn({ baseUrl: stub.baseUrl, dir, store, maxSteps: 3 });

        // Three rounds with the tools, then one last request without them.
        assert.equal(stub.requests.length, 4, "the budget allows one grace call, not a loop");
        const grace = stub.requests[3]?.body as { tools?: unknown } | null;
        assert.ok(grace !== null && typeof grace === "object");
        assert.equal(grace.tools, undefined, "the grace call withholds the tools");

        const end = turnEnd(store);
        assert.equal(end["reason"], "budget");
        assert.match(
          errorMessages(store).join("\n"),
          /stopped after 3 steps/,
          "the turn says why it gave up",
        );
      });
    }, "roan-gates-budget-");
  } finally {
    await stub.close();
  }
});

test("a provider that goes silent is aborted by the watchdog, with a reason", async () => {
  const silent = await createSilentProvider();
  try {
    await withTempDir(async (dir) => {
      await withStore(async (store) => {
        const started = Date.now();
        await runGatedTurn({ baseUrl: silent.baseUrl, dir, store, stallTimeoutMs: 120 });
        const took = Date.now() - started;

        assert.ok(took < 3_000, `the turn ended on the watchdog, not on a socket timeout (${String(took)}ms)`);
        assert.equal(turnEnd(store)["reason"], "watchdog");
        assert.match(errorMessages(store).join("\n"), /produced nothing for 120ms/);
      });
    }, "roan-gates-watchdog-");
  } finally {
    await silent.close();
  }
});

test("an interrupted turn sends no request and ends with reason interrupted", async () => {
  const stub = await createStubProvider();
  try {
    await withTempDir(async (dir) => {
      await withStore(async (store) => {
        const controller = new AbortController();
        controller.abort();
        await runGatedTurn({ baseUrl: stub.baseUrl, dir, store, signal: controller.signal });

        assert.equal(stub.requests.length, 0, "the interrupt gate is checked before the first request");
        assert.equal(turnEnd(store)["reason"], "interrupted");
        assert.deepEqual(errorMessages(store), ["stopped by you"]);
      });
    }, "roan-gates-interrupt-");
  } finally {
    await stub.close();
  }
});
