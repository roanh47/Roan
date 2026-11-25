import { randomUUID } from "node:crypto";
import { Agent } from "../agent.js";
import type { EventStore } from "../chain/store.js";
import type { Event } from "../protocol/types.js";
import { allTools } from "../tools.js";
import type { Tool } from "../types.js";
import { acquire, release, SeqConflictError } from "../turn/index.js";
import type { Event as TurnEvent, TurnEventDraft, TurnStore } from "../turn/types.js";
import { historyFromEvents } from "./history.js";
import { runHermesTurn } from "../engine/hermes.js";
import { sessionMessages } from "../chain/sessions.js";
import { compactMessages, type ChatMessage } from "../chain/compaction.js";

export interface TurnRunnerOptions {
  readonly store: EventStore;
  readonly chain: string;
  readonly node: string;
  /** An image attached to this turn, base64; rides on the live message only. */
  readonly image?: { readonly mime: string; readonly data: string };
  readonly provider: { baseUrl: string; apiKey: string; model: string };
  readonly cwd: string;
  readonly systemPrompt: string;
  /** Tools this turn may use; the built-ins when a caller does not say. */
  readonly tools?: readonly Tool[];
  /**
   * Who runs the turn. `hermes` uses the engine on this machine (real tools,
   * skills, MCP); `builtin` uses the small loop in this repo.
   */
  readonly engine?: "builtin" | "hermes";
  /** The conversation this turn belongs to; only its history is sent. */
  readonly session?: string;
  /** Called for every event the run produces, after it is durable. */
  readonly onAppend: (event: Event) => void;
  /** Aborts the turn; set by the cancel request the app sends. */
  readonly signal?: AbortSignal;
}

/** Adapts the event store to the narrower shape the turn lock expects. */
function asTurnStore(store: EventStore, options: TurnRunnerOptions): TurnStore {
  const adapter: TurnStore = {
    tail(chain: string, limit: number) {
      const head = store.head(chain);
      const from = Math.max(1, head - limit + 1);
      return store.read(chain, from, limit) as unknown as readonly TurnEvent[];
    },
    append(chain: string, expectedSeq: number, draft: TurnEventDraft) {
      const actual = store.head(chain) + 1;
      if (actual !== expectedSeq) {
        throw new SeqConflictError(expectedSeq, actual);
      }
      const event = store.append(chain, {
        id: randomUUID(),
        node: draft.node,
        type: draft.type,
        data: draft.data,
      }) as unknown as TurnEvent;
      // The lock's own turn_start/turn_end land in the chain through this
      // adapter. Without the broadcast the app never learns a turn opened,
      // and the thinking state — the whole dock — never appears.
      options.onAppend(event as unknown as Event);
      return event;
    },
  };
  return adapter;
}

export interface AppendInput {
  readonly type: Event["type"];
  readonly data: Record<string, unknown>;
}

/**
 * Runs one turn: takes the lock, replays the chain into the model, appends what
 * happens, releases the lock. Nothing here knows about the UI.
 */
export async function runTurn(options: TurnRunnerOptions, userText: string): Promise<void> {
  const { store, chain, node } = options;
  const turns = asTurnStore(store, options);
  const append = (input: AppendInput): Event => {
    const event = store.append(chain, { id: randomUUID(), node, type: input.type, data: input.data });
    options.onAppend(event);
    return event;
  };

  const lock = await acquire(turns, chain, node);
  if (lock.state === "busy") {
    append({ type: "error", data: { message: `${lock.owner} is already working on this chain` } });
    return;
  }

  try {
    const allEvents = store.read(chain, 1, 100_000);
    const history =
      options.session === undefined
        ? historyFromEvents(allEvents)
        : sessionMessages(allEvents, options.session).map((message) => ({
            role: message.role,
            content: message.text,
          }));
    // Long conversations stay affordable: past a window the older half leaves
    // the request as a digest attached to the prompt; the recent half rides
    // along whole. The hermes engine windows its own history, so this is the
    // builtin loop only.
    const asChat = history
      .filter(
        (message): message is { role: "user" | "assistant"; content: string } =>
          (message.role === "user" || message.role === "assistant") &&
          typeof message.content === "string",
      )
      .map((message): ChatMessage => ({ role: message.role, content: message.content }));
    const compacted = compactMessages(asChat, 40);
    const turnPrompt =
      compacted.digest === null
        ? options.systemPrompt
        : `${options.systemPrompt}\n\n# Earlier in this conversation (condensed)\n\n${compacted.digest}`;
    let answer = "";
    // A turn that ends without an explanation is a silent bug to a reader.
    // The error events of this turn say why it went nowhere; when none did,
    // the turn itself reports that it came back empty.
    let failed = false;

    if (options.engine === "hermes") {
      // The engine keeps its own tool loop; the chain keeps the conversation.
      const result = await runHermesTurn({
        prompt: userText,
        cwd: options.cwd,
        history: history
          .filter((message) => message.role === "user" || message.role === "assistant")
          .map((message) => ({
            role: message.role as "user" | "assistant",
            text: typeof message.content === "string" ? message.content : "",
          }))
          .filter((message) => message.text.length > 0)
          .slice(-20),
        ...(options.provider.model.length > 0 ? { model: options.provider.model } : {}),
      });
      if (result.text.length > 0) append({ type: "assistant", data: { text: result.text } });
      else append({ type: "error", data: { message: "the engine returned no answer" } });
      return;
    }

    const agent = new Agent({
      provider: options.provider,
      tools: [...(options.tools ?? allTools())],
      systemPrompt: turnPrompt,
      cwd: options.cwd,
      history: compacted.recent as typeof history,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      onEvent: (event) => {
        switch (event.type) {
          case "assistant_text":
            answer += event.text;
            break;
          case "tool_start":
            append({ type: "tool_call", data: { name: event.name, args: event.args } });
            break;
          case "tool_end":
            append({ type: "tool_result", data: { name: event.name, ok: event.ok, output: event.output } });
            break;
          case "error":
            failed = true;
            append({ type: "error", data: { message: event.message } });
            break;
          default:
            break;
        }
      },
    });

    await agent.send(userText, options.image);
    if (answer.trim()) append({ type: "assistant", data: { text: answer } });
    else if (!failed) append({ type: "error", data: { message: "the turn ended without an answer" } });
  } catch (err) {
    // A cancelled turn is not a failure: the user stopped it on purpose.
    if (options.signal?.aborted === true) {
      append({ type: "error", data: { message: "stopped by you" } });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    append({ type: "error", data: { message } });
  } finally {
    try {
      await release(turns, chain, node);
    } catch {
      // the turn already ended or was reclaimed; the chain is still consistent
    }
  }
}