import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createStubProvider,
  type ScriptedResponse,
  type StubUsage,
} from "./stub-provider.js";

/**
 * Deze test staat in src/testing/ (en niet in tests/) omdat tsconfig alleen
 * "src" include't en `npm test` de gecompileerde dist/**\/*.test.js draait; een
 * test buiten rootDir zou dus niet typechecken en niet draaien.
 *
 * De server luistert op 127.0.0.1:0 (een door de OS gekozen poort) en wordt in
 * elke test weer gesloten, dus er blijft niets hangen en er gaat geen verkeer
 * naar buiten.
 */

/** Sleutelvolgorde hier moet die van de server spiegelen; tekst wordt letterlijk vergeleken. */
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

/** Framet een chunk die alleen `usage` draagt (geen choices). */
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

/** `created` is een klokwaarde; nullen hem zodat de rest letterlijk te vergelijken is. */
function normalizeCreated(body: string): string {
  return body.replace(/"created":\d+/g, '"created":0');
}

/** Splitst de SSE-body in zijn `data:`-payloads en controleert de framing. */
function ssePayloads(body: string): string[] {
  const blocks = body.split("\n\n");
  assert.equal(blocks.at(-1), "", "SSE-body eindigt niet op een lege regel");
  return blocks.slice(0, -1).map((block) => {
    assert.ok(block.startsWith("data: "), `SSE-blok zonder "data: "-prefix: ${block}`);
    return block.slice("data: ".length);
  });
}

/** Parset alle frames behalve `[DONE]` en controleert dat `[DONE]` de laatste is. */
function parseEvents(body: string): Record<string, unknown>[] {
  const payloads = ssePayloads(body);
  assert.equal(payloads.at(-1), "[DONE]", "stream eindigt niet op data: [DONE]");
  return payloads.slice(0, -1).map((payload) => {
    const parsed: unknown = JSON.parse(payload);
    assert.ok(
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed),
      `frame is geen object: ${payload}`,
    );
    return parsed as Record<string, unknown>;
  });
}

/** Plakt alle `choices[0].delta.content`-stukken aan elkaar. */
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

/** Haalt de `usage` uit de frames, of `null` als geen frame die meedraagt. */
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
  it("streamt gescripte antwoorden, logt verzoeken en geeft 429 door", async () => {
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
      // Eerste aanroep: tekst + usage.
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

      // Tweede aanroep: tool-call delta's worden aan elkaar geplakt.
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

      // Derde aanroep: de gescripte 429 moet zichtbaar zijn als status.
      const third = await fetch(`${stub.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(CHAT_BODY),
      });
      assert.equal(third.status, 429);
      assert.equal(await third.text(), '{"error":{"message":"rate limited"}}');

      // Vierde aanroep: queue is leeg, dus een minimale tekstcompletion.
      const fourth = await fetch(`${stub.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(CHAT_BODY),
      });
      assert.equal(fourth.status, 200);
      const fourthText = await fourth.text();
      assert.ok(fourthText.endsWith("data: [DONE]\n\n"), "fallback sluit niet af met [DONE]");
      assert.match(textOf(parseEvents(fourthText)), /no scripted response left/);

      // Verzoeken zijn in volgorde vastgelegd, met geparsed JSON-body.
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

  it("weigert onbekende routes en andere methodes, en sluit de poort", async () => {
    const stub = await createStubProvider([{ chunks: [{ content: "later" }] }]);
    const { baseUrl, port, requests } = stub;

    try {
      const wrongPath = await fetch(`${baseUrl}/models`);
      assert.equal(wrongPath.status, 404);
      assert.match(await wrongPath.text(), /no route/);

      const wrongMethod = await fetch(`${baseUrl}/chat/completions`);
      assert.equal(wrongMethod.status, 405);
      assert.equal(wrongMethod.headers.get("allow"), "POST");

      // Alleen de geldige completions-POST mag in het logboek staan.
      assert.equal(requests.length, 0);

      stub.enqueue({ chunks: [{ content: "expliciet" }] });
      const ok = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(CHAT_BODY),
      });
      assert.equal(ok.status, 200);
      // Eerste scripted respons ("later") gaat voor de later ge-enqueuede.
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
