/**
 * The contract every generation backend implements. One provider answers for
 * exactly one kind (image, video or music); the registry picks the provider,
 * the tool wrapper owns saving and formatting.
 *
 * A provider answers with bytes plus a mime type, or with a url when the
 * backend only returns a link. Nothing here knows a vendor.
 */

/** What can be generated. One provider serves exactly one of these. */
export type GenerationKind = "image" | "video" | "music";

export const GENERATION_KINDS: readonly GenerationKind[] = ["image", "video", "music"];

/**
 * Where generation runs and with which credentials.
 *
 * `backend` pins a provider for every kind; the per-kind keys win over it,
 * exactly like `searchBackend`/`extractBackend` in the web config. The last
 * four fields are only read by the backend that needs them: ComfyUI takes
 * `workflow`, and the caps/timeout are test seams and self-hosted limits.
 */
export interface GenerationConfig {
  /** Shared pin for all kinds. A wrong pin is an error, never a silent swap. */
  readonly backend?: string;
  /** Image-only pin, wins over the shared one. */
  readonly imageBackend?: string;
  /** Video-only pin, wins over the shared one. */
  readonly videoBackend?: string;
  /** Music-only pin, wins over the shared one. */
  readonly musicBackend?: string;
  /** API root. OpenAI defaults to https://api.openai.com; ComfyUI requires one. */
  readonly baseUrl?: string;
  /** Provider key. Never logged, never put in an error message. */
  readonly apiKey?: string;
  /** Model id; the openai-images provider defaults to gpt-image-1. */
  readonly model?: string;
  /** ComfyUI: the workflow JSON (API format) submitted as-is to /prompt. */
  readonly workflow?: unknown;
  /** Per-request deadline. Defaults to 120 s for images and for ComfyUI polling. */
  readonly timeoutMs?: number;
  /** ComfyUI history poll interval. Defaults to 500 ms, shortened for short timeouts. */
  readonly pollIntervalMs?: number;
  /** Hard ceiling on a downloaded artifact. Defaults to 25 MiB. */
  readonly maxBytes?: number;
}

/** What the caller asks for. Only `prompt` is required. */
export interface GenerationRequest {
  readonly prompt: string;
  /** Provider-specific size, e.g. "1024x1024" or "1280x720". */
  readonly size?: string;
  /** How many artifacts; backends that make one at a time clamp to 1. */
  readonly count?: number;
  /** What to steer away from, when the backend understands it. */
  readonly negativePrompt?: string;
  /** Reproducibility seed, when the backend understands it. */
  readonly seed?: number;
}

/** Bytes plus the mime type they actually are. */
export interface GeneratedBytes {
  readonly bytes: Uint8Array;
  readonly mime: string;
}

/** A link to an artifact the backend hosted for us. */
export interface GeneratedUrl {
  readonly url: string;
}

export type GenerationResult = GeneratedBytes | GeneratedUrl;

/** Narrows a result to bytes without trusting the provider. */
export function isGeneratedBytes(result: GenerationResult): result is GeneratedBytes {
  return "bytes" in result;
}

/** Narrows a result to a url without trusting the provider. */
export function isGeneratedUrl(result: GenerationResult): result is GeneratedUrl {
  return "url" in result;
}

export interface GenerationProvider {
  /** Stable id used by the config keys. Lowercase, hyphens allowed. */
  readonly name: string;
  /** Human label for settings screens; falls back to `name`. */
  readonly displayName?: string;
  /** The one kind this provider makes. */
  readonly kind: GenerationKind;
  /** Cheap availability gate: a url or key is present. Never network. */
  isAvailable(config: GenerationConfig): boolean;
  /** Makes one artifact. Throws `GenerationError` with a safe message. */
  generate(request: GenerationRequest, config: GenerationConfig): Promise<GenerationResult>;
}

/** What a plugin's `register()` gets, mirroring the web plugin context. */
export interface GenerationPluginContext {
  registerGenerationProvider(provider: GenerationProvider): void;
}

/**
 * An error that carries which provider failed and, when there was one, the
 * HTTP status. Messages never contain a key or a raw request body.
 */
export class GenerationError extends Error {
  readonly provider: string;
  readonly status: number | null;

  constructor(provider: string, message: string, status: number | null = null) {
    super(message);
    this.name = "GenerationError";
    this.provider = provider;
    this.status = status;
  }
}
