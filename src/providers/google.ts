/**
 * Google Gemini adapter: `POST {baseUrl}/models/{model}:streamGenerateContent?alt=sse`.
 *
 * Gemini's wire format differs from OpenAI's in three places this file bridges:
 * roles (`assistant` -> `model`), tool traffic (function declarations instead of
 * `tools`/`tool_calls`, function responses riding on a `user` turn) and the
 * system prompt (a top-level `systemInstruction` instead of a message).
 *
 * The key travels in `x-goog-api-key` and is never echoed into an error, a log
 * or a returned message.
 */
import type {
  AdapterConfig,
  ChatAdapter,
  ChatOptions,
  ChatResponse,
  Usage,
} from "./adapter.js";
import { ProviderError } from "./adapter.js";
import type { ChatMessage, ToolCall } from "../types.js";

/* ------------------------------------------------------------------ */
/* Wire shapes: only the fields this adapter reads or writes.          */
/* ------------------------------------------------------------------ */

interface GeminiPart {
  text?: string;
  functionCall?: { name?: string; args?: unknown };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

interface GeminiCandidate {
  content?: { role?: string; parts?: GeminiPart[] };
  finishReason?: string;
}

interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
}

interface GeminiChunk {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: GeminiUsageMetadata;
}

interface FunctionDeclaration {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* Narrowing helpers (no `any`, no blind casts).                       */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Tool arguments arrive as a JSON string; Gemini wants an object. */
function parseToolArguments(raw: string): Record<string, unknown> {
  if (raw.trim() === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : { value: parsed };
  } catch {
    return {};
  }
}

/** OpenAI function-tool definitions -> Gemini function declarations. */
function toFunctionDeclarations(tools: unknown[] | undefined): FunctionDeclaration[] {
  const out: FunctionDeclaration[] = [];
  for (const tool of tools ?? []) {
    if (!isRecord(tool)) continue;
    const fn = tool["function"];
    if (!isRecord(fn)) continue;
    const name = asString(fn["name"]);
    if (name === undefined || name === "") continue;
    const decl: FunctionDeclaration = { name };
    const description = asString(fn["description"]);
    if (description !== undefined) decl.description = description;
    const parameters = fn["parameters"];
    if (isRecord(parameters)) decl.parameters = parameters;
    out.push(decl);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Message mapping (OpenAI-style history -> Gemini contents).           */
/* ------------------------------------------------------------------ */

interface MappedHistory {
  contents: GeminiContent[];
  systemInstruction?: { parts: { text: string }[] };
}

function toContents(messages: ChatMessage[]): MappedHistory {
  const systemTexts: string[] = [];
  const contents: GeminiContent[] = [];
  // Consecutive `tool` messages belong to one user turn: Gemini expects every
  // functionResponse of a round trip to sit in the same content block.
  let lastWasToolResult = false;

  for (const msg of messages) {
    if (msg.role === "system") {
      if (msg.content !== null && msg.content !== "") systemTexts.push(msg.content);
      lastWasToolResult = false;
      continue;
    }

    if (msg.role === "tool") {
      const part: GeminiPart = {
        functionResponse: {
          name: msg.name ?? "tool",
          response: { result: msg.content ?? "" },
        },
      };
      if (lastWasToolResult) {
        const last = contents[contents.length - 1];
        if (last !== undefined && last.role === "user") last.parts.push(part);
      } else {
        contents.push({ role: "user", parts: [part] });
        lastWasToolResult = true;
      }
      continue;
    }

    lastWasToolResult = false;

    if (msg.role === "user") {
      contents.push({ role: "user", parts: [{ text: msg.content ?? "" }] });
      continue;
    }

    // assistant
    const parts: GeminiPart[] = [];
    if (msg.content !== null && msg.content !== "") parts.push({ text: msg.content });
    for (const call of msg.tool_calls ?? []) {
      parts.push({
        functionCall: {
          name: call.function.name,
          args: parseToolArguments(call.function.arguments),
        },
      });
    }
    // A model turn with neither text nor calls carries nothing Gemini accepts.
    if (parts.length === 0) continue;
    contents.push({ role: "model", parts });
  }

  const mapped: MappedHistory = { contents };
  if (systemTexts.length > 0) {
    mapped.systemInstruction = { parts: [{ text: systemTexts.join("\n\n") }] };
  }
  return mapped;
}

/* ------------------------------------------------------------------ */
/* Streaming state                                                     */
/* ------------------------------------------------------------------ */

interface StreamState {
  text: string;
  calls: ToolCall[];
  usage: Usage | null;
  blockReason: string | null;
  finishReason: string | null;
}

function handleChunk(chunk: GeminiChunk, state: StreamState, onDelta?: (t: string) => void): void {
  const block = chunk.promptFeedback?.blockReason;
  if (block !== undefined && block !== "" && block !== "BLOCK_REASON_UNSPECIFIED") {
    state.blockReason = block;
  }

  const usage = chunk.usageMetadata;
  if (usage !== undefined) {
    const input = asNumber(usage.promptTokenCount);
    const output = asNumber(usage.candidatesTokenCount);
    if (input !== undefined || output !== undefined) {
      // Gemini repeats (and grows) the counters on every chunk; the last
      // non-decreasing value is the total for the call.
      state.usage = {
        inputTokens: Math.max(state.usage?.inputTokens ?? 0, input ?? 0),
        outputTokens: Math.max(state.usage?.outputTokens ?? 0, output ?? 0),
      };
    }
  }

  for (const candidate of chunk.candidates ?? []) {
    const finish = candidate.finishReason;
    if (finish !== undefined && finish !== "" && finish !== "FINISH_REASON_UNSPECIFIED" && finish !== "STOP") {
      state.finishReason = finish;
    }

    for (const part of candidate.content?.parts ?? []) {
      const text = part.text;
      if (typeof text === "string" && text !== "") {
        state.text += text;
        onDelta?.(text);
      }
      const call = part.functionCall;
      if (call !== undefined) {
        const name = call.name;
        if (typeof name !== "string" || name === "") continue;
        // Arguments are already an object here, but the agent loop speaks the
        // OpenAI convention: a JSON string plus a stable call id.
        state.calls.push({
          id: `call_${state.calls.length}`,
          type: "function",
          function: {
            name,
            arguments: JSON.stringify(call.args ?? {}),
          },
        });
      }
    }
  }
}

/** Turns a safety stop into a readable note instead of an exception. */
function stopNote(state: StreamState): string {
  if (state.blockReason !== null) {
    return `[google: the prompt was blocked (blockReason=${state.blockReason})]`;
  }
  if (state.finishReason !== null) {
    return `[google: the response was stopped early (finishReason=${state.finishReason})]`;
  }
  return "";
}

/* ------------------------------------------------------------------ */
/* SSE plumbing                                                        */
/* ------------------------------------------------------------------ */

function parseEvent(payload: string, state: StreamState, onDelta?: (t: string) => void): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return;
  }
  if (!isRecord(parsed)) return;
  handleChunk(parsed as GeminiChunk, state, onDelta);
}

/** Keeps a key out of anything we surface, whatever the server echoed. */
function scrub(text: string, apiKey: string): string {
  if (apiKey === "") return text;
  return text.split(apiKey).join("[redacted]");
}

/* ------------------------------------------------------------------ */
/* Adapter                                                             */
/* ------------------------------------------------------------------ */

export function createGoogleAdapter(cfg: AdapterConfig): ChatAdapter {
  const root = cfg.baseUrl.replace(/\/+$/, "");
  // Catalog ids may arrive pre-qualified as `models/<id>`; the path adds it.
  const model = cfg.model.replace(/^models\//, "");

  return {
    id: "google",

    async send(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResponse> {
      const history = toContents(messages);
      const declarations = toFunctionDeclarations(opts.tools);

      const generationConfig: Record<string, unknown> = {};
      if (opts.maxTokens !== undefined) generationConfig["maxOutputTokens"] = opts.maxTokens;
      if (opts.temperature !== undefined) generationConfig["temperature"] = opts.temperature;

      const body: Record<string, unknown> = { contents: history.contents };
      if (history.systemInstruction !== undefined) {
        body["systemInstruction"] = history.systemInstruction;
      }
      if (declarations.length > 0) {
        body["tools"] = [{ functionDeclarations: declarations }];
      }
      if (Object.keys(generationConfig).length > 0) {
        body["generationConfig"] = generationConfig;
      }

      const url = `${root}/models/${model}:streamGenerateContent?alt=sse`;
      const res = await fetch(url, {
        method: "POST",
        signal: opts.signal,
        headers: {
          "content-type": "application/json",
          accept: "text/event-stream",
          ...(cfg.apiKey !== "" ? { "x-goog-api-key": cfg.apiKey } : {}),
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const raw = await res.text().catch(() => "");
        const detail = scrub(raw, cfg.apiKey).slice(0, 400) || res.statusText;
        throw new ProviderError("google", `google ${res.status}: ${detail}`, res.status);
      }
      if (res.body === null) {
        throw new ProviderError("google", "google returned an empty body", res.status);
      }

      const state: StreamState = {
        text: "",
        calls: [],
        usage: null,
        blockReason: null,
        finishReason: null,
      };

      const decoder = new TextDecoder();
      let buffer = "";

      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "" || payload === "[DONE]") continue;
          parseEvent(payload, state, opts.onDelta);
        }
      }
      const tail = buffer.trim();
      if (tail.startsWith("data:")) {
        const payload = tail.slice(5).trim();
        if (payload !== "" && payload !== "[DONE]") parseEvent(payload, state, opts.onDelta);
      }

      const note = stopNote(state);
      let content: string | null = state.text === "" ? null : state.text;
      if (note !== "") {
        content = content === null ? note : `${content}\n\n${note}`;
      }

      const message: ChatMessage = { role: "assistant", content };
      if (state.calls.length > 0) message.tool_calls = state.calls;

      return { message, usage: state.usage };
    },
  };
}
