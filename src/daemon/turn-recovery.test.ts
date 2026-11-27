/**
 * Q2: a full window and an empty answer are their own failure forms.
 *
 * A provider that rejects the request as too large gets one compressed retry,
 * because the transcript — not the provider — is the thing that is wrong. A
 * model that answers with nothing gets exactly one request that names the
 * silence; a second empty answer ends the turn with a reason instead of a
 * blank screen.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { EventStore } from "../chain/store.js";
import { EMPTY_RETRY_PROMPT } from "../agent.js";
import { runTurn } from "./turn-runner.js";
import type { Event } from "../protocol/types.js";
import type { Tool } from "../types.js";
import { createStubProvider, type RecordedRequest, type StubProvider } from "../testing/stub-provider.js";
import { withTempDir } from "../testing/temp-dir.js";

const CHAIN = "chain-recovery";
const NODE = "test-node";
const SESSION = "session-recovery";
const NO_KEY = "";

/** A long answer, the kind that makes a request too big to send. */
function longText(label: string): string {
  return `${label}: ${"the quick brown fox jumps over the lazy dog. ".repeat(60)}`;
}

function seedSession(history: number): EventStore {
  const store = EventStore.open(":memory:");
  const append = (type: Event["type"], data: unknown): void => {
    store.append(CHAIN, { id: randomUUID(), node: NODE, type, data });
  };
  append("session", { id: SESSION, title: "Recovery" });
  for (let i = 0; i < history; i++) {
    append("message", { text: longText(`question ${String(i)}`), session: SESSION });
    append("assistant", { text: longText(`answer ${String(i)}`), session: SESSION });
  }
  append("message", { text: "Do the thing", session: SESSION });
  return store;
}

function readChain(store: EventStore): Event[] {
  return store.read(CHAIN, 1, 100_000) as unknown as Event[];
}

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

function answers(store: EventStore): string[] {
  return readChain(store)
    .filter((event) => event.type === "assistant")
    .map((event) => String((event.data as { text?: unknown }).text ?? ""));
}

/** Total characters of the messages one request carried. */
function requestChars(request: RecordedRequest | undefined): number {
  const body = request?.body;
  if (typeof body !== "object" || body === null) return 0;
  const messages = (body as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return 0;
  return messages.reduce<number>((sum, message: unknown) => {
    if (typeof message !== "object" || message === null) return sum;
    const content = (message as { content?: unknown }).content;
    return sum + (typeof content === "string" ? content.length : 0);
  }, 0);
}

/** The last message of the request, as the model saw it. */
function lastMessage(request: RecordedRequest | undefined): { role?: unknown; content?: unknown } {
  const body = request?.body;
  if (typeof body !== "object" || body === null) return {};
  const messages = (body as { messages?: unknown }).messages;
  if (!Array.isArray(messages) || messages.length === 0) return {};
  const last: unknown = messages[messages.length - 1];
  return typeof last === "object" && last !== null ? (last as { role?: unknown; content?: unknown }) : {};
}

const quietTool: Tool = {
  name: "noop",
  description: "does nothing",
  parameters: { type: "object", properties: {} },
  run(): Promise<string> {
    return Promise.resolve("ok");
  },
};

async function runRecoveryTurn(stub: StubProvider, store: EventStore, dir: string): Promise<void> {
  await runTurn(
    {
      store,
      chain: CHAIN,
      node: NODE,
      provider: { baseUrl: stub.baseUrl, apiKey: NO_KEY, model: "stub-model" },
      cwd: dir,
      systemPrompt: "You are Roan.",
      tools: [quietTool],
      session: SESSION,
      onAppend: () => undefined,
    },
    "Do the thing",
  );
}

test("a history too large for the window is compressed and the turn continues", async () => {
  const stub = await createStubProvider([
    {
      error: {
        status: 400,
        body: JSON.stringify({
          error: { message: "This model's maximum context length is 8192 tokens" },
        }),
      },
    },
    { chunks: [{ content: "Answered after compression." }] },
  ]);
  try {
    await withTempDir(async (dir) => {
      const store = seedSession(8);
      try {
        await runRecoveryTurn(stub, store, dir);

        assert.equal(stub.requests.length, 2, "one rejected request, one compressed retry");
        const before = requestChars(stub.requests[0]);
        const after = requestChars(stub.requests[1]);
        assert.ok(before > 10_000, `the seeded history really is big (${String(before)} chars)`);
        assert.ok(
          after < before / 2,
          `the retry carries less: ${String(before)} → ${String(after)} chars`,
        );
        assert.equal(answers(store).at(-1), "Answered after compression.");
        assert.equal(turnEnd(store)["reason"], "completed");
      } finally {
        store.close();
      }
    }, "roan-recovery-overflow-");
  } finally {
    await stub.close();
  }
});

test("an empty answer gets exactly one explicit retry, then an honest error", async () => {
  const stub = await createStubProvider([{ chunks: [] }, { chunks: [] }]);
  try {
    await withTempDir(async (dir) => {
      const store = seedSession(0);
      try {
        await runRecoveryTurn(stub, store, dir);

        assert.equal(stub.requests.length, 2, "one silent answer, one retry — never a third call");
        assert.equal(lastMessage(stub.requests[1])["content"], EMPTY_RETRY_PROMPT);
        assert.deepEqual(answers(store), [], "an empty answer is not shown as an answer");
        assert.match(errorMessages(store).join("\n"), /empty answer twice/);
        assert.equal(turnEnd(store)["reason"], "empty");
      } finally {
        store.close();
      }
    }, "roan-recovery-empty-");
  } finally {
    await stub.close();
  }
});

test("a window rejection that cannot shrink ends the turn instead of looping", async () => {
  const stub = await createStubProvider([
    {
      error: {
        status: 413,
        body: JSON.stringify({ error: { message: "payload too large for this endpoint" } }),
      },
    },
  ]);
  try {
    await withTempDir(async (dir) => {
      const store = seedSession(0);
      try {
        await runRecoveryTurn(stub, store, dir);

        assert.equal(stub.requests.length, 1, "the same request is not resent unchanged");
        assert.match(errorMessages(store).join("\n"), /cannot be shrunk further/);
        assert.equal(turnEnd(store)["reason"], "overflow");
      } finally {
        store.close();
      }
    }, "roan-recovery-nowhere-");
  } finally {
    await stub.close();
  }
});
