import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { effortParams, isEffortLevel, EFFORT_LEVELS } from "./effort.js";
import type { EffortLevel } from "./effort.js";

describe("effort level guard", () => {
  it("accepts exactly the three levels", () => {
    for (const level of EFFORT_LEVELS) assert.equal(isEffortLevel(level), true);
    for (const value of ["minimal", "medium", "", "HIGH", null, 2, undefined]) {
      assert.equal(isEffortLevel(value), false, `${String(value)} was accepted`);
    }
  });
});

describe("effortParams: per provider family", () => {
  it("maps OpenAI-compatible providers onto reasoning_effort", () => {
    assert.deepEqual(effortParams("openai-compat", "some-local-model", "low"), {
      reasoning_effort: "low",
    });
    assert.deepEqual(effortParams("openai", "gpt-5", "high"), {
      reasoning_effort: "high",
    });
  });

  it("maps Anthropic onto a thinking budget", () => {
    assert.deepEqual(effortParams("anthropic", "claude-sonnet-4-5", "low"), {
      thinking: { type: "enabled", budget_tokens: 1024 },
    });
    assert.deepEqual(effortParams("anthropic", "claude-sonnet-4-5", "high"), {
      thinking: { type: "enabled", budget_tokens: 8192 },
    });
  });

  it("maps Google onto a thinking budget inside generationConfig", () => {
    assert.deepEqual(effortParams("google", "gemini-2.5-pro", "low"), {
      generationConfig: { thinkingConfig: { thinkingBudget: 1024 } },
    });
    assert.deepEqual(effortParams("google", "gemini-2.5-pro", "high"), {
      generationConfig: { thinkingConfig: { thinkingBudget: 8192 } },
    });
  });

  it("accepts a protocol name wherever a provider id is accepted", () => {
    assert.deepEqual(effortParams("openai-compatible", "unknown", "high"), {
      reasoning_effort: "high",
    });
    assert.deepEqual(effortParams("google-vertex", "gemini-2.5-pro", "low"), {
      generationConfig: { thinkingConfig: { thinkingBudget: 1024 } },
    });
  });
});

describe("effortParams: no parameter", () => {
  it("sends nothing for normal on every family", () => {
    for (const provider of ["openai", "anthropic", "google", "openai-compat"]) {
      assert.deepEqual(effortParams(provider, "any-model", "normal"), {}, provider);
    }
  });

  it("sends nothing for an unknown provider", () => {
    for (const level of ["low", "normal", "high"] as const) {
      assert.deepEqual(effortParams("no-such-provider", "whatever", level), {});
      assert.deepEqual(effortParams("", "whatever", level), {});
    }
  });

  it("sends nothing for a model the catalog marks non-reasoning", () => {
    assert.deepEqual(effortParams("openai", "gpt-4o", "high"), {});
    assert.deepEqual(effortParams("openai", "gpt-4.1", "low"), {});
    assert.deepEqual(effortParams("google", "gemini-2.5-pro", "normal"), {});
  });

  it("never throws on malformed arguments", () => {
    assert.deepEqual(effortParams("openai", "gpt-5", "extreme" as EffortLevel), {});
    assert.deepEqual(
      effortParams(null as unknown as string, "gpt-5", "high"),
      {},
    );
    assert.deepEqual(
      effortParams("openai", undefined as unknown as string, "high"),
      {},
    );
    assert.deepEqual(
      effortParams(42 as unknown as string, {} as unknown as string, "low"),
      {},
    );
  });

  it("returns a fresh object each call", () => {
    const first = effortParams("openai", "gpt-5", "low");
    first["reasoning_effort"] = "high";
    assert.deepEqual(effortParams("openai", "gpt-5", "low"), {
      reasoning_effort: "low",
    });
  });
});
