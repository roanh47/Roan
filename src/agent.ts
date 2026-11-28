import { type ProviderConfig } from "./provider.js";
import { createAdapter, isSupported } from "./providers/factory.js";
import { createOpenAiCompatAdapter } from "./providers/openai-compat.js";
import type { ChatAdapter } from "./providers/adapter.js";
import type { EffortLevel } from "./providers/effort.js";
import { sessionTotal, type TokenUsage } from "./usage.js";
import { toToolSpecs } from "./tools.js";
import type { AgentEvent, ChatMessage, ContentPart, Tool, ToolContext } from "./types.js";

export interface AgentOptions {
  provider: ProviderConfig;
  /**
   * A second provider configuration, tried once when a request to the first
   * fails before it produced anything. The rest of the turn stays on it.
   */
  fallback?: ProviderConfig;
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
  /**
   * Called with the live message list immediately before every request. The
   * turn runner uses it to append a steer the owner sent mid-turn; the loop
   * checks the role invariant right after, so a hook that appends in the wrong
   * place fails loudly instead of sending a request a provider would reject.
   */
  onBeforeRequest?: (messages: ChatMessage[]) => void;
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
export function buildAdapter(provider: ProviderConfig): ChatAdapter {
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
 * One message's content as parts, so two owner messages can be folded into
 * one without dropping a photo that rode along.
 */
function toParts(content: ChatMessage["content"]): ContentPart[] {
  if (typeof content === "string") {
    return content.length === 0 ? [] : [{ type: "text", text: content }];
  }
  return content ?? [];
}

/** Folds two adjacent owner messages into the first, keeping both texts. */
function foldUserMessages(first: ChatMessage, second: ChatMessage): ChatMessage {
  if (typeof first.content === "string" && typeof second.content === "string") {
    const joined = [first.content, second.content].filter((text) => text.length > 0).join("\n\n");
    return { ...first, content: joined };
  }
  return { ...first, content: [...toParts(first.content), ...toParts(second.content)] };
}

/**
 * Replayed history can hold two owner messages in a row: a steer recorded by a
 * turn that then failed is one. A provider treats such a run as a single
 * block, so it is folded here — the chat the model sees keeps the same
 * alternation the live flow enforces.
 */
function normalizeHistory(history: readonly ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const message of history) {
    const last = out[out.length - 1];
    if (last !== undefined && last.role === "user" && message.role === "user") {
      out[out.length - 1] = foldUserMessages(last, message);
      continue;
    }
    out.push({ ...message });
  }
  return out;
}

/** A tool round whose results are not all in yet. */
interface OpenRound {
  readonly index: number;
  readonly pending: Set<string>;
}

/**
 * The shape rule every provider agrees on: user and assistant alternate, and a
 * tool round is never interrupted. A user message may follow tool results
 * (that is where a steer lands) but never another user message, and never an
 * assistant call whose results are still outstanding.
 *
 * One pair is inherited rather than created: the chain records the owner's
 * question before the turn starts, so replayed history can already end with
 * the very text the live turn carries. `inheritedUserPair` names that live
 * message when it repeats the history's last user message, and only that pair
 * is allowed — a turn without a steer must send exactly what it always did.
 *
 * Replayed tool results without their call block are tolerated — the chain
 * stores results, not call ids that no longer exist — so the check is about
 * what the live loop can get wrong, not about rewriting history.
 */
function assertAlternating(messages: readonly ChatMessage[], inheritedUserPair = -1): void {
  let open: OpenRound | null = null;
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message === undefined) continue;

    if (open !== null) {
      if (message.role !== "tool") {
        throw new Error(
          `agent: a ${message.role} message at index ${String(i)} interrupts the tool round opened at index ${String(open.index)}; a steer lands after the tool results`,
        );
      }
      if (message.tool_call_id !== undefined) open.pending.delete(message.tool_call_id);
      if (open.pending.size === 0) open = null;
      continue;
    }

    if (message.role === "user" && messages[i - 1]?.role === "user" && i !== inheritedUserPair) {
      throw new Error(
        `agent: two user messages in a row at index ${String(i)}; a steer can only be appended after tool results`,
      );
    }
    if (message.role === "assistant" && (message.tool_calls?.length ?? 0) > 0) {
      open = { index: i, pending: new Set(message.tool_calls?.map((call) => call.id) ?? []) };
    }
  }
  if (open !== null) {
    throw new Error(
      `agent: the tool round opened at index ${String(open.index)} is missing results for ${[...open.pending].join(", ")}`,
    );
  }
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
  private adapter: ChatAdapter;
  /** The adapter to switch to when the first one fails; used at most once. */
  private spare: ChatAdapter | null;
  /** Every count the provider disclosed this turn, one entry per request. */
  private readonly usages: TokenUsage[] = [];

  constructor(private readonly opts: AgentOptions) {
    this.maxSteps = opts.maxSteps ?? 24;
    this.adapter = buildAdapter(opts.provider);
    this.spare = opts.fallback !== undefined ? buildAdapter(opts.fallback) : null;
    this.messages.push({ role: "system", content: opts.systemPrompt });
    if (opts.history) this.messages.push(...normalizeHistory(opts.history));
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
    // The chain already holds the owner's question when the turn starts, so
    // the replayed history may end with the same message this send() just
    // added. That one pair is inherited; naming it keeps the invariant strict
    // everywhere the loop and a steer can actually add a message.
    const live = this.messages.length - 1;
    const inheritedUserPair = this.messages[live - 1]?.role === "user" ? live : -1;
    let stappen = 0;
    let laatsteTekst = "";

    while (stappen < this.maxSteps) {
      stappen++;
      let antwoord: ChatMessage;
      try {
        // The hook is the one seam a steer enters through. It runs before the
        // invariant check, so text appended at the wrong point is refused here
        // rather than by the provider halfway through the turn.
        this.opts.onBeforeRequest?.(this.messages);
        assertAlternating(this.messages, inheritedUserPair);
        let streamed = false;
        const request = (adapter: ChatAdapter) =>
          adapter.send(this.messages, {
            tools: specs,
            signal: this.opts.signal,
            onDelta: (t) => {
              streamed = true;
              emit({ type: "assistant_text", text: t });
            },
            onReasoning: (t) => emit({ type: "reasoning", text: t }),
            ...(this.opts.effort !== undefined ? { effort: this.opts.effort } : {}),
          });
        let response: Awaited<ReturnType<ChatAdapter["send"]>>;
        try {
          response = await request(this.adapter);
        } catch (err) {
          // One second chance, on the fallback model: only when the owner did
          // not stop the turn and nothing of the answer was shown yet, so a
          // retry can never print the same words twice.
          const spare = this.spare;
          if (spare === null || streamed || this.opts.signal?.aborted === true) throw err;
          this.adapter = spare;
          this.spare = null;
          response = await request(spare);
        }
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
