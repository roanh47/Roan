/**
 * What a turn cost, recorded where the app reads it.
 *
 * Task 9 in one file: the loop keeps the usage the provider reports, the turn
 * runner writes it into the `turn_end` event (no new event type), and effort
 * travels the same path into the request body. The real runner, the real store
 * and a scripted provider are used; only the model is fake.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { EventStore } from "../src/chain/store.js";
import { runTurn } from "../src/daemon/turn-runner.js";
import type { Event } from "../src/protocol/types.js";
import { createStubProvider, type StubProvider } from "../src/testing/stub-provider.js";
import { withTempDir } from "../src/testing/temp-dir.js";
import { allTools } from "../src/tools.js";
import type { EffortLevel } from "../src/providers/effort.js";

const CHAIN = "chain-usage";
const NODE = "test-node";
const SESSION = "session-usage";

function append(store: EventStore, type: Event["type"], data: unknown): Event {
  return store.append(CHAIN, { id: randomUUID(), node: NODE, type, data }) as unknown as Event;
}

/** A store with one conversation in it. */
function seedSession(): EventStore {
  const store = EventStore.open(":memory:");
  append(store, "session", { id: SESSION, title: "Count the tokens" });
  append(store, "message", { text: "Say hi", session: SESSION });
  return store;
}

async function runOneTurn(
  stub: StubProvider,
  store: EventStore,
  dir: string,
  extra: { effort?: EffortLevel; providerId?: string } = {},
): Promise<void> {
  await runTurn(
    {
      store,
      chain: CHAIN,
      node: NODE,
      provider: {
        baseUrl: stub.baseUrl,
        apiKey: "",
        model: "stub-model",
        ...(extra.providerId !== undefined ? { providerId: extra.providerId } : {}),
      },
      ...(extra.effort !== undefined ? { effort: extra.effort } : {}),
      cwd: dir,
      systemPrompt: "You are Roan.",
      tools: allTools(),
      session: SESSION,
      onAppend: () => undefined,
    },
    "Say hi",
  );
}

function turnEnd(store: EventStore): { reason?: unknown; usage?: unknown } {
  const ended = (store.read(CHAIN, 1, 100_000) as unknown as Event[]).filter(
    (event) => event.type === "turn_end",
  );
  assert.equal(ended.length, 1, "a turn must close exactly once");
  return ended[0]?.data as { reason?: unknown; usage?: unknown };
}

test("a turn records its usage in the turn_end event", async () => {
  const stub = await createStubProvider([
    {
      chunks: [
        { content: "Hello." },
        { usage: { prompt_tokens: 1234, completion_tokens: 567 } },
      ],
    },
  ]);

  try {
    await withTempDir(async (dir) => {
      const store = seedSession();
      try {
        await runOneTurn(stub, store, dir);
        const data = turnEnd(store);
        assert.deepEqual(data.usage, { input: 1234, output: 567 });
        // The lock still owns the closing event; usage rides along, and the
        // reason says the loop finished rather than stopped.
        assert.equal(data.reason, "completed");
      } finally {
        store.close();
      }
    }, "roan-usage-");
  } finally {
    await stub.close();
  }
});

test("usage from every request of a turn is summed", async () => {
  const stub = await createStubProvider([
    {
      chunks: [
        { id: "call-1", name: "list_dir", arguments: JSON.stringify({ path: "." }) },
        { usage: { prompt_tokens: 1000, completion_tokens: 100 } },
      ],
    },
    {
      chunks: [
        { content: "Here is the listing." },
        { usage: { prompt_tokens: 1500, completion_tokens: 50 } },
      ],
    },
  ]);

  try {
    await withTempDir(async (dir) => {
      const store = seedSession();
      try {
        await runOneTurn(stub, store, dir);
        assert.equal(stub.requests.length, 2, "the tool round trip is two requests");
        assert.deepEqual(turnEnd(store).usage, { input: 2500, output: 150 });
      } finally {
        store.close();
      }
    }, "roan-usage-sum-");
  } finally {
    await stub.close();
  }
});

test("a provider that reports nothing leaves turn_end without usage", async () => {
  const stub = await createStubProvider([{ chunks: [{ content: "No counters here." }] }]);

  try {
    await withTempDir(async (dir) => {
      const store = seedSession();
      try {
        await runOneTurn(stub, store, dir);
        const data = turnEnd(store);
        assert.equal("usage" in data, false);
        assert.equal(data.reason, "completed");
      } finally {
        store.close();
      }
    }, "roan-usage-none-");
  } finally {
    await stub.close();
  }
});

test("effort set for the turn reaches the provider request", async () => {
  const stub = await createStubProvider([{ chunks: [{ content: "Thinking hard." }] }]);

  try {
    await withTempDir(async (dir) => {
      const store = seedSession();
      try {
        await runOneTurn(stub, store, dir, { effort: "high", providerId: "openai" });
        const body = stub.requests[0]?.body as { reasoning_effort?: unknown } | null | undefined;
        assert.equal(body?.reasoning_effort, "high");
      } finally {
        store.close();
      }
    }, "roan-effort-");
  } finally {
    await stub.close();
  }
});
