import type { SpeechAudio } from "../../../stt/provider.js";
import type { TtsConfig, TtsPluginContext, TtsProvider } from "../../tts.js";
import { MAX_SPEECH_BYTES } from "../../tts.js";

/**
 * A local OpenAI-compatible speech server (`/v1/audio/speech`): OpenAI itself,
 * LocalAI, Kokoro-FastAPI, openedai-speech, LM Studio's speech endpoints.
 *
 * Wire shape: **JSON in, audio bytes out** — `{ model, input, voice,
 * response_format }`, the request body the endpoint is specified with. The
 * answer's `content-type` says what the bytes are; `application/octet-stream`
 * is mapped back from the format we asked for, because several local servers
 * answer with that instead of a real audio type.
 *
 * `baseUrl` is the server root with or without the `/v1` suffix: both
 * `http://127.0.0.1:8080` and `http://127.0.0.1:8080/v1` post to
 * `/v1/audio/speech`.
 */

/** A minute is generous for a short reply on a laptop-class CPU; not forever. */
export const TTS_TIMEOUT_MS = 60_000;

/** How much of a server's error page we echo back: enough to diagnose, no more. */
const ERROR_BODY_LIMIT = 400;

/** The container the request asks for when the config does not say. */
const DEFAULT_FORMAT = "mp3";

/** What each requested format is called once it arrives as a bare byte stream. */
const FORMAT_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  opus: "audio/ogg",
  aac: "audio/aac",
  flac: "audio/flac",
  pcm: "audio/wav",
};

/** The speech url for a base that may or may not already end in /v1. */
export function speechUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/v1")
    ? `${trimmed}/audio/speech`
    : `${trimmed}/v1/audio/speech`;
}

function isConfigured(config: TtsConfig): boolean {
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
    return new Error(`speech output: no answer from ${url} within ${String(TTS_TIMEOUT_MS / 1000)}s`);
  }
  const code = cause.cause?.code ?? "";
  const detail = code.length > 0 ? code : (cause.cause?.message ?? cause.message ?? "unknown cause");
  return new Error(`speech output: cannot reach ${url} (${detail}) — is the speech server running?`);
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
    return new Error(`speech output: ${url} rejected the api key (HTTP ${String(status)})${detail}`);
  }
  if (status === 404) {
    return new Error(`speech output: no speech endpoint at ${url} (HTTP 404) — check the base url${detail}`);
  }
  if (status === 413) {
    return new Error(`speech output: the reply is too long for the server (HTTP 413)${detail}`);
  }
  if (status === 429) {
    return new Error(`speech output: the server is busy or rate limited (HTTP 429)${detail}`);
  }
  if (status >= 500) {
    return new Error(`speech output: the speech server failed (HTTP ${String(status)})${detail}`);
  }
  return new Error(`speech output: ${url} answered HTTP ${String(status)}${detail}`);
}

/** The audio type of an answer: its own header, or the format we asked for. */
function audioMime(contentType: string, format: string): string {
  const declared = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (declared.startsWith("audio/")) return declared;
  if (declared === "application/octet-stream") {
    return FORMAT_MIME[format] ?? "audio/mpeg";
  }
  return declared;
}

export const openAiCompat: TtsProvider = {
  name: "openai-compat",
  displayName: "Local server (OpenAI-compatible)",

  isAvailable: (config: TtsConfig): boolean => isConfigured(config),

  async speak(text: string, config: TtsConfig): Promise<SpeechAudio> {
    const baseUrl = config.baseUrl?.trim() ?? "";
    const model = config.model?.trim() ?? "";
    if (baseUrl.length === 0 || model.length === 0) {
      throw new Error('speech output: "openai-compat" needs a base url and a model');
    }
    const url = speechUrl(baseUrl);
    const format = (config.format?.trim() || DEFAULT_FORMAT).toLowerCase();
    const voice = config.voice?.trim() || "alloy";

    const headers: Record<string, string> = {
      accept: "audio/*",
      "content-type": "application/json",
    };
    const key = config.apiKey?.trim() ?? "";
    if (key.length > 0) headers["authorization"] = `Bearer ${key}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        body: JSON.stringify({
          model,
          input: text,
          voice,
          response_format: format,
        }),
        headers,
        signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
      });
    } catch (error) {
      throw transportError(url, error);
    }

    if (!response.ok) throw await httpError(response, url);

    const declaredLength = Number(response.headers.get("content-length") ?? "");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_SPEECH_BYTES) {
      throw new Error(
        `speech output: ${url} announced ${(declaredLength / (1024 * 1024)).toFixed(1)} MB of audio; ` +
          `the limit is ${(MAX_SPEECH_BYTES / (1024 * 1024)).toFixed(1)} MB`,
      );
    }

    const mime = audioMime(response.headers.get("content-type") ?? "", format);
    if (!mime.startsWith("audio/")) {
      const body = (await response.text().catch(() => "")).slice(0, 80).replace(/\s+/g, " ").trim();
      throw new Error(
        `speech output: ${url} answered with ${mime.length > 0 ? `"${mime}"` : "no content type"} ` +
          `instead of audio${body.length > 0 ? ` (${body})` : ""}`,
      );
    }

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      throw transportError(url, error);
    }
    if (bytes.byteLength === 0) {
      throw new Error(`speech output: ${url} returned an empty audio body (0 bytes)`);
    }
    if (bytes.byteLength > MAX_SPEECH_BYTES) {
      throw new Error(
        `speech output: ${url} returned ${(bytes.byteLength / (1024 * 1024)).toFixed(1)} MB of audio; ` +
          `the limit is ${(MAX_SPEECH_BYTES / (1024 * 1024)).toFixed(1)} MB`,
      );
    }
    return { mime, bytes };
  },
};

export function register(ctx: TtsPluginContext): void {
  ctx.registerTtsProvider(openAiCompat);
}
