import {
  byteCap,
  decodeBase64Capped,
  fetchWithTimeout,
  mimeFromBytes,
  providerMessage,
  timeoutMs,
} from "../../http.js";
import {
  GenerationError,
  type GenerationConfig,
  type GenerationPluginContext,
  type GenerationProvider,
  type GenerationRequest,
  type GenerationResult,
} from "../../types.js";

/**
 * OpenAI's image endpoint: `POST {base}/v1/images/generations` with the prompt,
 * a size and `n: 1`, answered with base64 bytes. The key rides the request
 * only; it is never repeated in an error, and the base64 payload is refused
 * before decoding when it cannot fit the cap.
 */
const NAME = "openai-images";
const DEFAULT_BASE = "https://api.openai.com";
const DEFAULT_MODEL = "gpt-image-1";
const DEFAULT_SIZE = "1024x1024";

/** `/v1` once, whether the user typed it or not. */
function endpoint(baseUrl: string | undefined): string {
  const base = (baseUrl ?? DEFAULT_BASE).trim().replace(/\/+$/, "");
  return /\/v1$/.test(base) ? `${base}/images/generations` : `${base}/v1/images/generations`;
}

/** One entry of the `data` array, in the shape the API documents. */
interface ImageDatum {
  b64_json?: string;
  url?: string;
}

interface ImagesBody {
  data?: ImageDatum[];
  error?: { message?: string } | string;
}

/** Status-code to a message a user can act on, without echoing the request. */
function statusMessage(status: number, body: string, apiKey: string | undefined): string {
  const detail = providerMessage(body, apiKey);
  if (status === 401 || status === 403) {
    return detail.length > 0 ? `authentication failed (check the api key): ${detail}` : "authentication failed (check the api key)";
  }
  if (status === 429) return detail.length > 0 ? `rate limited, try again later: ${detail}` : "rate limited, try again later";
  if (status >= 500) return detail.length > 0 ? `server error (HTTP ${String(status)}): ${detail}` : `server error (HTTP ${String(status)})`;
  if (detail.length > 0) return detail;
  return `request refused (HTTP ${String(status)})`;
}

export const openaiImages: GenerationProvider = {
  name: NAME,
  displayName: "OpenAI Images",
  kind: "image",
  isAvailable: (config: GenerationConfig): boolean => (config.apiKey ?? "").trim().length > 0,
  async generate(request: GenerationRequest, config: GenerationConfig): Promise<GenerationResult> {
    const prompt = request.prompt?.trim() ?? "";
    if (prompt.length === 0) throw new GenerationError(NAME, "needs a prompt");
    const apiKey = (config.apiKey ?? "").trim();
    if (apiKey.length === 0) throw new GenerationError(NAME, "has no api key configured");

    const body = {
      model: (config.model ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL,
      prompt,
      size: request.size ?? DEFAULT_SIZE,
      // One artifact per call: the tool composes requests, the provider does not
      // fan out, and a single response is a single result.
      n: 1,
    };

    const response = await fetchWithTimeout(
      NAME,
      endpoint(config.baseUrl),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      },
      timeoutMs(config),
    );

    const text = await response.text().catch(() => "");
    if (!response.ok) {
      throw new GenerationError(NAME, statusMessage(response.status, text, apiKey), response.status);
    }

    let parsed: ImagesBody;
    try {
      parsed = JSON.parse(text) as ImagesBody;
    } catch {
      throw new GenerationError(NAME, "returned a response that is not JSON", response.status);
    }

    const datum = parsed.data?.[0];
    if (datum === undefined) throw new GenerationError(NAME, "returned no image", response.status);

    if (typeof datum.b64_json === "string" && datum.b64_json.length > 0) {
      const bytes = decodeBase64Capped(datum.b64_json, byteCap(config), NAME);
      // The API does not say what it encoded; the bytes do.
      return { bytes, mime: mimeFromBytes(bytes, "image/png") };
    }
    if (typeof datum.url === "string" && datum.url.length > 0) {
      return { url: datum.url };
    }
    throw new GenerationError(NAME, "returned an entry without bytes or a url", response.status);
  },
};

export function register(ctx: GenerationPluginContext): void {
  ctx.registerGenerationProvider(openaiImages);
}
