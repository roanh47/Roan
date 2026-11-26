/**
 * The agent loop's role invariant and the hook a steer enters through.
 *
 * The runner is responsible for *when* to inject; this file pins the loop's
 * side: the hook runs before each request, text appended after tool results
 * reaches the model, and text appended anywhere else is refused before it can
 * reach a provider.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { Agent } from "./agent.js";
import type { ChatMessage, Tool } from "./types.js";
import { createStubProvider, type StubProvider } from "./testing/stub-provider.js";

const TOOL: Tool = {
  name: "echo",
  description: "returns a fixed string",
  parameters: { type: "object", properties: {} },
  run(): Promise<string> {
    return Promise.resolve("echoed");
  },
};

function provider(stub: StubProvider) {
  return { baseUrl: stub.baseUrl, apiKey: "test-key", model: "stub-model" };
}

interface WireMessage {
  readonly role?: unknown;
  readonly content?: unknown;
}

/** The messages the provider actually received on one request. */
function messagesOf(stub: StubProvider, index: number): WireMessage[] {
  const body = stub.requests[index]?.body;
  if (typeof body !== "object" || body === null) return [];
  const messages = (body as { messages?: unknown }).messages;
  return Array.isArray(messages) ? (messages as WireMessage[]) : [];
}

function rolesOf(messages: readonly WireMessage[]): unknown[] {
  return messages.map((message) => message.role);
}

test("a hook may append a steer after tool results, and the model sees it next round", async () => {
  const stub = await createStubProvider([
    { chunks: [{ id: "call-1", name: "echo", arguments: "{}" }] },
    { chunks: [{ content: "Done." }] },
  ]);
  try {
    const agent = new Agent({
      provider: provider(stub),
      tools: [TOOL],
      systemPrompt: "You are Roan.",
      cwd: process.cwd(),
      onBeforeRequest: (messages: ChatMessage[]) => {
        if (messages[messages.length - 1]?.role === "tool") {
          messages.push({ role: "user", content: "focus on the failing test" });
        }
      },
    });

    const answer = await agent.send("Start");
    assert.equal(answer, "Done.");
    assert.deepEqual(rolesOf(messagesOf(stub, 1)), ["system", "user", "assistant", "tool", "user"]);
    assert.equal(messagesOf(stub, 1).at(-1)?.content, "focus on the failing test");
  } finally {
    await stub.close();
  }
});

test("a hook that appends in front of the live question is refused, not sent", async () => {
  const stub = await createStubProvider([{ chunks: [{ content: "never reached" }] }]);
  try {
    const agent = new Agent({
      provider: provider(stub),
      tools: [TOOL],
      systemPrompt: "You are Roan.",
      cwd: process.cwd(),
      onBeforeRequest: (messages: ChatMessage[]) => {
        messages.push({ role: "user", content: "too early" });
      },
    });

    await assert.rejects(agent.send("Start"), /two user messages in a row/);
    assert.equal(stub.requests.length, 0, "an invalid shape must never reach the provider");
  } finally {
    await stub.close();
  }
});

test("a user message inside an open tool round is refused", async () => {
  const stub = await createStubProvider([{ chunks: [{ content: "never reached" }] }]);
  try {
    const agent = new Agent({
      provider: provider(stub),
      tools: [TOOL],
      systemPrompt: "You are Roan.",
      cwd: process.cwd(),
      history: [
        {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "call-9", type: "function", function: { name: "echo", arguments: "{}" } }],
        },
      ],
    });

    await assert.rejects(agent.send("Start"), /interrupts the tool round/);
    assert.equal(stub.requests.length, 0);
  } finally {
    await stub.close();
  }
});

test("replayed history with two owner messages in a row is folded into one", async () => {
  const stub = await createStubProvider([{ chunks: [{ content: "Folded." }] }]);
  try {
    const agent = new Agent({
      provider: provider(stub),
      tools: [TOOL],
      systemPrompt: "You are Roan.",
      cwd: process.cwd(),
      history: [
        { role: "user", content: "check the parser" },
        { role: "user", content: "and the failing test" },
        { role: "assistant", content: "On it." },
      ],
    });

    await agent.send("Start");
    const messages = messagesOf(stub, 0);
    assert.deepEqual(rolesOf(messages), ["system", "user", "assistant", "user"]);
    assert.equal(messages[1]?.content, "check the parser\n\nand the failing test");
  } finally {
    await stub.close();
  }
});
