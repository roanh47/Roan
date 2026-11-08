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
 * De agent-loop: model → tool → model, tot het model klaar is of het stappenbudget op is.
 * Weet niets van de UI; alles gaat via onEvent, zodat de app en de daemon
 * dezelfde core gebruiken.
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

  async send(userText: string): Promise<string> {
    this.messages.push({ role: "user", content: userText });
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
      if (antwoord.content) laatsteTekst = antwoord.content;

      const calls = antwoord.tool_calls ?? [];
      if (calls.length === 0) break;

      for (const call of calls) {
        const tool = this.opts.tools.find((t) => t.name === call.function.name);
        emit({ type: "tool_start", name: call.function.name, args: call.function.arguments });

        let output: string;
        let ok = true;
        if (!tool) {
          ok = false;
          output = `onbekende tool: ${call.function.name}`;
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
    }

    emit({ type: "turn_end", steps: stappen });
    return laatsteTekst;
  }
}
