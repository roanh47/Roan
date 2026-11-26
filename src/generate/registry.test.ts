import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeGeneration, GenerationRegistry } from "./registry.js";
import type { GenerationKind, GenerationProvider } from "./types.js";

/** A provider that claims availability and returns one byte. */
function fake(name: string, kind: GenerationKind, available = true): GenerationProvider {
  return {
    name,
    displayName: `${name} display`,
    kind,
    isAvailable: () => available,
    generate: async () => ({ bytes: new Uint8Array([1]), mime: "image/png" }),
  };
}

function names(registry: GenerationRegistry, kind: GenerationKind, config = {}): readonly string[] | string {
  const picked = registry.candidates(kind, config);
  return "error" in picked ? picked.error : picked.providers.map((provider) => provider.name);
}

describe("generation registry", () => {
  it("autodetects the first available provider per kind and skips unavailable ones", () => {
    const registry = new GenerationRegistry();
    registry.register(fake("image-off", "image", false));
    registry.register(fake("image-a", "image"));
    registry.register(fake("image-b", "image"));
    registry.register(fake("video-a", "video"));
    registry.register(fake("music-a", "music"));

    assert.deepEqual(names(registry, "image"), ["image-a", "image-b"]);
    assert.deepEqual(names(registry, "video"), ["video-a"]);
    assert.deepEqual(names(registry, "music"), ["music-a"]);
  });

  it("keeps kinds apart: a provider only answers for its own kind", () => {
    const registry = new GenerationRegistry();
    registry.register(fake("image-a", "image"));

    const picked = registry.candidates("music", {});
    assert.ok("error" in picked);
    assert.match(picked.error, /no music generation provider is available/);
    assert.equal(registry.get("image-a")?.kind, "image");
  });

  it("honours a strict per-kind pin, which wins over the shared one", () => {
    const registry = new GenerationRegistry();
    registry.register(fake("image-a", "image"));
    registry.register(fake("image-b", "image"));

    assert.deepEqual(names(registry, "image", { backend: "image-a" }), ["image-a"]);
    assert.deepEqual(names(registry, "image", { backend: "image-a", imageBackend: "image-b" }), ["image-b"]);
  });

  it("reports a wrong pin as an honest error instead of swapping providers", () => {
    const registry = new GenerationRegistry();
    registry.register(fake("image-a", "image"));
    registry.register(fake("video-a", "video"));
    registry.register(fake("image-off", "image", false));

    const unknown = names(registry, "image", { imageBackend: "nope" });
    assert.equal(typeof unknown, "string");
    assert.match(String(unknown), /generate\.imageBackend is "nope", but no provider with that name is installed/);

    const wrongKind = names(registry, "image", { imageBackend: "video-a" });
    assert.match(String(wrongKind), /generates video, not image/);

    const unconfigured = names(registry, "image", { backend: "image-off" });
    assert.match(String(unconfigured), /is not configured \(missing url or key\)/);
  });

  it("refuses registrations that cannot work instead of failing later", () => {
    const registry = new GenerationRegistry();
    assert.throws(() => registry.register({ ...fake("  ", "image") }), /needs a name/);
    assert.throws(
      () => registry.register({ ...fake("odd", "image"), kind: "hologram" as GenerationKind }),
      /unknown kind "hologram"/,
    );
    assert.throws(
      () => registry.register({ ...fake("broken", "image"), generate: undefined as unknown as GenerationProvider["generate"] }),
      /has no generate\(\)/,
    );
  });

  it("replaces a same-name registration, later one wins", () => {
    const registry = new GenerationRegistry();
    registry.register(fake("image-a", "image"));
    registry.register(fake("image-a", "video"));

    assert.equal(registry.list().length, 1);
    assert.equal(registry.get("image-a")?.kind, "video");
  });

  it("describes what would run, or the reason nothing would", () => {
    const registry = new GenerationRegistry();
    registry.register(fake("image-a", "image", false));

    assert.match(describeGeneration({}, registry, "image"), /no image generation provider is available/);

    registry.register(fake("image-b", "image"));
    assert.equal(describeGeneration({}, registry, "image"), "image-b display");
    assert.equal(describeGeneration({ imageBackend: "image-b" }, registry, "image"), "image-b display");
  });
});
