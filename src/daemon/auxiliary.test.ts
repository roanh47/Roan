import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NO_AUXILIARY,
  describeImagePrompt,
  parseAuxiliary,
  resolveAux,
  withAuxModel,
  withImageDescription,
} from "./auxiliary.js";

const main = { baseUrl: "https://main.example/v1", apiKey: "main-key", model: "text-only", providerId: "deepseek" };
const accounts = [{ id: "other", baseUrl: "https://other.example/v1", apiKey: "other-key" }];

describe("auxiliary models", () => {
  it("reads a config value and treats anything malformed as an empty slot", () => {
    assert.deepEqual(parseAuxiliary(undefined), NO_AUXILIARY);
    assert.deepEqual(parseAuxiliary({ vision: { model: " see-1 " }, background: { model: "" } }), {
      vision: { provider: "", model: "see-1" },
      background: null,
    });
    assert.deepEqual(parseAuxiliary({ vision: "see-1", background: [1] }), NO_AUXILIARY);
  });

  it("changes one slot and leaves the other", () => {
    const set = withAuxModel(NO_AUXILIARY, "vision", "see-1", "other");
    assert.deepEqual(set, { vision: { provider: "other", model: "see-1" }, background: null });
    assert.deepEqual(withAuxModel(set, "vision", "  "), NO_AUXILIARY);
  });

  it("uses the main provider when the slot names none, or names the one in use", () => {
    const same = withAuxModel(NO_AUXILIARY, "vision", "see-1");
    assert.deepEqual(resolveAux(same, "vision", main, accounts), { ...main, model: "see-1" });
    const named = withAuxModel(NO_AUXILIARY, "vision", "see-1", "deepseek");
    assert.deepEqual(resolveAux(named, "vision", main, accounts), { ...main, model: "see-1" });
  });

  it("reaches another saved provider with that provider's own key", () => {
    const other = withAuxModel(NO_AUXILIARY, "background", "small-1", "other");
    assert.deepEqual(resolveAux(other, "background", main, accounts), {
      baseUrl: "https://other.example/v1",
      apiKey: "other-key",
      model: "small-1",
      providerId: "other",
    });
  });

  it("falls back to the main model for an empty slot or an unknown provider", () => {
    assert.equal(resolveAux(NO_AUXILIARY, "vision", main, accounts), null);
    const gone = withAuxModel(NO_AUXILIARY, "vision", "see-1", "not-saved");
    assert.equal(resolveAux(gone, "vision", main, accounts), null);
  });

  it("asks for a description, not an answer, and hands it on as text", () => {
    assert.match(describeImagePrompt("what does the error say?"), /what does the error say\?/);
    assert.match(describeImagePrompt("  "), /the image came alone/);
    const text = withImageDescription("what is this?", " A red button. ", "see-1");
    assert.match(text, /^what is this\?/);
    assert.match(text, /see-1 looked at it/);
    assert.match(text, /A red button\.$/);
  });
});
