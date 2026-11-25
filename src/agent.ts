import { chat, type ProviderConfig } from "./provider.js";
import { toToolSpecs } from "./tools.js";
import type { AgentEvent, ChatMessage, Tool, ToolContext } from "./types.js";

export interface AgentOptions {
  provider: ProviderConfig;
  tools: Tool[];
  systemPrompt: string;
  cwd: string;
  maxSteps?: number;
  /** Earlier turns, replayed from the chain. The system prompt is added here. */
  history?: ChatMessage[];
  onEvent?: (event: AgentEvent) => void;
  signal?: AbortSignal;
}

/**
 * The agent loop: model → tool → model, until the model is done or the step budget runs out.
 * Knows nothing about the UI; everything goes through onEvent, so the app and the daemon
 * share the same core.
 */
export class Agent {
  private messages: ChatMessage[] = [];
  private readonly maxSteps: number;

  constructor(private readonly opts: AgentOptions) {
    this.maxSteps = opts.maxSteps ?? 24;
    this.messages.push({ role: "system", content: opts.systemPrompt });
    if (opts.history) this.messages.push(...opts.history);
  }

  get history(): ChatMessage[] {
    return this.messages;
  }

  async send(userText: string, image?: { mime: string; data: string }): Promise<string> {
    // An image rides along on the live message only: the history stays text,
    // so an old photo never taxes a new turn.
    this.messages.push({
      role: "user",
      content:
        image !== undefined
          ? [
              { type: "text", text: userText },
              { type: "image_url", image_url: { url: `data:${image.mime};base64,${image.data}` } },
            ]
          : userText,
    });
    const emit = this.opts.onEvent ?? (() => {});
    const specs = toToolSpecs(this.opts.tools);
    let stappen = 0;
    let laatsteTekst = "";

    while (stappen < this.maxSteps) {
      stappen++;
      let antwoord: ChatMessage;
      try {
        antwoord = await chat(this.opts.provider, this.messages, {
          tools: specs,
          signal: this.opts.signal,
          onDelta: (t) => emit({ type: "assistant_text", text: t }),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        emit({ type: "error", message });
        throw err;
      }

      this.messages.push(antwoord);
      if (typeof antwoord.content === "string" && antwoord.content.length > 0) {
        laatsteTekst = antwoord.content;
      }

      const calls = antwoord.tool_calls ?? [];
      if (calls.length === 0) break;

      for (const call of calls) {
        const tool = this.opts.tools.find((t) => t.name === call.function.name);
        emit({ type: "tool_start", name: call.function.name, args: call.function.arguments });

        let output: string;
        let ok = true;
        if (!tool) {
          ok = false;
          output = `unknown tool: ${call.function.name}`;
        } else {
          try {
            const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
            const ctx: ToolContext = { cwd: this.opts.cwd, signal: this.opts.signal };
            output = await tool.run(args, ctx);
          } catch (err) {
            ok = false;
            output = err instanceof Error ? err.message : String(err);
          }
        }

        emit({ type: "tool_end", name: call.function.name, ok, output });
        this.messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function.name,
          content: output,
        });
      }

      // Running out of budget with tools still queued is the model looping,
      // not working — silence would read as a bug, so the turn says so.
      if (stappen >= this.maxSteps) {
        emit({
          type: "error",
          message: `stopped after ${String(this.maxSteps)} steps — the model kept calling tools without finishing`,
        });
      }
    }

    emit({ type: "turn_end", steps: stappen });
    return laatsteTekst;
  }
}
