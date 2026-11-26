import { randomUUID } from "node:crypto";
import {
  byteCap,
  fetchWithTimeout,
  mimeFromBytes,
  mimeFromResponse,
  providerMessage,
  readCapped,
  redact,
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
 * A local ComfyUI: submit the configured workflow JSON to `/prompt`, then poll
 * `/history/<id>` until it names an output image, and download it from `/view`.
 *
 * ComfyUI is not a prompt API — the workflow *is* the request. `request.prompt`
 * is not injected into it (that would require guessing node ids); callers that
 * want prompt-driven workflows configure one that already reads a text node.
 * What this provider guarantees is the protocol: submit, wait, fetch bytes, and
 * say plainly when the server rejects a workflow or the run fails.
 */
const NAME = "comfyui";
const DEFAULT_IMAGE_MIME = "image/png";

/** Trimmed base url without trailing slashes. */
function baseUrl(config: GenerationConfig): string {
  return (config.baseUrl ?? "").trim().replace(/\/+$/, "");
}

/** One output entry of a finished prompt. */
interface RenderedImage {
  filename?: string;
  subfolder?: string;
  type?: string;
}

interface HistoryStatus {
  status_str?: string;
  completed?: boolean;
  messages?: unknown;
}

interface HistoryEntry {
  status?: HistoryStatus;
  outputs?: Record<string, { images?: RenderedImage[] }>;
}

/** The message inside a ComfyUI `/prompt` rejection, node errors included. */
function rejectionDetail(text: string, apiKey: string | undefined): string {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const parts: string[] = [];
    const error = parsed["error"];
    if (typeof error === "string") parts.push(error);
    else if (typeof error === "object" && error !== null) {
      const message = (error as Record<string, unknown>)["message"];
      if (typeof message === "string") parts.push(message);
    }
    const nodeErrors = parsed["node_errors"];
    if (typeof nodeErrors === "object" && nodeErrors !== null) {
      for (const [nodeId, value] of Object.entries(nodeErrors as Record<string, unknown>)) {
        const errors = (value as Record<string, unknown> | null)?.["errors"];
        if (!Array.isArray(errors)) continue;
        for (const entry of errors) {
          if (typeof entry === "object" && entry !== null) {
            const message = (entry as Record<string, unknown>)["message"];
            if (typeof message === "string") parts.push(`node ${nodeId}: ${message}`);
          }
        }
      }
    }
    if (parts.length > 0) return redact(parts.join("; "), apiKey).slice(0, 300);
  } catch {
    // Not JSON; fall through to the plain body.
  }
  return providerMessage(text, apiKey) || "the server refused the workflow";
}

/**
 * The execution error of a finished-but-failed history entry, if there is one.
 * ComfyUI reports it as `status.messages: [["execution_error", {...}], ...]`.
 */
function executionFailure(status: HistoryStatus | undefined): string | null {
  if (status === undefined) return null;
  if (status.status_str === "error" || status.completed === false) {
    const messages = status.messages;
    if (Array.isArray(messages)) {
      for (const entry of messages) {
        if (!Array.isArray(entry) || entry[0] !== "execution_error") continue;
        const data = entry[1];
        if (typeof data === "object" && data !== null) {
          const record = data as Record<string, unknown>;
          const detail = record["exception_message"];
          const node = record["node_id"] ?? record["node_type"];
          if (typeof detail === "string" && detail.trim().length > 0) {
            return node === undefined ? detail : `${String(node)}: ${detail}`;
          }
        }
      }
    }
    if (status.status_str === "error") return "the workflow failed";
  }
  return null;
}

/** First output image of a history entry, or `null`. */
function firstImage(entry: HistoryEntry): RenderedImage | null {
  const outputs = entry.outputs;
  if (outputs === undefined) return null;
  for (const output of Object.values(outputs)) {
    const image = output?.images?.[0];
    if (image?.filename !== undefined && image.filename.length > 0) return image;
  }
  return null;
}

function viewUrl(base: string, image: RenderedImage): string {
  const query = new URLSearchParams({
    filename: image.filename ?? "",
    subfolder: image.subfolder ?? "",
    type: image.type ?? "output",
  });
  return `${base}/view?${query.toString()}`;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const comfyui: GenerationProvider = {
  name: NAME,
  displayName: "ComfyUI (local)",
  kind: "image",
  isAvailable: (config: GenerationConfig): boolean => baseUrl(config).length > 0,
  async generate(request: GenerationRequest, config: GenerationConfig): Promise<GenerationResult> {
    void request; // The workflow carries the prompt; see the module comment.
    const base = baseUrl(config);
    if (base.length === 0) throw new GenerationError(NAME, "has no url configured");
    const workflow = config.workflow;
    if (typeof workflow !== "object" || workflow === null || Array.isArray(workflow)) {
      throw new GenerationError(NAME, "has no workflow configured (expected the API-format JSON object)");
    }

    const deadline = Date.now() + timeoutMs(config);
    const remaining = (): number => deadline - Date.now();

    const submitted = await fetchWithTimeout(
      NAME,
      `${base}/prompt`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: workflow, client_id: randomUUID() }),
      },
      timeoutMs(config),
    );
    const submitText = await submitted.text().catch(() => "");
    if (!submitted.ok) {
      throw new GenerationError(
        NAME,
        `workflow rejected: ${rejectionDetail(submitText, config.apiKey)}`,
        submitted.status,
      );
    }

    let promptId: string;
    try {
      const body = JSON.parse(submitText) as Record<string, unknown>;
      const id = body["prompt_id"];
      if (typeof id !== "string" || id.length === 0) throw new Error("missing");
      promptId = id;
    } catch {
      throw new GenerationError(NAME, "returned no prompt id", submitted.status);
    }

    const timeout = timeoutMs(config);
    const interval =
      config.pollIntervalMs !== undefined && Number.isFinite(config.pollIntervalMs) && config.pollIntervalMs > 0
        ? Math.floor(config.pollIntervalMs)
        : Math.min(500, Math.max(25, Math.floor(timeout / 20)));

    for (;;) {
      if (remaining() <= 0) throw new GenerationError(NAME, `timed out after ${String(timeout)} ms waiting for the workflow`);

      let history: Response;
      try {
        history = await fetchWithTimeout(
          NAME,
          `${base}/history/${encodeURIComponent(promptId)}`,
          { method: "GET" },
          Math.max(50, Math.min(remaining(), 30_000)),
        );
      } catch (error) {
        // A slow poll is the deadline talking; anything else is a real failure.
        if (error instanceof GenerationError && error.message.startsWith("request timed out")) break;
        throw error;
      }

      const historyText = await history.text().catch(() => "");
      if (!history.ok) {
        throw new GenerationError(
          NAME,
          `history request failed (HTTP ${String(history.status)}): ${providerMessage(historyText, config.apiKey)}`,
          history.status,
        );
      }

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(historyText) as Record<string, unknown>;
      } catch {
        throw new GenerationError(NAME, "returned a history response that is not JSON", history.status);
      }

      const entry = parsed[promptId] as HistoryEntry | undefined;
      if (entry !== undefined && typeof entry === "object") {
        const failure = executionFailure(entry.status);
        if (failure !== null) throw new GenerationError(NAME, `workflow failed: ${redact(failure, config.apiKey)}`);

        const image = firstImage(entry);
        if (image !== null) {
          const downloaded = await fetchWithTimeout(
            NAME,
            viewUrl(base, image),
            { method: "GET" },
            Math.max(50, remaining()),
          );
          if (!downloaded.ok) {
            throw new GenerationError(NAME, `could not download the image (HTTP ${String(downloaded.status)})`, downloaded.status);
          }
          const bytes = await readCapped(downloaded, byteCap(config), NAME);
          const mime = mimeFromBytes(bytes, mimeFromResponse(downloaded, DEFAULT_IMAGE_MIME));
          return { bytes, mime };
        }
        if (entry.status?.completed === true || entry.status?.status_str === "success") {
          throw new GenerationError(NAME, "workflow completed without an image");
        }
      }

      if (remaining() <= 0) throw new GenerationError(NAME, `timed out after ${String(timeout)} ms waiting for the workflow`);
      await sleep(Math.min(interval, Math.max(1, remaining())));
    }

    throw new GenerationError(NAME, `timed out after ${String(timeout)} ms waiting for the workflow`);
  },
};

export function register(ctx: GenerationPluginContext): void {
  ctx.registerGenerationProvider(comfyui);
}
