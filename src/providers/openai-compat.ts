/**
 * The OpenAI-compatible streaming adapter: `POST {baseUrl}/chat/completions`
 * with `stream: true`, reassembling SSE deltas into one assistant message.
 * Works with OpenAI, LM Studio, opencode-go and anything with the same shape.
 *
 * This is what `src/provider.ts` used to do inline; that file is now a thin
 * delegation shim so existing callers keep working.
 */
import { randomUUID } from "node:crypto";
import type { ChatMessage, ToolCall } from "../types.js";
import {
  ProviderError,
  type AdapterConfig,
  type ChatAdapter,
  type ChatOptions,
  type ChatResponse,
  type ProviderConfig,
  type Usage,
} from "./adapter.js";
import { effortParams } from "./effort.js";

/** `id` of this adapter; names the wire protocol, not the vendor. */
const ADAPTER_ID = "openai-compat";

/** Fallback error text budget, matching the pre-adapter behaviour. */
const BODY_PREVIEW = 400;

/**
 * One session id per process, sent to opencode's gateway. Without it the request
 * is refused with `MissingSessionID` — the id is what lets their router keep a
 * conversation together, and it never leaves this machine otherwise.
 */
const openCodeSession = randomUUID();

/** One streamed tool-call fragment. Only `index` is guaranteed. */
interface ToolCallDelta {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

/** The `delta` object of a streamed choice. */
interface StreamDelta {
  content?: string | null;
  /** The model's reasoning, as DeepSeek and most compatible servers spell it. */
  reasoning_content?: string | null;
  /** The same thing as OpenRouter-style gateways spell it. */
  reasoning?: string | null;
  tool_calls?: ToolCallDelta[];
}

/** What a caller wants to hear while the answer streams. */
interface StreamListeners {
  readonly onDelta: ((text: string) => void) | undefined;
  readonly onReasoning: ((text: string) => void) | undefined;
}

/** Token counts some providers attach to the final chunk. */
interface StreamUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

/** A single `data:` payload of the SSE stream. */
interface StreamChunk {
  choices?: Array<{ delta?: StreamDelta }>;
  usage?: StreamUsage | null;
}

/** Mutable accumulator for one streamed answer. */
export interface Stream {
  content: string;
  /** Keyed by `index` so fragments that arrive out of order still merge. */
  calls: Map<number, ToolCall>;
  usage: Usage | null;
}

/** Joins a base URL and the completions path without doubling slashes. */
function endpoint(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "") + "/chat/completions";
}

/** Withdraws the `usage` object of one chunk into the accumulator, if present. */
function applyUsage(state: Stream, usage: StreamUsage | null | undefined): void {
  if (!usage) return;
  const input = usage.prompt_tokens ?? state.usage?.inputTokens;
  const output = usage.completion_tokens ?? state.usage?.outputTokens;
  if (input === undefined && output === undefined) return;
  state.usage = { inputTokens: input ?? 0, outputTokens: output ?? 0 };
}

/** Folds one `data:` payload into the accumulator. Malformed JSON is ignored. */
export function applyPayload(state: Stream, payload: string, listeners: StreamListeners): void {
  let chunk: StreamChunk;
  try {
    chunk = JSON.parse(payload) as StreamChunk;
  } catch {
    return;
  }

  applyUsage(state, chunk.usage);

  const delta = chunk.choices?.[0]?.delta;
  if (!delta) return;

  // Reasoning is handed on and deliberately not kept in the message: it is
  // for the owner to read, and is never sent back as part of the answer.
  const reasoning = typeof delta.reasoning_content === "string" ? delta.reasoning_content : delta.reasoning;
  if (typeof reasoning === "string" && reasoning.length > 0) listeners.onReasoning?.(reasoning);

  if (delta.content) {
    state.content += delta.content;
    listeners.onDelta?.(delta.content);
  }

  for (const tc of delta.tool_calls ?? []) {
    let slot = state.calls.get(tc.index);
    if (!slot) {
      slot = { id: "", type: "function", function: { name: "", arguments: "" } };
      state.calls.set(tc.index, slot);
    }
    if (tc.id) slot.id = tc.id;
    if (tc.function?.name) slot.function.name += tc.function.name;
    if (tc.function?.arguments) slot.function.arguments += tc.function.arguments;
  }
}

/** Consumes one SSE line; non-`data:` lines and `[DONE]` are skipped. */
function applyLine(state: Stream, line: string, listeners: StreamListeners): void {
  if (!line.startsWith("data:")) return;
  const payload = line.slice(5).trim();
  if (payload === "" || payload === "[DONE]") return;
  applyPayload(state, payload, listeners);
}

/** Splits a byte stream into lines, keeping the tail between chunks. */
async function readSse(
  body: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trimEnd();
      buffer = buffer.slice(idx + 1);
      onLine(line);
    }
  }
  if (buffer.trim()) onLine(buffer.trim());
}

/** Turns the accumulated state into the single assistant message. */
function toMessage(state: Stream): ChatMessage {
  const message: ChatMessage = {
    role: "assistant",
    content: state.content === "" ? null : state.content,
  };
  if (state.calls.size > 0) {
    message.tool_calls = [...state.calls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, call], i) => ({ ...call, id: call.id || `call_${i}_${Date.now()}` }));
  }
  return message;
}

/** Builds the request body, omitting knobs the caller did not set. */
function requestBody(
  cfg: AdapterConfig,
  messages: ChatMessage[],
  opts: ChatOptions,
): Record<string, unknown> {
  const body: Record<string, unknown> = { model: cfg.model, messages, stream: true };
  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools;
    body.tool_choice = "auto";
  }
  if (opts.maxTokens !== undefined) body.max_tokens = opts.maxTokens;
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  // `normal` (the default) yields `{}` and changes nothing. The provider id
  // comes from `createAdapter`; without one the protocol name stands in.
  Object.assign(body, effortParams(cfg.providerId ?? ADAPTER_ID, cfg.model, opts.effort ?? "normal"));
  return body;
}

/**
 * Streams one completion and returns the assistant message plus usage.
 *
 * Usage is only reported when a chunk actually carries it, which most
 * providers do on the final chunk (OpenAI needs `stream_options.include_usage`,
 * so it usually reports `null` here).
 */
export function createOpenAiCompatAdapter(cfg: AdapterConfig): ChatAdapter {
  return {
    id: ADAPTER_ID,
    async send(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResponse> {
      const res = await fetch(endpoint(cfg.baseUrl), {
        method: "POST",
        signal: opts.signal,
        headers: {
          "content-type": "application/json",
          ...(cfg.headers ?? {}),
          // opencode's gateway refuses a request without a session header, and
          // a stable id per process is enough for it to route the turn.
          ...(cfg.baseUrl.includes("opencode.ai") ? { "x-opencode-session": openCodeSession } : {}),
          ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
        },
        body: JSON.stringify(requestBody(cfg, messages, opts)),
      });

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        throw new ProviderError(
          ADAPTER_ID,
          `provider ${res.status}: ${text.slice(0, BODY_PREVIEW) || res.statusText}`,
          res.status,
        );
      }

      const state: Stream = { content: "", calls: new Map(), usage: null };
      const listeners: StreamListeners = { onDelta: opts.onDelta, onReasoning: opts.onReasoning };
      await readSse(res.body, (line) => applyLine(state, line, listeners));
      return { message: toMessage(state), usage: state.usage };
    },
  };
}

/**
 * Backwards-compatible wrapper: same call shape and return value as the old
 * `src/provider.ts#chat`, now backed by the adapter.
 */
export async function chat(
  cfg: ProviderConfig,
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<ChatMessage> {
  try {
    const response = await createOpenAiCompatAdapter(cfg).send(messages, opts);
    return response.message;
  } catch (err) {
    // Old callers expect a plain Error with the same text, not ProviderError.
    if (err instanceof ProviderError) throw new Error(err.message);
    throw err;
  }
}
