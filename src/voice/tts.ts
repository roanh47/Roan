import type { SpeechAudio } from "../stt/provider.js";

/**
 * The contract every text-to-speech backend implements — the mirror of
 * `src/stt/provider.ts`: one ABC, a registry, and a caller that owns the error
 * words.
 *
 * A provider turns text into bytes. Playback (speakers, volume, the audio
 * element) lives in the app, never here: this module is honest about only ever
 * producing a clip that something else has to play.
 */
export interface TtsConfig {
  /** Explicit provider pin. A wrong pin is an error, never a silent swap. */
  readonly backend?: string;
  /** Where an OpenAI-compatible server listens, e.g. http://127.0.0.1:8080/v1 */
  readonly baseUrl?: string;
  /** Model name the server expects, e.g. tts-1 or kokoro. */
  readonly model?: string;
  /** Optional bearer token; local servers usually need none. */
  readonly apiKey?: string;
  /** Named voice the server knows; the provider decides its default. */
  readonly voice?: string;
  /** Container to ask for: mp3 (default), wav, opus, aac, flac. */
  readonly format?: string;
}

export interface TtsProvider {
  /** Stable id used by `tts.backend`. Lowercase, hyphens allowed. */
  readonly name: string;
  /** Human label for settings screens; falls back to `name`. */
  readonly displayName?: string;
  /** Cheap availability gate: a url and a model are present. Never network. */
  isAvailable(config: TtsConfig): boolean;
  /** Turns one reply into audio. Throws with what failed and on what input. */
  speak(text: string, config: TtsConfig): Promise<SpeechAudio>;
}

/** What a plugin's `register()` gets: one method, like the stt plugin context. */
export interface TtsPluginContext {
  registerTtsProvider(provider: TtsProvider): void;
}

/**
 * OpenAI's own input ceiling for `/v1/audio/speech`. A longer reply is a
 * refusal we can explain before a single character is sent: a voice loop has to
 * split it, not discover the limit as an HTTP 400.
 */
export const MAX_SPEECH_CHARS = 4096;

/**
 * How much audio we accept back. Generous for a 4096-character reply, small
 * enough that a broken server streaming forever is stopped while reading.
 */
export const MAX_SPEECH_BYTES = 25 * 1024 * 1024;

/** Human byte count for an error message: "3.4 MB" rather than "3565158". */
function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The one path a provider is called through: gate on availability, refuse text
 * that cannot be spoken, and refuse an answer that is not audio instead of
 * handing a player something it cannot open.
 */
export async function speakWith(
  provider: TtsProvider,
  text: string,
  config: TtsConfig,
): Promise<SpeechAudio> {
  if (!provider.isAvailable(config)) {
    throw new Error(
      `speech output: provider "${provider.name}" is not configured (it needs a base url and a model)`,
    );
  }

  const spoken = text.trim();
  if (spoken.length === 0) {
    throw new Error(`speech output: nothing to say (the reply for "${provider.name}" is empty)`);
  }
  if (spoken.length > MAX_SPEECH_CHARS) {
    throw new Error(
      `speech output: the reply is ${String(spoken.length)} characters; ` +
        `the limit is ${String(MAX_SPEECH_CHARS)} — split it into shorter parts`,
    );
  }

  const audio = await provider.speak(spoken, config);
  if (!audio.mime.toLowerCase().startsWith("audio/")) {
    throw new Error(`speech output: provider "${provider.name}" returned no audio (mime "${audio.mime}")`);
  }
  if (audio.bytes.byteLength === 0) {
    throw new Error(`speech output: provider "${provider.name}" returned 0 bytes of audio`);
  }
  if (audio.bytes.byteLength > MAX_SPEECH_BYTES) {
    throw new Error(
      `speech output: provider "${provider.name}" returned ${megabytes(audio.bytes.byteLength)}; ` +
        `the limit is ${megabytes(MAX_SPEECH_BYTES)}`,
    );
  }
  return audio;
}

export type { SpeechAudio };
