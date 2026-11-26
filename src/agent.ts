import { type ProviderConfig } from "./provider.js";
import { createAdapter, isSupported } from "./providers/factory.js";
import { createOpenAiCompatAdapter } from "./providers/openai-compat.js";
import type { ChatAdapter } from "./providers/adapter.js";
import type { EffortLevel } from "./providers/effort.js";
import { sessionTotal, type TokenUsage } from "./usage.js";
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
  /**
   * How hard the model should think this turn. Passed to every request of the
   * turn; `normal` is the provider's own default and sends nothing.
   */
  effort?: EffortLevel;
  /**
   * Tools the model may not call this turn, mapped to a sentence saying why.
   * A hallucinated call is answered with that sentence instead of "unknown
   * tool", so the transcript explains the mode rather than sounding broken.
   */
  refusedTools?: ReadonlyMap<string, string>;
  onEvent?: (event: AgentEvent) => void;
  signal?: AbortSignal;
}

/**
 * Picks the adapter for the configured provider.
 *
 * A provider id the catalog knows gets the adapter its protocol deserves;
 * anything else — a custom URL, a local server, a config from before the id
 * existed — speaks the OpenAI shape, which is what this loop has always
 * assumed. The id is dropped on that path: an unknown id would only make
 * `effortParams` refuse to say anything.
 */
function buildAdapter(provider: ProviderConfig): ChatAdapter {
  if (provider.providerId !== undefined && isSupported(provider.providerId)) {
    return createAdapter(provider.providerId, provider);
  }
  return createOpenAiCompatAdapter({
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model: provider.model,
    ...(provider.headers !== undefined ? { headers: provider.headers } : {}),
  });
}

/**
 * The agent loop: model → tool → model, until the model is done or the step budget runs out.
 * Knows nothing about the UI; everything goes through onEvent, so the app and the daemon
 * share the same core.
 */
export class Agent {
  private messages: ChatMessage[] = [];
  private readonly maxSteps: number;
  /** One adapter per agent: the provider family cannot change mid-turn. */
  private readonly adapter: ChatAdapter;
  /** Every count the provider disclosed this turn, one entry per request. */
  private readonly usages: TokenUsage[] = [];

  constructor(private readonly opts: AgentOptions) {
    this.maxSteps = opts.maxSteps ?? 24;
    this.adapter = buildAdapter(opts.provider);
    this.messages.push({ role: "system", content: opts.systemPrompt });
    if (opts.history) this.messages.push(...opts.history);
  }

  get history(): ChatMessage[] {
    return this.messages;
  }

  /**
   * What this turn cost, as the provider reported it: one sum over every
   * request in the loop, or `null` when no request disclosed usage. A provider
   * that reports nothing is not an error; it just leaves the field empty.
   */
  get usage(): TokenUsage | null {
    return this.usages.length === 0 ? null : sessionTotal(this.usages);
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
        const response = await this.adapter.send(this.messages, {
          tools: specs,
          signal: this.opts.signal,
          onDelta: (t) => emit({ type: "assistant_text", text: t }),
          ...(this.opts.effort !== undefined ? { effort: this.opts.effort } : {}),
        });
        antwoord = response.message;
        // A turn is several requests; each one's usage counts towards it. A
        // provider that reports none simply adds nothing.
        if (response.usage !== null) {
          this.usages.push({ input: response.usage.inputTokens, output: response.usage.outputTokens });
        }
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
        const refused = this.opts.refusedTools?.get(call.function.name);
        if (refused !== undefined) {
          // Withheld on purpose: never run it, and say so in words the user
          // can act on instead of feeding back "unknown tool".
          ok = false;
          output = refused;
        } else if (!tool) {
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
