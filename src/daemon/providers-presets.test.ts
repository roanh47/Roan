import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PRESETS, presetsFromCatalog } from "./providers.js";
import type { Catalog } from "../providers/types.js";

function catalog(providers: Record<string, unknown>): Catalog {
  return { generatedAt: "now", source: "test", providers } as unknown as Catalog;
}

const FULL = catalog({
  // An OpenAI-compatible provider with an api URL: becomes a preset.
  deepseek: { id: "deepseek", name: "DeepSeek", env: ["DEEPSEEK_API_KEY"], api: "https://api.deepseek.com", models: {} },
  // A provider whose registry entry has no api URL: not a preset from the catalogue.
  groq: { id: "groq", name: "Groq", env: ["GROQ_API_KEY"], models: {} },
  // A curator-unknown provider with an api URL: preset with the registry URL.
  berget: { id: "berget", name: "Berget", env: ["BERGET_API_KEY"], api: "https://api.berget.ai/v1", models: {} },
});

describe("presetsFromCatalog", () => {
  it("includes every catalog provider that exposes an api URL", () => {
    const presets = presetsFromCatalog(FULL);
    const ids = presets.map((preset) => preset.id);
    assert.ok(ids.includes("deepseek"));
    assert.ok(ids.includes("berget"));
    // Not in the fixture and not curated: nothing invents it.
    assert.ok(!ids.includes("entrim"));
  });

  it("a curated entry wins the base URL and the key hint on a clash", () => {
    const deepseek = presetsFromCatalog(FULL).find((preset) => preset.id === "deepseek");
    assert.ok(deepseek !== undefined);
    // The curated ten carry the compatibility path, not the registry root.
    assert.equal(deepseek.baseUrl, "https://api.deepseek.com/v1");
    assert.equal(deepseek.keyHint, "sk-…");
  });

  it("an unknown provider takes the registry URL and its env var as the hint", () => {
    const berget = presetsFromCatalog(FULL).find((preset) => preset.id === "berget");
    assert.ok(berget !== undefined);
    assert.equal(berget.baseUrl, "https://api.berget.ai/v1");
    assert.equal(berget.keyHint, "BERGET_API_KEY");
  });

  it("providers without a registry URL still come from the curated list", () => {
    const presets = presetsFromCatalog(FULL);
    for (const preset of PRESETS) {
      assert.ok(
        presets.some((item) => item.id === preset.id),
        `${preset.id} is missing`,
      );
    }
  });

  it("a registry entry without an api URL is filled by the curated list", () => {
    const groq = presetsFromCatalog(FULL).find((preset) => preset.id === "groq");
    assert.ok(groq !== undefined);
    assert.equal(groq.baseUrl, "https://api.groq.com/openai/v1");
  });

  it("an empty catalogue still yields the curated fallback", () => {
    const presets = presetsFromCatalog(catalog({}));
    assert.equal(presets.length, PRESETS.length);
  });

  it("the list is sorted by label, case-insensitively", () => {
    const labels = presetsFromCatalog(FULL).map((preset) => preset.label.toLowerCase());
    const sorted = [...labels].sort((a, b) => a.localeCompare(b));
    assert.deepEqual(labels, sorted);
  });
});
