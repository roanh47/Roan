import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SpeechAudio, SttProvider } from "../stt/provider.js";
import { createVoiceLoop } from "./loop.js";
import type { VoiceLoopEnd, VoiceState } from "./types.js";
import type { TtsProvider } from "./tts.js";

/**
 * Fake providers and a fake ear/speaker: nothing here touches a microphone, a
 * speaker or the network. `listen()` is whatever the test hands in, which is
 * the whole point of the injected capture.
 */

const AUDIO: SpeechAudio = { mime: "audio/wav", bytes: new Uint8Array([1, 2, 3, 4]) };

interface SttStub extends SttProvider {
  readonly calls: SpeechAudio[];
}

function sttStub(answer: string | (() => Promise<string>), available = true): SttStub {
  const calls: SpeechAudio[] = [];
  return {
    name: "fake-stt",
    calls,
    isAvailable: () => available,
    async transcribe(audio: SpeechAudio): Promise<string> {
      calls.push(audio);
      return typeof answer === "string" ? answer : answer();
    },
  };
}

interface TtsStub extends TtsProvider {
  readonly spoken: string[];
}

function ttsStub(available = true): TtsStub {
  const spoken: string[] = [];
  return {
    name: "fake-tts",
    spoken,
    isAvailable: () => available,
    async speak(text: string): Promise<SpeechAudio> {
      spoken.push(text);
      return AUDIO;
    },
  };
}

/** A listener that hands in each queued utterance and then `null` (silence). */
function queuedListen(queue: readonly (SpeechAudio | null)[]): {
  listen: (signal: AbortSignal) => Promise<SpeechAudio | null>;
  calls: () => number;
} {
  let index = 0;
  return {
    calls: () => index,
    listen: async (): Promise<SpeechAudio | null> => {
      const next = queue[index] ?? null;
      index += 1;
      return next;
    },
  };
}

/** A listener that stays listening until the loop is stopped. */
function pendingListen(): {
  listen: (signal: AbortSignal) => Promise<SpeechAudio | null>;
  calls: () => number;
} {
  let calls = 0;
  return {
    calls: () => calls,
    listen: (signal: AbortSignal): Promise<SpeechAudio | null> =>
      new Promise((resolve) => {
        calls += 1;
        if (signal.aborted) {
          resolve(null);
          return;
        }
        signal.addEventListener("abort", () => resolve(null), { once: true });
      }),
  };
}

function recorder(): { states: VoiceState[]; onState: (state: VoiceState) => void } {
  const states: VoiceState[] = [];
  return { states, onState: (state: VoiceState) => states.push(state) };
}

describe("the voice conversation loop", () => {
  it("starts, listens, and stops on request", async () => {
    const rec = recorder();
    const ear = pendingListen();
    const loop = createVoiceLoop({
      stt: sttStub("nooit"),
      tts: ttsStub(),
      turn: async () => "nooit",
      listen: ear.listen,
      onState: rec.onState,
    });

    const running = loop.start();
    assert.equal(loop.running, true);
    assert.equal(loop.state, "listening");
    loop.stop();

    const end = await running;
    assert.equal(end.reason, "stopped");
    assert.equal(end.turns, 0);
    assert.deepEqual(rec.states, ["listening", "idle"]);
    assert.equal(ear.calls(), 1);
    assert.equal(loop.running, false);
    assert.equal(loop.state, "idle");
    assert.equal(loop.lastEnd, end);
  });

  it("runs a full listen → think → speak cycle, then hears again", async () => {
    const rec = recorder();
    const heard: string[] = [];
    const played: string[] = [];
    const stt = sttStub("zet de lamp aan");
    const tts = ttsStub();
    const ear = queuedListen([AUDIO, null]);

    const loop = createVoiceLoop({
      stt,
      tts,
      turn: async (transcript: string) => {
        heard.push(transcript);
        return "  gedaan  ";
      },
      listen: ear.listen,
      onState: rec.onState,
      onSpeech: (_audio: SpeechAudio, text: string) => played.push(text),
    });

    const end = await loop.start();
    assert.equal(end.reason, "no-audio");
    assert.equal(end.turns, 1);
    assert.deepEqual(heard, ["zet de lamp aan"]);
    assert.deepEqual(stt.calls, [AUDIO]);
    // The reply reaches the provider trimmed, and the same text reaches playback.
    assert.deepEqual(tts.spoken, ["gedaan"]);
    assert.deepEqual(played, ["gedaan"]);
    assert.deepEqual(rec.states, ["listening", "thinking", "speaking", "listening", "idle"]);
    assert.equal(ear.calls(), 2);
    assert.equal(loop.turns, 1);
  });

  it("ends honestly on an empty transcript instead of spinning", async () => {
    const rec = recorder();
    const tts = ttsStub();
    let turned = 0;
    const loop = createVoiceLoop({
      stt: sttStub("   \n"),
      tts,
      turn: async () => {
        turned += 1;
        return "nooit";
      },
      listen: queuedListen([AUDIO, AUDIO]).listen,
      onState: rec.onState,
    });

    const end = await loop.start();
    assert.equal(end.reason, "empty-transcript");
    assert.equal(end.turns, 0);
    assert.equal(turned, 0);
    assert.deepEqual(tts.spoken, []);
    assert.deepEqual(rec.states, ["listening", "thinking", "idle"]);
  });

  it("reports a failed TTS and stops with the provider's words", async () => {
    const rec = recorder();
    const ear = queuedListen([AUDIO, AUDIO]);
    const tts: TtsProvider = {
      name: "broken-tts",
      isAvailable: () => true,
      speak: async () => {
        throw new Error("speech output: no answer from http://127.0.0.1:9/v1/audio/speech within 60s");
      },
    };
    const loop = createVoiceLoop({
      stt: sttStub("hallo"),
      tts,
      turn: async () => "hoi terug",
      listen: ear.listen,
      onState: rec.onState,
    });

    const end = await loop.start();
    assert.equal(end.reason, "tts-failed");
    assert.match(end.error?.message ?? "", /no answer from http:\/\/127\.0\.0\.1:9\/v1\/audio\/speech within 60s/);
    assert.equal(end.turns, 0);
    // No second listen: a broken speaker ends the conversation, it does not loop.
    assert.equal(ear.calls(), 1);
    assert.deepEqual(rec.states, ["listening", "thinking", "speaking", "idle"]);
  });

  it("halts the loop when stopped while speaking, and plays nothing", async () => {
    const rec = recorder();
    const ear = queuedListen([AUDIO, AUDIO]);

    let releaseSpeech!: () => void;
    const speechGate = new Promise<void>((resolve) => {
      releaseSpeech = resolve;
    });
    let announceSpeaking!: () => void;
    const speakingStarted = new Promise<void>((resolve) => {
      announceSpeaking = resolve;
    });
    let played = 0;

    const loop = createVoiceLoop({
      stt: sttStub("hallo"),
      tts: {
        name: "slow-tts",
        isAvailable: () => true,
        speak: async () => {
          announceSpeaking();
          await speechGate;
          return AUDIO;
        },
      },
      turn: async () => "even geduld",
      listen: ear.listen,
      onState: rec.onState,
      onSpeech: () => {
        played += 1;
      },
    });

    const running = loop.start();
    await speakingStarted;
    assert.equal(loop.state, "speaking");

    loop.stop();
    assert.equal(loop.state, "idle");
    releaseSpeech();

    const end = await running;
    assert.equal(end.reason, "stopped");
    assert.equal(end.turns, 0);
    assert.equal(played, 0);
    assert.equal(ear.calls(), 1);
    assert.deepEqual(rec.states, ["listening", "thinking", "speaking", "idle"]);
  });

  it("refuses a second start while one is running", async () => {
    const ear = pendingListen();
    const loop = createVoiceLoop({
      stt: sttStub("nooit"),
      tts: ttsStub(),
      turn: async () => "nooit",
      listen: ear.listen,
    });

    const running = loop.start();
    await assert.rejects(loop.start(), /already running — stop\(\) it before starting again/);
    assert.equal(ear.calls(), 1);

    loop.stop();
    assert.equal((await running).reason, "stopped");
  });

  it("ends before listening when a provider is not configured", async () => {
    const rec = recorder();
    const ear = queuedListen([AUDIO]);
    const loop = createVoiceLoop({
      stt: sttStub("nooit", false),
      tts: ttsStub(),
      turn: async () => "nooit",
      listen: ear.listen,
      onState: rec.onState,
    });

    const end: VoiceLoopEnd = await loop.start();
    assert.equal(end.reason, "not-configured");
    assert.match(end.error?.message ?? "", /speech-to-text provider "fake-stt" is not configured/);
    assert.equal(ear.calls(), 0);
    assert.deepEqual(rec.states, []);
    assert.equal(loop.state, "idle");

    const noSpeaker = createVoiceLoop({
      stt: sttStub("nooit"),
      tts: ttsStub(false),
      turn: async () => "nooit",
      listen: ear.listen,
    });
    const other = await noSpeaker.start();
    assert.equal(other.reason, "not-configured");
    assert.match(other.error?.message ?? "", /text-to-speech provider "fake-tts" is not configured/);
    assert.equal(ear.calls(), 0);
  });

  it("ends with the reason for a failed listen, turn, or empty reply", async () => {
    const failingListen = createVoiceLoop({
      stt: sttStub("nooit"),
      tts: ttsStub(),
      turn: async () => "nooit",
      listen: async () => {
        throw new Error("ear: the microphone vanished");
      },
    });
    const listenEnd = await failingListen.start();
    assert.equal(listenEnd.reason, "listen-failed");
    assert.match(listenEnd.error?.message ?? "", /the microphone vanished/);

    const rec = recorder();
    const failingTurn = createVoiceLoop({
      stt: sttStub("hallo"),
      tts: ttsStub(),
      turn: async () => {
        throw new Error("turn: the model is offline");
      },
      listen: queuedListen([AUDIO]).listen,
      onState: rec.onState,
    });
    const turnEnd = await failingTurn.start();
    assert.equal(turnEnd.reason, "turn-failed");
    assert.match(turnEnd.error?.message ?? "", /the model is offline/);
    assert.equal(turnEnd.transcript, "hallo");
    assert.deepEqual(rec.states, ["listening", "thinking", "idle"]);

    const tts = ttsStub();
    const emptyReply = createVoiceLoop({
      stt: sttStub("hallo"),
      tts,
      turn: async () => "   ",
      listen: queuedListen([AUDIO]).listen,
    });
    const replyEnd = await emptyReply.start();
    assert.equal(replyEnd.reason, "empty-reply");
    assert.deepEqual(tts.spoken, []);
  });

  it("reports a playback callback that throws, instead of rejecting start()", async () => {
    const ear = queuedListen([AUDIO, AUDIO]);
    const loop = createVoiceLoop({
      stt: sttStub("hallo"),
      tts: ttsStub(),
      turn: async () => "hoi",
      listen: ear.listen,
      onSpeech: () => {
        throw new Error("player: no audio device");
      },
    });

    const end = await loop.start();
    assert.equal(end.reason, "playback-failed");
    assert.match(end.error?.message ?? "", /no audio device/);
    assert.equal(end.turns, 0);
    assert.equal(ear.calls(), 1);
    assert.equal(loop.state, "idle");
  });

  it("stops itself at maxTurns instead of talking forever", async () => {
    const rec = recorder();
    const ear = queuedListen([AUDIO, AUDIO, AUDIO]);
    const loop = createVoiceLoop({
      stt: sttStub("hallo"),
      tts: ttsStub(),
      turn: async () => "hoi",
      listen: ear.listen,
      onState: rec.onState,
      maxTurns: 2,
    });

    const end = await loop.start();
    assert.equal(end.reason, "max-turns");
    assert.equal(end.turns, 2);
    assert.equal(ear.calls(), 2);
    assert.equal(rec.states.at(-1), "idle");
    assert.deepEqual(rec.states, ["listening", "thinking", "speaking", "listening", "thinking", "speaking", "listening", "idle"]);
  });

  it("a stop before start is a no-op", () => {
    const loop = createVoiceLoop({
      stt: sttStub("nooit"),
      tts: ttsStub(),
      turn: async () => "nooit",
      listen: async () => null,
    });
    loop.stop();
    assert.equal(loop.state, "idle");
    assert.equal(loop.running, false);
  });

  it("refuses a maxTurns that cannot make sense", () => {
    const base = {
      stt: sttStub("nooit"),
      tts: ttsStub(),
      turn: async () => "nooit",
      listen: async () => null,
    };
    assert.throws(() => createVoiceLoop({ ...base, maxTurns: 0 }), /maxTurns must be a positive integer/);
    assert.throws(() => createVoiceLoop({ ...base, maxTurns: 1.5 }), /maxTurns must be a positive integer/);
  });
});
