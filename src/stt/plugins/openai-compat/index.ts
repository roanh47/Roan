import type { SpeechAudio, SttConfig, SttPluginContext, SttProvider } from "../../provider.js";

/**
 * A local OpenAI-compatible transcription server (whisper.cpp's `server`,
 * faster-whisper-server, LocalAI, LM Studio, …).
 *
 * Wire shape: **multipart/form-data**, the shape every `/v1/audio/transcriptions`
 * implementation speaks — `file` (the bytes, with their own content type) plus
 * `model`, and `response_format=json` so the answer is `{ "text": "…" }`. JSON
 * with base64 audio was rejected on purpose: it is not OpenAI's contract and
 * several local servers only accept the upload.
 *
 * `baseUrl` is the server root with or without the `/v1` suffix: both
 * `http://127.0.0.1:8080` and `http://127.0.0.1:8080/v1` post to
 * `/v1/audio/transcriptions`.
 */

/** A minute is generous for a short clip on a laptop-class CPU; not forever. */
export const TRANSCRIBE_TIMEOUT_MS = 60_000;

/** How much of a server's error page we echo back: enough to diagnose, no more. */
const ERROR_BODY_LIMIT = 400;

const EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/flac": "flac",
};

/** A filename the multipart part can carry; some servers sniff the extension. */
function filenameFor(audio: SpeechAudio): string {
  const ext = EXTENSIONS[audio.mime.split(";")[0]?.trim().toLowerCase() ?? ""];
  return ext === undefined ? "clip" : `clip.${ext}`;
}

/** The transcription url for a base that may or may not already end in /v1. */
export function transcriptionUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/v1")
    ? `${trimmed}/audio/transcriptions`
    : `${trimmed}/v1/audio/transcriptions`;
}

function isConfigured(config: SttConfig): boolean {
  const baseUrl = config.baseUrl?.trim() ?? "";
  const model = config.model?.trim() ?? "";
  return baseUrl.length > 0 && model.length > 0;
}

/** Why a request never produced an answer, in words a user can act on. */
function transportError(url: string, error: unknown): Error {
  const cause = (typeof error === "object" && error !== null ? error : {}) as {
    name?: string;
    message?: string;
    cause?: { code?: string; message?: string };
  };
  if (cause.name === "TimeoutError" || cause.name === "AbortError") {
    return new Error(`speech input: no answer from ${url} within ${String(TRANSCRIBE_TIMEOUT_MS / 1000)}s`);
  }
  const code = cause.cause?.code ?? "";
  const detail = code.length > 0 ? code : (cause.cause?.message ?? cause.message ?? "unknown cause");
  return new Error(`speech input: cannot reach ${url} (${detail}) — is the transcription server running?`);
}

/** Maps status codes to the one sentence that explains them. */
async function httpError(response: Response, url: string): Promise<Error> {
  let body = "";
  try {
    body = (await response.text()).slice(0, ERROR_BODY_LIMIT).replace(/\s+/g, " ").trim();
  } catch {
    /* an unreadable error body does not change the status */
  }
  const detail = body.length > 0 ? `: ${body}` : "";
  const status = response.status;
  if (status === 401 || status === 403) {
    return new Error(`speech input: ${url} rejected the api key (HTTP ${String(status)})${detail}`);
  }
  if (status === 404) {
    return new Error(`speech input: no transcription endpoint at ${url} (HTTP 404) — check the base url${detail}`);
  }
  if (status === 413) {
    return new Error(`speech input: the recording is too large for the server (HTTP 413)${detail}`);
  }
  if (status === 429) {
    return new Error(`speech input: the server is busy or rate limited (HTTP 429)${detail}`);
  }
  if (status >= 500) {
    return new Error(`speech input: the transcription server failed (HTTP ${String(status)})${detail}`);
  }
  return new Error(`speech input: ${url} answered HTTP ${String(status)}${detail}`);
}

/** Reads `{ "text": "…" }`; anything else is a broken server, not empty speech. */
function transcriptOf(raw: string, url: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`speech input: ${url} answered with something that is not JSON (${raw.slice(0, 80)})`);
  }
  if (typeof parsed !== "object" || parsed === null || !("text" in parsed)) {
    throw new Error(`speech input: ${url} answered without a "text" field`);
  }
  const text = (parsed as { text?: unknown }).text;
  if (typeof text !== "string") {
    throw new Error(`speech input: ${url} answered with a non-string "text"`);
  }
  return text;
}

export const openAiCompat: SttProvider = {
  name: "openai-compat",
  displayName: "Local server (OpenAI-compatible)",

  isAvailable: (config: SttConfig): boolean => isConfigured(config),

  async transcribe(audio: SpeechAudio, config: SttConfig): Promise<string> {
    const baseUrl = config.baseUrl?.trim() ?? "";
    const model = config.model?.trim() ?? "";
    if (baseUrl.length === 0 || model.length === 0) {
      throw new Error('speech input: "openai-compat" needs a base url and a model');
    }
    const url = transcriptionUrl(baseUrl);

    const form = new FormData();
    form.set("file", new Blob([new Uint8Array(audio.bytes)], { type: audio.mime }), filenameFor(audio));
    form.set("model", model);
    form.set("response_format", "json");

    const headers: Record<string, string> = { accept: "application/json" };
    const key = config.apiKey?.trim() ?? "";
    if (key.length > 0) headers["authorization"] = `Bearer ${key}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        body: form,
        headers,
        signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
      });
    } catch (error) {
      throw transportError(url, error);
    }

    if (!response.ok) throw await httpError(response, url);

    let raw: string;
    try {
      raw = await response.text();
    } catch (error) {
      throw transportError(url, error);
    }
    return transcriptOf(raw, url);
  },
};

export function register(ctx: SttPluginContext): void {
  ctx.registerSttProvider(openAiCompat);
}
