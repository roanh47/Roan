/**
 * Effort, checked where it matters: in the request body each family sends.
 *
 * `effort.test.ts` states what a level means; this file proves the meaning
 * survives the adapter and the factory — including Gemini, where the knob has
 * to be merged into `generationConfig` instead of replacing it. `fetch` is
 * replaced for the duration of each test; nothing leaves the process.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { AdapterConfig, ChatAdapter, ChatOptions } from "./adapter.js";
import { adapterConfigFor, createAdapter } from "./factory.js";
import { createOpenAiCompatAdapter } from "./openai-compat.js";

const CFG: AdapterConfig = { baseUrl: "http://127.0.0.1:9/v1", apiKey: "", model: "test-model" };

const realFetch = globalThis.fetch;
let bodies: Record<string, unknown>[] = [];

beforeEach(() => {
  bodies = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const raw = typeof init?.body === "string" ? init.body : "";
    bodies.push(JSON.parse(raw) as Record<string, unknown>);
    // An empty SSE stream: the adapters only need a readable body here, and
    // every assertion below is about what went out, not what came back.
    return new Response("", { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Sends one message and returns the body the provider was handed. */
async function bodyAfter(
  adapter: ChatAdapter,
  opts: ChatOptions = {},
): Promise<Record<string, unknown>> {
  await adapter.send([{ role: "user", content: "hi" }], opts);
  const sent = bodies.at(-1);
  assert.ok(sent !== undefined, "the adapter sent no request");
  return sent;
}

describe("effort reaches the request body", () => {
  it("openai-compatible providers send reasoning_effort", async () => {
    const body = await bodyAfter(createAdapter("openai", { ...CFG, model: "gpt-5" }), {
      effort: "high",
    });
    assert.equal(body["reasoning_effort"], "high");
  });

  it("normal effort sends no reasoning knob at all", async () => {
    const explicit = await bodyAfter(createAdapter("openai", CFG), { effort: "normal" });
    assert.equal("reasoning_effort" in explicit, false);
    const omitted = await bodyAfter(createAdapter("openai", CFG));
    assert.equal("reasoning_effort" in omitted, false);
  });

  it("Anthropic sends a thinking budget", async () => {
    const low = await bodyAfter(createAdapter("anthropic", CFG), { effort: "low" });
    assert.deepEqual(low["thinking"], { type: "enabled", budget_tokens: 1024 });

    const high = await bodyAfter(createAdapter("anthropic", CFG), { effort: "high" });
    assert.deepEqual(high["thinking"], { type: "enabled", budget_tokens: 8192 });
  });

  it("Anthropic keeps max_tokens above the thinking budget", async () => {
    // The Messages API rejects a budget at or above the cap, so the adapter
    // lifts the default instead of sending a request that cannot succeed.
    const high = await bodyAfter(createAdapter("anthropic", CFG), { effort: "high" });
    assert.equal(high["max_tokens"], 8192 + 1024);

    const generous = await bodyAfter(createAdapter("anthropic", CFG), {
      effort: "high",
      maxTokens: 20_000,
    });
    assert.equal(generous["max_tokens"], 20_000, "a caller's larger cap must survive");
  });

  it("Google merges thinkingConfig into generationConfig and keeps the caps", async () => {
    const body = await bodyAfter(createAdapter("google", CFG), {
      effort: "low",
      maxTokens: 512,
      temperature: 0.2,
    });
    assert.deepEqual(body["generationConfig"], {
      maxOutputTokens: 512,
      temperature: 0.2,
      thinkingConfig: { thinkingBudget: 1024 },
    });
  });

  it("Google without effort still sends its caps and no thinkingConfig", async () => {
    const body = await bodyAfter(createAdapter("google", CFG), { maxTokens: 256 });
    assert.deepEqual(body["generationConfig"], { maxOutputTokens: 256 });
  });
});

describe("the provider id, not the adapter's own name, drives the spelling", () => {
  it("the factory hands the id to the adapter without mutating the caller's config", () => {
    const config = adapterConfigFor("xai", CFG);
    assert.equal(config.providerId, "xai");
    assert.equal(CFG.providerId, undefined, "the caller's object was mutated");
    assert.equal(config.baseUrl, CFG.baseUrl);
  });

  it("an unknown provider id suppresses the knob instead of guessing a family", async () => {
    // A config built by hand: the adapter is OpenAI-shaped, but the id names
    // nothing the catalog knows. Effort must stay off rather than be sent in
    // some family's dialect.
    const adapter = createOpenAiCompatAdapter({ ...CFG, providerId: "not-a-provider" });
    const body = await bodyAfter(adapter, { effort: "high" });
    assert.equal("reasoning_effort" in body, false);
  });
});
