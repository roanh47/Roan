import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generationRegistry, runGeneration } from "./runtime.js";
import type { GenerationProvider } from "./types.js";

function provider(name: string, behaviour: "ok" | "fail" | "empty" | "url"): GenerationProvider {
  return {
    name,
    kind: "image",
    isAvailable: () => true,
    generate: async () => {
      if (behaviour === "fail") throw new Error("lane is down");
      if (behaviour === "empty") return { bytes: new Uint8Array(), mime: "image/png" };
      if (behaviour === "url") return { url: "https://cdn.example.test/image.png" };
      return { bytes: new Uint8Array([1, 2, 3]), mime: "image/png" };
    },
  };
}

describe("runGeneration", () => {
  it("falls through a failing and an empty lane to the first real result", async () => {
    generationRegistry.register(provider("runtime-fail", "fail"));
    generationRegistry.register(provider("runtime-empty", "empty"));
    generationRegistry.register(provider("runtime-ok", "ok"));

    // Autodetect walks registration order; the two broken fakes are first, so
    // reaching bytes proves the fall-through rather than a lucky first lane.
    const result = await runGeneration("image", { prompt: "x" }, {});
    assert.ok("bytes" in result);
    assert.equal(result.bytes.byteLength, 3);
  });

  it("passes a url result through untouched", async () => {
    generationRegistry.register(provider("runtime-url", "url"));
    const result = await runGeneration("image", { prompt: "x" }, { imageBackend: "runtime-url" });
    assert.deepEqual(result, { url: "https://cdn.example.test/image.png" });
  });

  it("names the provider when a pinned lane fails", async () => {
    generationRegistry.register(provider("runtime-a", "fail"));
    await assert.rejects(runGeneration("image", { prompt: "x" }, { backend: "runtime-a" }), /image generation failed — runtime-a: lane is down/);
  });

  it("refuses an empty prompt before asking any provider", async () => {
    await assert.rejects(runGeneration("image", { prompt: "   " }, { backend: "runtime-ok" }), /needs a prompt/);
  });

  it("reports the registry's reason when nothing is available for a kind", async () => {
    await assert.rejects(runGeneration("music", { prompt: "x" }, {}), /no music generation provider is available/);
  });
});
