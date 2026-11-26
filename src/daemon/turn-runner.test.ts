/**
 * Steer, end to end: the real turn runner, the real chain, a scripted provider.
 *
 * The inbox tests say what one slot means; this file says where the text
 * lands — after a round's tool results, before the model's answer, recorded as
 * an ordinary `message` event so the app and the next turn both see it. Two
 * turns with the same script must differ only when a steer actually arrived.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { EventStore } from "../chain/store.js";
import { runTurn } from "./turn-runner.js";
import type { Event } from "../protocol/types.js";
import type { Tool } from "../types.js";
import { createSteerInbox, type SteerInbox } from "../turn/index.js";
import { createStubProvider, type StubProvider } from "../testing/stub-provider.js";
import { withTempDir } from "../testing/temp-dir.js";

const CHAIN = "chain-steer";
const NODE = "test-node";
const SESSION = "session-steer";

interface WireMessage {
  readonly role?: unknown;
  readonly content?: unknown;
}

function appendSeed(store: EventStore, type: Event["type"], data: unknown): Event {
  return store.append(CHAIN, { id: randomUUID(), node: NODE, type, data }) as unknown as Event;
}

/** A store with one conversation in it. */
function seedSession(): EventStore {
  const store = EventStore.open(":memory:");
  appendSeed(store, "session", { id: SESSION, title: "Steer me" });
  appendSeed(store, "message", { text: "Do the thing", session: SESSION });
  return store;
}

function readChain(store: EventStore): Event[] {
  return store.read(CHAIN, 1, 100_000) as unknown as Event[];
}

/**
 * The turn's own events, without the bookkeeping: the seeded question, the
 * lock's turn events and the session header are not what this file is about.
 */
function flow(events: readonly Event[]): string[] {
  return events
    .filter((event) => event.type !== "session" && event.type !== "turn_start" && event.type !== "turn_end")
    .filter((event) => !(event.type === "message" && (event.data as { steer?: unknown }).steer !== true))
    .map((event) => event.type);
}

function messagesOf(stub: StubProvider, index: number): WireMessage[] {
  const body = stub.requests[index]?.body;
  if (typeof body !== "object" || body === null) return [];
  const messages = (body as { messages?: unknown }).messages;
  return Array.isArray(messages) ? (messages as WireMessage[]) : [];
}

function rolesOf(stub: StubProvider, index: number): unknown[] {
  return messagesOf(stub, index).map((message) => message.role);
}

/**
 * The live question is index 2: system, the replayed question, then the same
 * text on the live message. That one pair is inherited from the chain, not
 * created by the steer machinery, so it is the only pair allowed here.
 */
const INHERITED_USER_PAIR = 2;

function assertNoTwoUsersInARow(messages: readonly WireMessage[]): void {
  for (let i = 1; i < messages.length; i++) {
    if (i === INHERITED_USER_PAIR) continue;
    assert.notEqual(
      `${messages[i - 1]?.role}/${messages[i]?.role}`,
      "user/user",
      `two user messages in a row at index ${String(i)}: ${JSON.stringify(messages)}`,
    );
  }
}

/** A tool whose run pushes a steer, standing in for the owner typing mid-turn. */
function steeringTool(inbox: SteerInbox, text: string): Tool {
  return {
    name: "steer_now",
    description: "asks the owner to steer",
    parameters: { type: "object", properties: {} },
    run(): Promise<string> {
      inbox.push(text);
      return Promise.resolve("steer queued");
    },
  };
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

async function runOneTurn(
  stub: StubProvider,
  store: EventStore,
  dir: string,
  tools: readonly Tool[],
  steer?: SteerInbox,
): Promise<void> {
  await runTurn(
    {
      store,
      chain: CHAIN,
      node: NODE,
      provider: { baseUrl: stub.baseUrl, apiKey: "test-key", model: "stub-model" },
      cwd: dir,
      systemPrompt: "You are Roan.",
      tools,
      session: SESSION,
      ...(steer !== undefined ? { steer } : {}),
      onAppend: () => undefined,
    },
    "Do the thing",
  );
}

test("a steer lands after the tool results and before the answer", async () => {
  const inbox = createSteerInbox();
  const stub = await createStubProvider([
    { chunks: [{ id: "call-1", name: "steer_now", arguments: "{}" }] },
    { chunks: [{ content: "Steered." }] },
  ]);

  try {
    await withTempDir(async (dir) => {
      const store = seedSession();
      try {
        await runOneTurn(stub, store, dir, [steeringTool(inbox, "use the failing test")], inbox);

        // The chain, in order: the call, its result, the owner's words, the answer.
        assert.deepEqual(flow(readChain(store)), ["tool_call", "tool_result", "message", "assistant"]);
        const steer = readChain(store).find(
          (event) => event.type === "message" && (event.data as { steer?: unknown }).steer === true,
        );
        assert.deepEqual(steer?.data, { text: "use the failing test", steer: true, session: SESSION });

        // The request after the tool round carries it as the last user message,
        // and user and assistant still alternate apart from the inherited pair.
        assert.deepEqual(rolesOf(stub, 1), ["system", "user", "user", "assistant", "tool", "user"]);
        assert.equal(messagesOf(stub, 1).at(-1)?.content, "use the failing test");
        assertNoTwoUsersInARow(messagesOf(stub, 1));
        assert.deepEqual(rolesOf(stub, 0), ["system", "user", "user"], "the first request has no steer to carry");
      } finally {
        store.close();
      }
    }, "roan-steer-");
  } finally {
    await stub.close();
  }
});

test("a steer arriving in the final tool round still lands", async () => {
  const inbox = createSteerInbox();
  const stub = await createStubProvider([
    { chunks: [{ id: "call-1", name: "noop", arguments: "{}" }] },
    { chunks: [{ id: "call-2", name: "steer_now", arguments: "{}" }] },
    { chunks: [{ content: "Late but seen." }] },
  ]);

  try {
    await withTempDir(async (dir) => {
      const store = seedSession();
      try {
        await runOneTurn(stub, store, dir, [quietTool(), steeringTool(inbox, "one more thing")], inbox);

        assert.equal(stub.requests.length, 3, "two tool rounds, then the answer");
        assert.equal(
          messagesOf(stub, 1).some((message) => message.content === "one more thing"),
          false,
          "the steer arrived after this request was already on its way",
        );
        assert.deepEqual(rolesOf(stub, 2), [
          "system",
          "user",
          "user",
          "assistant",
          "tool",
          "assistant",
          "tool",
          "user",
        ]);
        assert.equal(messagesOf(stub, 2).at(-1)?.content, "one more thing");
        assertNoTwoUsersInARow(messagesOf(stub, 2));
        assert.deepEqual(flow(readChain(store)), ["tool_call", "tool_result", "tool_call", "tool_result", "message", "assistant"]);
      } finally {
        store.close();
      }
    }, "roan-steer-final-");
  } finally {
    await stub.close();
  }
});

test("a turn with an untouched inbox sends exactly what a turn without one sends", async () => {
  const stub = await createStubProvider([
    { chunks: [{ id: "call-1", name: "noop", arguments: "{}" }] },
    { chunks: [{ content: "Same as ever." }] },
    // The same script again: the stub's queue is shared, and both turns must
    // make the same two requests, down to the tool-call id in the body.
    { chunks: [{ id: "call-1", name: "noop", arguments: "{}" }] },
    { chunks: [{ content: "Same as ever." }] },
  ]);

  try {
    await withTempDir(async (dir) => {
      const withoutInbox = seedSession();
      const withEmptyInbox = seedSession();
      try {
        await runOneTurn(stub, withoutInbox, dir, [quietTool()]);
        await runOneTurn(stub, withEmptyInbox, dir, [quietTool()], createSteerInbox());

        for (const index of [0, 1]) {
          assert.deepEqual(
            messagesOf(stub, index + 2),
            messagesOf(stub, index),
            `request ${String(index)} must not change just because an inbox exists`,
          );
        }
        assert.deepEqual(flow(readChain(withEmptyInbox)), ["tool_call", "tool_result", "assistant"]);
        assert.equal(
          readChain(withEmptyInbox).some(
            (event) => event.type === "message" && (event.data as { steer?: unknown }).steer === true,
          ),
          false,
          "no steer means no steer event",
        );
      } finally {
        withoutInbox.close();
        withEmptyInbox.close();
      }
    }, "roan-steer-same-");
  } finally {
    await stub.close();
  }
});

test("a steer that arrives after the last request is recorded, not dropped", async () => {
  const inbox = createSteerInbox();
  const stub = await createStubProvider([{ chunks: [{ content: "Already answering." }] }]);

  try {
    await withTempDir(async (dir) => {
      const store = seedSession();
      try {
        // The owner types while the final answer is being written: there is no
        // request left to carry it, but the words still reach the chain.
        await runTurn(
          {
            store,
            chain: CHAIN,
            node: NODE,
            provider: { baseUrl: stub.baseUrl, apiKey: "test-key", model: "stub-model" },
            cwd: dir,
            systemPrompt: "You are Roan.",
            tools: [quietTool()],
            session: SESSION,
            steer: inbox,
            onAppend: (event) => {
              if (event.type === "assistant") inbox.push("next time, check the parser");
            },
          },
          "Do the thing",
        );

        const last = readChain(store).at(-1);
        assert.equal(last?.type, "message");
        assert.deepEqual(last?.data, { text: "next time, check the parser", steer: true, session: SESSION });
        assert.equal(inbox.take(), null, "the inbox is empty once the turn is over");
      } finally {
        store.close();
      }
    }, "roan-steer-late-");
  } finally {
    await stub.close();
  }
});
