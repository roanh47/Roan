import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MAX_AUDIO_BYTES, transcribeWith } from "./provider.js";
import type { SpeechAudio, SttConfig, SttProvider } from "./provider.js";

const CONFIG: SttConfig = { baseUrl: "http://127.0.0.1:9/v1", model: "whisper-1" };

function clip(bytes = new Uint8Array([1, 2, 3]), mime = "audio/wav"): SpeechAudio {
  return { mime, bytes };
}

/** A provider that never touches the network and records what it was asked. */
function stub(answer: string | (() => Promise<string>)): SttProvider & { calls: SpeechAudio[] } {
  const calls: SpeechAudio[] = [];
  return {
    name: "stub",
    calls,
    isAvailable: () => true,
    async transcribe(audio: SpeechAudio): Promise<string> {
      calls.push(audio);
      return typeof answer === "string" ? answer : answer();
    },
  };
}

describe("transcribeWith", () => {
  it("returns the provider's text, trimmed", async () => {
    const provider = stub("  hallo wereld \n");
    assert.equal(await transcribeWith(provider, clip(), CONFIG), "hallo wereld");
    assert.equal(provider.calls.length, 1);
  });

  it("refuses an unconfigured provider before any audio is sent", async () => {
    const provider = stub("never");
    const unconfigured: SttProvider = { ...provider, isAvailable: () => false };
    await assert.rejects(transcribeWith(unconfigured, clip(), {}), {
      message: /provider "stub" is not configured/,
    });
    assert.equal(provider.calls.length, 0);
  });

  it("refuses bytes that are not audio", async () => {
    const provider = stub("never");
    await assert.rejects(transcribeWith(provider, clip(undefined, "application/octet-stream"), CONFIG), {
      message: /not audio \(mime "application\/octet-stream"\)/,
    });
    assert.equal(provider.calls.length, 0);
  });

  it("refuses an empty recording", async () => {
    const provider = stub("never");
    await assert.rejects(transcribeWith(provider, clip(new Uint8Array(0)), CONFIG), {
      message: /the recording is empty \(0 bytes for "stub"\)/,
    });
    assert.equal(provider.calls.length, 0);
  });

  it("refuses a recording over the cap without uploading it", async () => {
    const provider = stub("never");
    const tooBig = new Uint8Array(MAX_AUDIO_BYTES + 1);
    await assert.rejects(transcribeWith(provider, clip(tooBig), CONFIG), {
      message: /the recording is 25\.0 MB; the limit is 25\.0 MB — record a shorter message/,
    });
    assert.equal(provider.calls.length, 0);
  });

  it("accepts a recording exactly at the cap", async () => {
    const provider = stub("op de grens");
    assert.equal(await transcribeWith(provider, clip(new Uint8Array(MAX_AUDIO_BYTES)), CONFIG), "op de grens");
  });

  it("treats an empty transcript as a failure, not as silence to paste", async () => {
    const provider = stub("   \n");
    await assert.rejects(transcribeWith(provider, clip(), CONFIG), {
      message: /provider "stub" heard nothing/,
    });
  });

  it("passes a provider's own error through untouched", async () => {
    const provider = stub(async () => {
      throw new Error("speech input: cannot reach http://127.0.0.1:9/v1/audio/transcriptions");
    });
    await assert.rejects(transcribeWith(provider, clip(), CONFIG), { message: /cannot reach/ });
  });
});
