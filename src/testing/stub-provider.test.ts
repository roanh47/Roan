import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createStubProvider,
  type ScriptedResponse,
  type StubUsage,
} from "./stub-provider.js";

/**
 * This test lives in src/testing/ (and not in tests/) because tsconfig only
 * includes "src" and `npm test` runs the compiled dist/**\/*.test.js; a test
 * outside rootDir would therefore neither typecheck nor run.
 *
 * The server listens on 127.0.0.1:0 (a port picked by the OS) and is closed
 * again in every test, so nothing is left hanging and no traffic goes out.
 */

/** Key order here must mirror the server's; the text is compared literally. */
function chunkFrame(id: string, delta: Record<string, unknown>, finish: string | null): string {
  const payload = {
    id,
    object: "chat.completion.chunk",
    created: 0,
    model: "stub-model",
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/** Frames a chunk that carries only `usage` (no choices). */
function usageFrame(id: string, usage: StubUsage): string {
  const payload = {
    id,
    object: "chat.completion.chunk",
    created: 0,
    model: "stub-model",
    choices: [],
    usage,
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/** `created` is a clock value; zero it so the rest can be compared literally. */
function normalizeCreated(body: string): string {
  return body.replace(/"created":\d+/g, '"created":0');
}

/** Splits the SSE body into its `data:` payloads and checks the framing. */
function ssePayloads(body: string): string[] {
  const blocks = body.split("\n\n");
  assert.equal(blocks.at(-1), "", "SSE body does not end on an empty line");
  return blocks.slice(0, -1).map((block) => {
    assert.ok(block.startsWith("data: "), `SSE block without a "data: " prefix: ${block}`);
    return block.slice("data: ".length);
  });
}

/** Parses all frames except `[DONE]` and checks that `[DONE]` is the last one. */
function parseEvents(body: string): Record<string, unknown>[] {
  const payloads = ssePayloads(body);
  assert.equal(payloads.at(-1), "[DONE]", "stream does not end on data: [DONE]");
  return payloads.slice(0, -1).map((payload) => {
    const parsed: unknown = JSON.parse(payload);
    assert.ok(
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed),
      `frame is not an object: ${payload}`,
    );
    return parsed as Record<string, unknown>;
  });
}

/** Glues all `choices[0].delta.content` pieces together. */
function textOf(events: readonly Record<string, unknown>[]): string {
  let text = "";
  for (const event of events) {
    const choices = event.choices;
    if (!Array.isArray(choices) || choices.length === 0) continue;
    const first: unknown = choices[0];
    if (typeof first !== "object" || first === null) continue;
    const delta = (first as Record<string, unknown>).delta;
    if (typeof delta !== "object" || delta === null) continue;
    const content = (delta as Record<string, unknown>).content;
    if (typeof content === "string") text += content;
  }
  return text;
}

/** Pulls the `usage` out of the frames, or `null` if no frame carries one. */
function usageOf(events: readonly Record<string, unknown>[]): unknown {
  for (const event of events) {
    if (event.usage !== undefined && event.usage !== null) return event.usage;
  }
  return null;
}

const USAGE: StubUsage = { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 };

const CHAT_BODY = {
  model: "stub-model",
  messages: [{ role: "user", content: "zeg hallo" }],
  stream: true,
};

describe("stub provider", () => {
  it("streams scripted responses, logs requests and passes 429 through", async () => {
    const script: ScriptedResponse[] = [
      {
        chunks: [{ content: "Hello" }, { content: ", world" }, { usage: USAGE }],
      },
      {
        chunks: [
          { id: "call_abc", name: "get_weather", arguments: '{"city":' },
          { arguments: '"Ha"}' },
        ],
      },
      {
        error: { status: 429, body: '{"error":{"message":"rate limited"}}' },
      },
    ];

    const stub = await createStubProvider(script);
    try {
      // First call: text + usage.
      const first = await fetch(`${stub.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(CHAT_BODY),
      });
      assert.equal(first.status, 200);
      assert.match(first.headers.get("content-type") ?? "", /text\/event-stream/);
      const firstText = normalizeCreated(await first.text());

      const expectedFirst =
        chunkFrame("chatcmpl-stub-1", { content: "Hello" }, null) +
        chunkFrame("chatcmpl-stub-1", { content: ", world" }, null) +
        chunkFrame("chatcmpl-stub-1", {}, "stop") +
        usageFrame("chatcmpl-stub-1", USAGE) +
        "data: [DONE]\n\n";
      assert.equal(firstText, expectedFirst);

      const firstEvents = parseEvents(firstText);
      assert.equal(textOf(firstEvents), "Hello, world");
      assert.deepEqual(usageOf(firstEvents), USAGE);

      // Second call: tool-call deltas are glued together.
      const toolBody = {
        model: "stub-model",
        messages: [{ role: "user", content: "weer?" }],
        stream: true,
        tools: [
          {
            type: "function",
            function: { name: "get_weather", parameters: { type: "object" } },
          },
        ],
        tool_choice: "auto",
      };
      const second = await fetch(`${stub.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(toolBody),
      });
      assert.equal(second.status, 200);
      const secondText = normalizeCreated(await second.text());

      const expectedSecond =
        chunkFrame(
          "chatcmpl-stub-2",
          {
            tool_calls: [
              { index: 0, id: "call_abc", type: "function", function: { name: "get_weather", arguments: '{"city":' } },
            ],
          },
          null,
        ) +
        chunkFrame(
          "chatcmpl-stub-2",
          { tool_calls: [{ index: 0, type: "function", function: { name: "", arguments: '"Ha"}' } }] },
          null,
        ) +
        chunkFrame("chatcmpl-stub-2", {}, "tool_calls") +
        "data: [DONE]\n\n";
      assert.equal(secondText, expectedSecond);

      const secondEvents = parseEvents(secondText);
      assert.equal(textOf(secondEvents), "");
      assert.equal(usageOf(secondEvents), null);
      const calls = secondEvents.flatMap((event) => {
        const choices = event.choices;
        if (!Array.isArray(choices) || choices.length === 0) return [];
        const delta = (choices[0] as Record<string, unknown>).delta as Record<string, unknown>;
        const list = delta.tool_calls;
        return Array.isArray(list) ? list : [];
      }) as Array<Record<string, unknown>>;
      const assembledName = calls.map((call) => (call.function as Record<string, unknown>).name).join("");
      const assembledArgs = calls.map((call) => (call.function as Record<string, unknown>).arguments).join("");
      assert.equal(assembledName, "get_weather");
      assert.equal(assembledArgs, '{"city":"Ha"}');
      assert.equal(calls[0]?.id, "call_abc");

      // Third call: the scripted 429 must show up as the status.
      const third = await fetch(`${stub.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(CHAT_BODY),
      });
      assert.equal(third.status, 429);
      assert.equal(await third.text(), '{"error":{"message":"rate limited"}}');

      // Fourth call: the queue is empty, so a minimal text completion.
      const fourth = await fetch(`${stub.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(CHAT_BODY),
      });
      assert.equal(fourth.status, 200);
      const fourthText = await fourth.text();
      assert.ok(fourthText.endsWith("data: [DONE]\n\n"), "fallback does not end with [DONE]");
      assert.match(textOf(parseEvents(fourthText)), /no scripted response left/);

      // Requests were recorded in order, with a parsed JSON body.
      assert.equal(stub.requests.length, 4);
      const urls = stub.requests.map((request) => `${request.method} ${request.url}`);
      assert.deepEqual(urls, [
        "POST /v1/chat/completions",
        "POST /v1/chat/completions",
        "POST /v1/chat/completions",
        "POST /v1/chat/completions",
      ]);
      assert.deepEqual(stub.requests[0]?.body, CHAT_BODY);
      assert.deepEqual(stub.requests[1]?.body, toolBody);
      assert.deepEqual(stub.requests[2]?.body, CHAT_BODY);
    } finally {
      await stub.close();
    }
  });

  it("rejects unknown routes and other methods, and closes the port", async () => {
    const stub = await createStubProvider([{ chunks: [{ content: "later" }] }]);
    const { baseUrl, port, requests } = stub;

    try {
      const wrongPath = await fetch(`${baseUrl}/models`);
      assert.equal(wrongPath.status, 404);
      assert.match(await wrongPath.text(), /no route/);

      const wrongMethod = await fetch(`${baseUrl}/chat/completions`);
      assert.equal(wrongMethod.status, 405);
      assert.equal(wrongMethod.headers.get("allow"), "POST");

      // Only the valid completions POST may end up in the log.
      assert.equal(requests.length, 0);

      stub.enqueue({ chunks: [{ content: "expliciet" }] });
      const ok = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(CHAT_BODY),
      });
      assert.equal(ok.status, 200);
      // The first scripted response ("later") wins over the later enqueued one.
      assert.equal(textOf(parseEvents(await ok.text())), "later");
    } finally {
      await stub.close();
      await stub.close();
    }

    assert.throws(() => {
      stub.enqueue({ chunks: [{ content: "te laat" }] });
    }, /enqueue after close/);

    await assert.rejects(fetch(`http://127.0.0.1:${String(port)}/v1/chat/completions`, {
      method: "POST",
      body: "{}",
    }));
  });
});
