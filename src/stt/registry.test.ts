import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createSttRegistry } from "./bundled.js";
import { describeStt, SttRegistry } from "./registry.js";
import type { SpeechAudio, SttConfig, SttProvider } from "./provider.js";

const AUDIO: SpeechAudio = { mime: "audio/wav", bytes: new Uint8Array([1]) };
const CONFIG: SttConfig = { baseUrl: "http://127.0.0.1:8080/v1", model: "whisper-1" };

function provider(name: string, available: boolean): SttProvider {
  return {
    name,
    isAvailable: () => available,
    transcribe: async () => `${name} hoorde dit`,
  };
}

describe("the stt registry", () => {
  it("registers, gets and lists in registration order", () => {
    const registry = new SttRegistry();
    registry.register(provider("eerste", true));
    registry.register(provider("tweede", true));
    assert.deepEqual(
      registry.list().map((entry) => entry.name),
      ["eerste", "tweede"],
    );
    assert.equal(registry.get("tweede")?.name, "tweede");
    assert.equal(registry.get("derde"), undefined);
  });

  it("replaces a same-name provider instead of doubling it", () => {
    const registry = new SttRegistry();
    registry.register(provider("lokaal", true));
    registry.register(provider("lokaal", false));
    assert.equal(registry.list().length, 1);
    assert.equal(registry.get("lokaal")?.isAvailable(CONFIG), false);
  });

  it("refuses a nameless provider and one without transcribe()", () => {
    const registry = new SttRegistry();
    assert.throws(() => registry.register(provider("  ", true)), /stt provider needs a name/);
    const broken = { name: "kapot", isAvailable: () => true } as unknown as SttProvider;
    assert.throws(() => registry.register(broken), /stt provider "kapot" has no transcribe\(\)/);
  });

  it("autodetects the first available provider and skips the unconfigured", () => {
    const registry = new SttRegistry();
    registry.register(provider("leeg", false));
    registry.register(provider("lokaal", true));
    registry.register(provider("ook", true));
    const picked = registry.candidates(CONFIG);
    assert.ok(!("error" in picked));
    assert.deepEqual(
      picked.providers.map((entry) => entry.name),
      ["lokaal", "ook"],
    );
  });

  it("says so out loud when nothing is available", () => {
    const registry = new SttRegistry();
    registry.register(provider("leeg", false));
    const picked = registry.candidates({});
    assert.ok("error" in picked);
    assert.match(picked.error, /no speech-to-text provider is available/);
    assert.equal(describeStt({}, registry), picked.error);
  });

  it("a pin is strict: an unknown name is an error, never a silent swap", () => {
    const registry = new SttRegistry();
    registry.register(provider("lokaal", true));
    const unknown = registry.candidates({ ...CONFIG, backend: "bestaat-niet" });
    assert.ok("error" in unknown);
    assert.match(unknown.error, /stt\.backend is "bestaat-niet", but no speech-to-text provider with that name/);

    const offline = new SttRegistry();
    offline.register(provider("offline", false));
    const unpicked = offline.candidates({ backend: "offline" });
    assert.ok("error" in unpicked);
    assert.match(unpicked.error, /stt\.backend is "offline", but that provider is not configured/);
  });

  it("a pin narrows the list to exactly that provider", () => {
    const registry = new SttRegistry();
    registry.register(provider("lokaal", true));
    registry.register(provider("ook", true));
    const pinned = registry.candidates({ ...CONFIG, backend: "ook" });
    assert.ok(!("error" in pinned));
    assert.deepEqual(
      pinned.providers.map((entry) => entry.name),
      ["ook"],
    );
    assert.equal(describeStt({ ...CONFIG, backend: "ook" }, registry), "ook");
  });

  it("the bundled registry ships the local openai-compatible provider", () => {
    const registry = createSttRegistry();
    assert.deepEqual(
      registry.list().map((entry) => entry.name),
      ["openai-compat"],
    );
    const provider = registry.get("openai-compat");
    assert.ok(provider !== undefined);
    assert.equal(provider.isAvailable(CONFIG), true);
    // No url or no model: not available, and the registry says what is missing.
    assert.equal(provider.isAvailable({ baseUrl: CONFIG.baseUrl }), false);
    assert.equal(provider.isAvailable({ model: CONFIG.model }), false);
    const picked = registry.candidates({});
    assert.ok("error" in picked);
    assert.match(picked.error, /missing url or model|no speech-to-text provider/);
  });

  it("transcribes through the picked provider", async () => {
    const registry = new SttRegistry();
    registry.register(provider("lokaal", true));
    const picked = registry.candidates(CONFIG);
    assert.ok(!("error" in picked));
    const first = picked.providers[0];
    assert.ok(first !== undefined);
    assert.equal(await first.transcribe(AUDIO, CONFIG), "lokaal hoorde dit");
  });
});
