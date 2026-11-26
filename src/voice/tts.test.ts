import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SpeechAudio } from "../stt/provider.js";
import { MAX_SPEECH_BYTES, MAX_SPEECH_CHARS, speakWith } from "./tts.js";
import type { TtsConfig, TtsProvider } from "./tts.js";
import { createTtsRegistry } from "./bundled.js";
import { describeTts, TtsRegistry } from "./registry.js";

const CONFIG: TtsConfig = { baseUrl: "http://127.0.0.1:9/v1", model: "tts-1" };
const AUDIO: SpeechAudio = { mime: "audio/mpeg", bytes: new Uint8Array([1, 2, 3]) };

function stub(
  answer: SpeechAudio | (() => Promise<SpeechAudio>),
  available = true,
): TtsProvider & { texts: string[] } {
  const texts: string[] = [];
  return {
    name: "stub",
    texts,
    isAvailable: () => available,
    async speak(text: string): Promise<SpeechAudio> {
      texts.push(text);
      return typeof answer === "function" ? answer() : answer;
    },
  };
}

describe("speakWith", () => {
  it("returns the provider's audio and hands it the trimmed text", async () => {
    const provider = stub(AUDIO);
    const audio = await speakWith(provider, "  hallo wereld \n", CONFIG);
    assert.deepEqual(audio, AUDIO);
    assert.deepEqual(provider.texts, ["hallo wereld"]);
  });

  it("refuses an unconfigured provider before any text is sent", async () => {
    const provider = stub(AUDIO, false);
    await assert.rejects(speakWith(provider, "hoi", {}), {
      message: /provider "stub" is not configured/,
    });
    assert.equal(provider.texts.length, 0);
  });

  it("refuses an empty reply", async () => {
    const provider = stub(AUDIO);
    await assert.rejects(speakWith(provider, "   \n", CONFIG), /nothing to say/);
    assert.equal(provider.texts.length, 0);
  });

  it("accepts exactly the character cap and refuses one more", async () => {
    const provider = stub(AUDIO);
    await speakWith(provider, "a".repeat(MAX_SPEECH_CHARS), CONFIG);
    await assert.rejects(
      speakWith(provider, "a".repeat(MAX_SPEECH_CHARS + 1), CONFIG),
      /5000|4097 characters; the limit is 4096|the reply is 4097 characters/,
    );
  });

  it("refuses an answer that is not audio, is empty, or is over the byte cap", async () => {
    await assert.rejects(
      speakWith(stub({ mime: "application/json", bytes: new Uint8Array([1]) }), "hoi", CONFIG),
      /returned no audio \(mime "application\/json"\)/,
    );
    await assert.rejects(
      speakWith(stub({ mime: "audio/mpeg", bytes: new Uint8Array(0) }), "hoi", CONFIG),
      /returned 0 bytes of audio/,
    );
    await assert.rejects(
      speakWith(stub({ mime: "audio/mpeg", bytes: new Uint8Array(MAX_SPEECH_BYTES + 1) }), "hoi", CONFIG),
      /returned 25\.0 MB; the limit is 25\.0 MB/,
    );
  });

  it("passes a provider's own error through untouched", async () => {
    const provider = stub(async () => {
      throw new Error("speech output: cannot reach http://127.0.0.1:9/v1/audio/speech");
    });
    await assert.rejects(speakWith(provider, "hoi", CONFIG), /cannot reach/);
  });
});

describe("the tts registry", () => {
  function provider(name: string, available: boolean): TtsProvider {
    return {
      name,
      isAvailable: () => available,
      speak: async () => ({ mime: "audio/mpeg", bytes: new Uint8Array([1]) }),
    };
  }

  it("registers, gets and lists in registration order, replacing duplicates", () => {
    const registry = new TtsRegistry();
    registry.register(provider("eerste", true));
    registry.register(provider("tweede", true));
    registry.register(provider("eerste", false));
    assert.deepEqual(
      registry.list().map((entry) => entry.name),
      ["eerste", "tweede"],
    );
    assert.equal(registry.get("eerste")?.isAvailable(CONFIG), false);
    assert.equal(registry.get("derde"), undefined);
  });

  it("refuses a nameless provider and one without speak()", () => {
    const registry = new TtsRegistry();
    assert.throws(() => registry.register(provider("  ", true)), /tts provider needs a name/);
    const broken = { name: "kapot", isAvailable: () => true } as unknown as TtsProvider;
    assert.throws(() => registry.register(broken), /tts provider "kapot" has no speak\(\)/);
  });

  it("picks the first available provider, or says so out loud", () => {
    const registry = new TtsRegistry();
    registry.register(provider("leeg", false));
    registry.register(provider("lokaal", true));
    const picked = registry.candidates(CONFIG);
    assert.ok(!("error" in picked));
    assert.deepEqual(
      picked.providers.map((entry) => entry.name),
      ["lokaal"],
    );

    const empty = new TtsRegistry();
    empty.register(provider("leeg", false));
    const none = empty.candidates({});
    assert.ok("error" in none);
    assert.match(none.error, /no text-to-speech provider is available/);
    assert.equal(describeTts({}, empty), none.error);
  });

  it("a pin is strict: an unknown or unconfigured name is an error", () => {
    const registry = new TtsRegistry();
    registry.register(provider("lokaal", true));
    registry.register(provider("offline", false));

    const unknown = registry.candidates({ ...CONFIG, backend: "bestaat-niet" });
    assert.ok("error" in unknown);
    assert.match(unknown.error, /tts\.backend is "bestaat-niet", but no text-to-speech provider/);

    const unpicked = registry.candidates({ backend: "offline" });
    assert.ok("error" in unpicked);
    assert.match(unpicked.error, /tts\.backend is "offline", but that provider is not configured/);

    const pinned = registry.candidates({ ...CONFIG, backend: "lokaal" });
    assert.ok(!("error" in pinned));
    assert.equal(describeTts({ ...CONFIG, backend: "lokaal" }, registry), "lokaal");
  });

  it("the bundled registry ships the local openai-compatible provider", () => {
    const registry = createTtsRegistry();
    assert.deepEqual(
      registry.list().map((entry) => entry.name),
      ["openai-compat"],
    );
    const provider = registry.get("openai-compat");
    assert.ok(provider !== undefined);
    assert.equal(provider.isAvailable(CONFIG), true);
    assert.equal(provider.isAvailable({ baseUrl: CONFIG.baseUrl }), false);
    assert.equal(provider.isAvailable({ model: CONFIG.model }), false);
  });
});
