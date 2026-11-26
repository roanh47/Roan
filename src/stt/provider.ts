/**
 * The contract every speech-to-text backend implements — the same shape as the
 * web providers: one ABC, a registry, and a caller that owns the error words.
 *
 * A provider turns bytes into text. Capture (microphone, permissions, the
 * recording itself) lives in the app, never here: this module is honest about
 * only ever seeing audio that already exists.
 */
export interface SttConfig {
  /** Explicit provider pin. A wrong pin is an error, never a silent swap. */
  readonly backend?: string;
  /** Where an OpenAI-compatible server listens, e.g. http://127.0.0.1:8080/v1 */
  readonly baseUrl?: string;
  /** Model name the server expects, e.g. whisper-1 or Systran/faster-whisper. */
  readonly model?: string;
  /** Optional bearer token; local servers usually need none. */
  readonly apiKey?: string;
}

/** One finished recording. Capture produced the bytes; STT only reads them. */
export interface SpeechAudio {
  /** Mime type of the container, always audio/*. */
  readonly mime: string;
  readonly bytes: Uint8Array;
}

export interface SttProvider {
  /** Stable id used by `stt.backend`. Lowercase, hyphens allowed. */
  readonly name: string;
  /** Human label for settings screens; falls back to `name`. */
  readonly displayName?: string;
  /** Cheap availability gate: a url and a model are present. Never network. */
  isAvailable(config: SttConfig): boolean;
  /** Turns one recording into text. Throws with what failed and on what input. */
  transcribe(audio: SpeechAudio, config: SttConfig): Promise<string>;
}

/** What a plugin's `register()` gets: one method, like the web plugin context. */
export interface SttPluginContext {
  registerSttProvider(provider: SttProvider): void;
}

/**
 * Whisper's own upload ceiling. A longer recording is a refusal we can explain
 * before a single byte goes over the wire.
 */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/** Human byte count for an error message: "3.4 MB" rather than "3565158". */
function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The one path a provider is called through: gate on availability, refuse audio
 * that cannot be sent, and treat an empty transcript as a failure instead of
 * pasting nothing into the composer.
 */
export async function transcribeWith(
  provider: SttProvider,
  audio: SpeechAudio,
  config: SttConfig,
): Promise<string> {
  if (!provider.isAvailable(config)) {
    throw new Error(
      `speech input: provider "${provider.name}" is not configured (it needs a base url and a model)`,
    );
  }
  if (!audio.mime.toLowerCase().startsWith("audio/")) {
    throw new Error(`speech input: not audio (mime "${audio.mime}")`);
  }
  if (audio.bytes.byteLength === 0) {
    throw new Error(`speech input: the recording is empty (0 bytes for "${provider.name}")`);
  }
  if (audio.bytes.byteLength > MAX_AUDIO_BYTES) {
    throw new Error(
      `speech input: the recording is ${megabytes(audio.bytes.byteLength)}; ` +
        `the limit is ${megabytes(MAX_AUDIO_BYTES)} — record a shorter message`,
    );
  }

  const text = (await provider.transcribe(audio, config)).trim();
  if (text.length === 0) {
    throw new Error(`speech input: provider "${provider.name}" heard nothing`);
  }
  return text;
}
