import type { SpeechAudio, SttConfig, SttProvider } from "../stt/provider.js";
import { MAX_AUDIO_BYTES } from "../stt/provider.js";
import { speakWith } from "./tts.js";
import type { VoiceLoop, VoiceLoopEnd, VoiceLoopOptions, VoiceState } from "./types.js";

/**
 * The conversation loop: listen → think → speak → listen, until someone stops
 * it or a turn cannot honestly continue.
 *
 * Nothing in this module touches a microphone or a speaker. `listen()` hands in
 * audio that already exists, `turn()` runs the agent, and `onSpeech()` hands the
 * finished clip to whatever plays it. That is what makes the loop testable with
 * fake providers and honest about where each failure came from.
 *
 * Every state change goes through `onState`, so a test — or the app's voice
 * screen — sees exactly what happened: `idle → listening → thinking → speaking
 * → listening`, and always back to `idle`, with a reason for ending.
 */

/** The default safety valve: a spoken conversation longer than this is a stuck loop. */
export const DEFAULT_MAX_TURNS = 50;

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * One recording in, one transcript out — the stt guard rails, but with silence
 * as a value instead of an error, because in a conversation hearing nothing is
 * an ending, not a crash.
 */
async function hear(stt: SttProvider, audio: SpeechAudio, config: SttConfig): Promise<string> {
  if (!stt.isAvailable(config)) {
    throw new Error(`speech input: provider "${stt.name}" is not configured (it needs a base url and a model)`);
  }
  if (!audio.mime.toLowerCase().startsWith("audio/")) {
    throw new Error(`speech input: not audio (mime "${audio.mime}")`);
  }
  if (audio.bytes.byteLength === 0) {
    throw new Error(`speech input: the recording is empty (0 bytes for "${stt.name}")`);
  }
  if (audio.bytes.byteLength > MAX_AUDIO_BYTES) {
    throw new Error(
      `speech input: the recording is ${(audio.bytes.byteLength / (1024 * 1024)).toFixed(1)} MB; ` +
        `the limit is ${(MAX_AUDIO_BYTES / (1024 * 1024)).toFixed(1)} MB — record a shorter message`,
    );
  }
  return (await stt.transcribe(audio, config)).trim();
}

export function createVoiceLoop(options: VoiceLoopOptions): VoiceLoop {
  if (typeof options.turn !== "function") throw new Error("voice conversation: turn() is required");
  if (typeof options.listen !== "function") throw new Error("voice conversation: listen() is required");

  const sttConfig = options.sttConfig ?? {};
  const ttsConfig = options.ttsConfig ?? {};
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
  if (!Number.isInteger(maxTurns) || maxTurns < 1) {
    throw new Error(`voice conversation: maxTurns must be a positive integer, got ${String(maxTurns)}`);
  }

  let state: VoiceState = "idle";
  let running = false;
  let stopping = false;
  let turns = 0;
  let lastEnd: VoiceLoopEnd | undefined;
  let controller: AbortController | undefined;

  const emit = (next: VoiceState): void => {
    if (state === next) return;
    state = next;
    options.onState?.(next);
  };

  const finish = (end: VoiceLoopEnd): VoiceLoopEnd => {
    lastEnd = end;
    return end;
  };

  async function run(signal: AbortSignal): Promise<VoiceLoopEnd> {
    emit("listening");

    while (!stopping) {
      if (turns >= maxTurns) {
        return finish({ reason: "max-turns", turns });
      }

      let audio: SpeechAudio | null;
      try {
        audio = await options.listen(signal);
      } catch (error) {
        if (stopping) break;
        return finish({ reason: "listen-failed", error: asError(error), turns });
      }
      if (stopping) break;
      if (audio === null) return finish({ reason: "no-audio", turns });

      emit("thinking");

      let transcript: string;
      try {
        transcript = await hear(options.stt, audio, sttConfig);
      } catch (error) {
        if (stopping) break;
        return finish({ reason: "stt-failed", error: asError(error), turns });
      }
      if (stopping) break;
      if (transcript.length === 0) return finish({ reason: "empty-transcript", turns });

      let reply: string;
      try {
        reply = (await options.turn(transcript, signal)).trim();
      } catch (error) {
        if (stopping) break;
        return finish({ reason: "turn-failed", error: asError(error), turns, transcript });
      }
      if (stopping) break;
      if (reply.length === 0) return finish({ reason: "empty-reply", turns, transcript });

      emit("speaking");

      let speech: SpeechAudio;
      try {
        speech = await speakWith(options.tts, reply, ttsConfig);
      } catch (error) {
        if (stopping) break;
        return finish({ reason: "tts-failed", error: asError(error), turns, transcript });
      }
      if (stopping) break;

      try {
        options.onSpeech?.(speech, reply);
      } catch (error) {
        return finish({ reason: "playback-failed", error: asError(error), turns, transcript });
      }
      turns += 1;
      emit("listening");
    }

    return finish({ reason: "stopped", turns });
  }

  return {
    async start(): Promise<VoiceLoopEnd> {
      if (running) {
        throw new Error("voice conversation: already running — stop() it before starting again");
      }
      if (!options.stt.isAvailable(sttConfig)) {
        return finish({
          reason: "not-configured",
          error: new Error(
            `voice conversation: the speech-to-text provider "${options.stt.name}" is not configured ` +
              "(it needs a base url and a model)",
          ),
          turns: 0,
        });
      }
      if (!options.tts.isAvailable(ttsConfig)) {
        return finish({
          reason: "not-configured",
          error: new Error(
            `voice conversation: the text-to-speech provider "${options.tts.name}" is not configured ` +
              "(it needs a base url and a model)",
          ),
          turns: 0,
        });
      }

      running = true;
      stopping = false;
      turns = 0;
      controller = new AbortController();
      const signal = controller.signal;

      try {
        return await run(signal);
      } finally {
        running = false;
        controller = undefined;
        emit("idle");
      }
    },

    stop(): void {
      if (!running) return;
      stopping = true;
      controller?.abort();
      emit("idle");
    },

    get state(): VoiceState {
      return state;
    },

    get running(): boolean {
      return running;
    },

    get turns(): number {
      return turns;
    },

    get lastEnd(): VoiceLoopEnd | undefined {
      return lastEnd;
    },
  };
}
