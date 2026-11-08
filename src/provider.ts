import type { ChatMessage, ToolCall } from "./types.js";

export interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ChatOptions {
  tools?: unknown[];
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
}

interface StreamDelta {
  content?: string | null;
  tool_calls?: Array<{
    index: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }>;
}

/**
 * Roept een OpenAI-compatibel /chat/completions-endpoint aan en streamt het antwoord.
 * Werkt met OpenAI, LM Studio, opencode-go en alles wat dezelfde vorm praat.
 */
export async function chat(
  cfg: ProviderConfig,
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<ChatMessage> {
  const url = cfg.baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const res = await fetch(url, {
    method: "POST",
    signal: opts.signal,
    headers: {
      "content-type": "application/json",
      ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      stream: true,
      ...(opts.tools && opts.tools.length > 0 ? { tools: opts.tools, tool_choice: "auto" } : {}),
    }),
  });

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    throw new Error(`provider ${res.status}: ${body.slice(0, 400) || res.statusText}`);
  }

  let content = "";
  const calls: ToolCall[] = [];
  const decoder = new TextDecoder();
  let buffer = "";

  const handleLine = (line: string) => {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (payload === "" || payload === "[DONE]") return;
    let json: { choices?: Array<{ delta?: StreamDelta }> };
    try {
      json = JSON.parse(payload);
    } catch {
      return;
    }
    const delta = json.choices?.[0]?.delta;
    if (!delta) return;

    if (delta.content) {
      content += delta.content;
      opts.onDelta?.(delta.content);
    }
    for (const tc of delta.tool_calls ?? []) {
      const slot = (calls[tc.index] ??= {
        id: "",
        type: "function",
        function: { name: "", arguments: "" },
      });
      if (tc.id) slot.id = tc.id;
      if (tc.function?.name) slot.function.name += tc.function.name;
      if (tc.function?.arguments) slot.function.arguments += tc.function.arguments;
    }
  };

  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trimEnd();
      buffer = buffer.slice(idx + 1);
      handleLine(line);
    }
  }
  if (buffer.trim()) handleLine(buffer.trim());

  const message: ChatMessage = { role: "assistant", content: content === "" ? null : content };
  if (calls.length > 0) {
    message.tool_calls = calls.map((c, i) => ({
      ...c,
      id: c.id || `call_${i}_${Date.now()}`,
    }));
  }
  return message;
}
