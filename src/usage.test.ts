import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeUsage, sessionTotal, usageLine } from "./usage.js";
import type { TokenUsage } from "./usage.js";

describe("normalizeUsage: provider shapes", () => {
  it("reads OpenAI prompt/completion tokens", () => {
    assert.deepEqual(
      normalizeUsage({ prompt_tokens: 1234, completion_tokens: 567 }),
      { input: 1234, output: 567 },
    );
  });

  it("reads Anthropic input/output tokens", () => {
    assert.deepEqual(
      normalizeUsage({ input_tokens: 1234, output_tokens: 567 }),
      { input: 1234, output: 567 },
    );
  });

  it("reads Google promptTokenCount/candidatesTokenCount", () => {
    assert.deepEqual(
      normalizeUsage({ promptTokenCount: 1234, candidatesTokenCount: 567 }),
      { input: 1234, output: 567 },
    );
  });

  it("unwraps the common usage containers", () => {
    assert.deepEqual(
      normalizeUsage({ usage: { prompt_tokens: 10, completion_tokens: 20 } }),
      { input: 10, output: 20 },
    );
    assert.deepEqual(
      normalizeUsage({ usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 40 } }),
      { input: 30, output: 40 },
    );
    assert.deepEqual(
      normalizeUsage({ tokenUsage: { input_tokens: 50, output_tokens: 60 } }),
      { input: 50, output: 60 },
    );
  });

  it("treats a missing side of a recognised pair as zero", () => {
    assert.deepEqual(normalizeUsage({ prompt_tokens: 12 }), { input: 12, output: 0 });
    assert.deepEqual(normalizeUsage({ completion_tokens: 34 }), { input: 0, output: 34 });
    assert.deepEqual(normalizeUsage({ input_tokens: 8 }), { input: 8, output: 0 });
    assert.deepEqual(normalizeUsage({ candidatesTokenCount: 9 }), { input: 0, output: 9 });
  });
});

describe("normalizeUsage: missing usage", () => {
  it("returns null when no counts are present", () => {
    for (const raw of [null, undefined, {}, { total_tokens: 99 }, { choices: [] }, "usage", 7, []]) {
      assert.equal(normalizeUsage(raw), null, `${JSON.stringify(raw)} did not yield null`);
    }
  });

  it("ignores counts that are not finite non-negative numbers", () => {
    assert.deepEqual(normalizeUsage({ prompt_tokens: -1, completion_tokens: 5 }), {
      input: 0,
      output: 5,
    });
    assert.equal(
      normalizeUsage({ prompt_tokens: Number.NaN, completion_tokens: Number.POSITIVE_INFINITY }),
      null,
    );
    assert.equal(normalizeUsage({ prompt_tokens: "12", completion_tokens: "3" }), null);
  });
});

describe("usageLine", () => {
  it("formats counts with thousands separators", () => {
    assert.equal(usageLine({ input: 1234, output: 567 }), "1,234 in · 567 out");
    assert.equal(usageLine({ input: 0, output: 0 }), "0 in · 0 out");
    assert.equal(usageLine({ input: 1_234_567, output: 999 }), "1,234,567 in · 999 out");
  });

  it("renders a null usage instead of an empty line", () => {
    assert.equal(usageLine(null), "no usage");
  });

  it("appends the cost at a per-million price", () => {
    // (1234 * 2 + 567 * 10) / 1e6 = 0.008138 -> 0.0081
    assert.equal(
      usageLine({ input: 1234, output: 567 }, { input: 2, output: 10 }),
      "1,234 in · 567 out · $0.0081",
    );
    // (1234 * 3.3 + 567 * 16.5) / 1e6 = 0.0134277 -> 0.0134
    assert.equal(
      usageLine({ input: 1234, output: 567 }, { input: 3.3, output: 16.5 }),
      "1,234 in · 567 out · $0.0134",
    );
  });

  it("rounds the cost to four decimals", () => {
    // 1234 in at $1/M = 0.001234 -> 0.0012
    assert.equal(
      usageLine({ input: 1234, output: 0 }, { input: 1, output: 0 }),
      "1,234 in · 0 out · $0.0012",
    );
    // 1290 in at $1/M = 0.00129 -> 0.0013
    assert.equal(
      usageLine({ input: 1290, output: 0 }, { input: 1, output: 0 }),
      "1,290 in · 0 out · $0.0013",
    );
    // 1 token at $5/M = 0.000005, below the displayed precision
    assert.equal(
      usageLine({ input: 1, output: 0 }, { input: 5, output: 0 }),
      "1 in · 0 out · $0.0000",
    );
  });

  it("guards against junk prices and counts", () => {
    assert.equal(
      usageLine(
        { input: 1000, output: 500 },
        { input: Number.NaN, output: -3 },
      ),
      "1,000 in · 500 out · $0.0000",
    );
    assert.equal(
      usageLine({ input: -5, output: Number.POSITIVE_INFINITY }),
      "0 in · 0 out",
    );
  });
});

describe("sessionTotal", () => {
  it("sums every usage in the session", () => {
    const usages: Array<TokenUsage | null | undefined> = [
      { input: 100, output: 20 },
      null,
      { input: 250, output: 30 },
      undefined,
      { input: 1, output: 2 },
    ];
    assert.deepEqual(sessionTotal(usages), { input: 351, output: 52 });
  });

  it("totals zero for an empty or all-missing session", () => {
    assert.deepEqual(sessionTotal([]), { input: 0, output: 0 });
    assert.deepEqual(sessionTotal([null, undefined]), { input: 0, output: 0 });
  });

  it("accepts any iterable, not just arrays", () => {
    const set = new Set<TokenUsage>([
      { input: 5, output: 6 },
      { input: 7, output: 8 },
    ]);
    assert.deepEqual(sessionTotal(set), { input: 12, output: 14 });
  });

  it("ignores non-finite counts", () => {
    assert.deepEqual(
      sessionTotal([
        { input: Number.NaN, output: 10 },
        { input: 4, output: Number.POSITIVE_INFINITY },
        { input: -3, output: 1 },
      ]),
      { input: 4, output: 11 },
    );
  });
});
