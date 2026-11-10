/**
 * Anthropic Messages API adapter.
 *
 * Speaks the `/messages` wire format (streaming SSE) and translates both ways
 * between that format and the agent loop's OpenAI-shaped messages/tools, so
 * nothing above this file has to know about `tool_use` blocks or top-level
 * `system` prompts.
 */
import { ProviderError } from "./adapter.js";
import type { AdapterConfig, ChatAdapter, ChatOptions, ChatResponse, Usage } from "./adapter.js";
import type { ChatMessage, ToolCall } from "../types.js";

/** Header value the Messages API requires. */
const ANTHROPIC_VERSION = "2023-06-01";

/** The Messages API refuses requests without an output cap. */
const DEFAULT_MAX_TOKENS = 4096;

/** Tool result / tool use content blocks we produce for the wire. */
interface TextBlock {
  type: "text";
  text: string;
}
interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}
interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}
type OutgoingBlock = TextBlock | ToolUseBlock | ToolResultBlock;

interface OutgoingMessage {
  role: "user" | "assistant";
  content: string | OutgoingBlock[];
}

/** One streamed tool_use block being accumulated. */
interface PendingToolBlock {
  id: string;
  name: string;
  json: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Tool-call arguments arrive as a JSON string; tolerate junk without throwing. */
function parseArguments(raw: string): Record<string, unknown> {
  if (raw.trim() === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return asRecord(parsed) ?? {};
  } catch {
    return {};
  }
}

/** Map OpenAI function-tool definitions onto Anthropic `tools`. */
function mapTools(tools: unknown[] | undefined): Array<{
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}> | null {
  if (!tools || tools.length === 0) return null;
  const out: Array<{ name: string; description: string; input_schema: Record<string, unknown> }> = [];
  for (const tool of tools) {
    const record = asRecord(tool);
    if (!record) continue;
    // OpenAI shape nests under `function`; accept a flat shape too.
    const fn = asRecord(record["function"]) ?? record;
    const name = asString(fn["name"]);
    if (!name) continue;
    out.push({
      name,
      description: asString(fn["description"]) ?? "",
      input_schema: asRecord(fn["parameters"]) ?? { type: "object", properties: {} },
    });
  }
  return out.length > 0 ? out : null;
}

/** Build the outbound `messages` array plus the lifted-out system prompt. */
function mapMessages(messages: ChatMessage[]): {
  system: string | null;
  messages: OutgoingMessage[];
} {
  const systemParts: string[] = [];
  const out: OutgoingMessage[] = [];

  for (const msg of messages) {
    const text = msg.content ?? "";

    if (msg.role === "system") {
      if (text !== "") systemParts.push(text);
      continue;
    }

    if (msg.role === "tool") {
      const block: ToolResultBlock = {
        type: "tool_result",
        tool_use_id: msg.tool_call_id ?? "",
        content: text,
      };
      // Parallel tool calls produce consecutive tool messages; Anthropic wants
      // them as several blocks inside one user turn.
      const last = out[out.length - 1];
      if (last && last.role === "user" && Array.isArray(last.content)) {
        const blocks = last.content;
        if (blocks.every((b) => b.type === "tool_result")) {
          blocks.push(block);
          continue;
        }
      }
      out.push({ role: "user", content: [block] });
      continue;
    }

    if (msg.role === "assistant") {
      const callBlocks: ToolUseBlock[] = [];
      for (const call of msg.tool_calls ?? []) {
        callBlocks.push({
          type: "tool_use",
          id: call.id,
          name: call.function.name,
          input: parseArguments(call.function.arguments),
        });
      }
      if (callBlocks.length === 0) {
        out.push({ role: "assistant", content: text });
      } else {
        const blocks: OutgoingBlock[] = text !== "" ? [{ type: "text", text }, ...callBlocks] : callBlocks;
        out.push({ role: "assistant", content: blocks });
      }
      continue;
    }

    out.push({ role: "user", content: text });
  }

  return {
    system: systemParts.length > 0 ? systemParts.join("\n\n") : null,
    messages: out,
  };
}

/** Strip any trace of the key before an error message leaves this module. */
function redact(text: string, apiKey: string): string {
  if (apiKey === "") return text;
  return text.split(apiKey).join("[redacted]");
}

/**
 * Build an adapter for a single Anthropic configuration.
 *
 * The returned adapter streams text through `opts.onDelta` and returns the
 * assembled assistant message with any `tool_use` blocks converted back to
 * OpenAI-style tool calls.
 */
export function createAnthropicAdapter(cfg: AdapterConfig): ChatAdapter {
  const endpoint = cfg.baseUrl.replace(/\/+$/, "") + "/messages";

  return {
    id: "anthropic",

    async send(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResponse> {
      const { system, messages: wireMessages } = mapMessages(messages);
      const tools = mapTools(opts.tools);

      const body: Record<string, unknown> = {
        model: cfg.model,
        max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
        stream: true,
        messages: wireMessages,
      };
      if (system !== null) body["system"] = system;
      if (tools !== null) body["tools"] = tools;
      if (opts.temperature !== undefined) body["temperature"] = opts.temperature;

      let res: Response;
      try {
        res = await fetch(endpoint, {
          method: "POST",
          signal: opts.signal,
          headers: {
            "content-type": "application/json",
            "anthropic-version": ANTHROPIC_VERSION,
            ...(cfg.apiKey !== "" ? { "x-api-key": cfg.apiKey } : {}),
          },
          body: JSON.stringify(body),
        });
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : "request failed";
        throw new ProviderError("anthropic", redact(`request failed: ${reason}`, cfg.apiKey), null);
      }

      if (!res.ok) {
        const raw = await res.text().catch(() => "");
        const detail = redact(raw.slice(0, 400), cfg.apiKey) || res.statusText;
        throw new ProviderError("anthropic", `anthropic ${res.status}: ${detail}`, res.status);
      }
      if (!res.body) {
        throw new ProviderError("anthropic", "anthropic returned an empty response body", null);
      }

      let content = "";
      let inputTokens: number | null = null;
      let outputTokens: number | null = null;
      const toolBlocks = new Map<number, PendingToolBlock>();
      const toolOrder: number[] = [];

      const handleEvent = (payload: string): void => {
        if (payload === "" || payload === "[DONE]") return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(payload);
        } catch {
          return;
        }
        const event = asRecord(parsed);
        if (!event) return;
        const type = asString(event["type"]);

        if (type === "message_start") {
          const message = asRecord(event["message"]);
          const usage = message ? asRecord(message["usage"]) : null;
          const input = usage ? asNumber(usage["input_tokens"]) : null;
          if (input !== null) inputTokens = input;
          return;
        }

        if (type === "content_block_start") {
          const index = asNumber(event["index"]);
          const block = asRecord(event["content_block"]);
          if (index === null || !block) return;
          const blockType = asString(block["type"]);
          if (blockType === "tool_use") {
            const id = asString(block["id"]) ?? `call_${index}`;
            const name = asString(block["name"]) ?? "";
            const initial = asRecord(block["input"]);
            toolBlocks.set(index, {
              id,
              name,
              // Some proxies send non-streamed input on the start event.
              json: initial && Object.keys(initial).length > 0 ? JSON.stringify(initial) : "",
            });
            toolOrder.push(index);
          } else if (blockType === "text") {
            const text = asString(block["text"]);
            if (text) {
              content += text;
              opts.onDelta?.(text);
            }
          }
          return;
        }

        if (type === "content_block_delta") {
          const index = asNumber(event["index"]);
          const delta = asRecord(event["delta"]);
          if (index === null || !delta) return;
          const deltaType = asString(delta["type"]);
          if (deltaType === "text_delta") {
            const text = asString(delta["text"]);
            if (text) {
              content += text;
              opts.onDelta?.(text);
            }
          } else if (deltaType === "input_json_delta") {
            const pending = toolBlocks.get(index);
            if (pending) {
              const partial = asString(delta["partial_json"]);
              if (partial) pending.json += partial;
            }
          }
          return;
        }

        if (type === "message_delta") {
          const usage = asRecord(event["usage"]);
          const output = usage ? asNumber(usage["output_tokens"]) : null;
          if (output !== null) outputTokens = output;
          return;
        }

        if (type === "error") {
          const error = asRecord(event["error"]);
          const detail = error ? asString(error["message"]) : null;
          throw new ProviderError(
            "anthropic",
            redact(`stream error: ${detail ?? "unknown error"}`, cfg.apiKey),
            null,
          );
        }
      };

      const decoder = new TextDecoder();
      let buffer = "";

      const drainBuffer = (): void => {
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trimEnd();
          buffer = buffer.slice(newline + 1);
          if (line.startsWith("data:")) handleEvent(line.slice(5).trim());
        }
      };

      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        drainBuffer();
      }
      buffer += decoder.decode();
      drainBuffer();
      if (buffer.trim().startsWith("data:")) handleEvent(buffer.trim().slice(5).trim());

      const calls: ToolCall[] = [];
      for (const index of toolOrder) {
        const pending = toolBlocks.get(index);
        if (!pending) continue;
        calls.push({
          id: pending.id,
          type: "function",
          function: { name: pending.name, arguments: JSON.stringify(parseArguments(pending.json)) },
        });
      }

      const message: ChatMessage = {
        role: "assistant",
        content: content === "" ? null : content,
      };
      if (calls.length > 0) message.tool_calls = calls;

      const usage: Usage | null =
        inputTokens !== null && outputTokens !== null
          ? { inputTokens, outputTokens }
          : inputTokens !== null
            ? { inputTokens, outputTokens: 0 }
            : outputTokens !== null
              ? { inputTokens: 0, outputTokens }
              : null;

      return { message, usage };
    },
  };
}
