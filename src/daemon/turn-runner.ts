import { randomUUID } from "node:crypto";
import { Agent } from "../agent.js";
import type { EventStore } from "../chain/store.js";
import type { Event } from "../protocol/types.js";
import { allTools } from "../tools.js";
import type { ChatMessage as AgentMessage, Tool, TurnEndReason } from "../types.js";
import { acquire, release, SeqConflictError, type SteerInbox } from "../turn/index.js";
import type { Event as TurnEvent, TurnEventDraft, TurnStore } from "../turn/types.js";
import { historyFromEvents } from "./history.js";
import { sessionMessages } from "../chain/sessions.js";
import { compactMessages, type ChatMessage } from "../chain/compaction.js";
import type { EffortLevel } from "../providers/effort.js";
import type { TokenUsage } from "../usage.js";
import { PLAN_MODE_PROMPT, planModeForbidden, planModeRefusal, planModeTools } from "./plan.js";
import { createThought } from "./thought.js";
import { splitForCondensing, type PlainMessage } from "../context/condense.js";

export interface TurnRunnerOptions {
  readonly store: EventStore;
  readonly chain: string;
  readonly node: string;
  /** An image attached to this turn, base64; rides on the live message only. */
  readonly image?: { readonly mime: string; readonly data: string };
  readonly provider: {
    baseUrl: string;
    apiKey: string;
    model: string;
    /** Catalog id, so the loop can pick the right adapter and effort spelling. */
    readonly providerId?: string;
  };
  /**
   * Writes the summary of the older part of a long conversation. The caller
   * decides which model does it and remembers the answer; without it the
   * older part becomes a plain digest behind a fixed window.
   */
  readonly condenseOlder?: (older: readonly PlainMessage[]) => Promise<string>;
  /** A second model of the same provider, tried once when the first fails. */
  readonly fallbackModel?: string;
  /** How hard the model should think this turn; omitted means "normal". */
  readonly effort?: EffortLevel;
  readonly cwd: string;
  readonly systemPrompt: string;
  /** Tools this turn may use; the built-ins when a caller does not say. */
  readonly tools?: readonly Tool[];
  /** The conversation this turn belongs to; only its history is sent. */
  readonly session?: string;
  /**
   * Read-only plan mode for this turn. The tool list loses everything that
   * writes or executes, so the gate is the mode rather than the prompt.
   */
  readonly planMode?: boolean;
  /**
   * Where a message the owner sends while this turn runs waits. After each
   * tool round the loop takes it and appends it as the next user message, so a
   * correction lands between the tool results and the model's answer instead
   * of opening a second turn over the first one's head.
   */
  readonly steer?: SteerInbox;
  /** Called for every event the run produces, after it is durable. */
  readonly onAppend: (event: Event) => void;
  /** Aborts the turn; set by the cancel request the app sends. */
  readonly signal?: AbortSignal;
  /** The loop's step budget; omitted means the loop's own default. */
  readonly maxSteps?: number;
  /** How long the provider may stay silent before the turn is aborted. */
  readonly stallTimeoutMs?: number;
}

/**
 * Adapts the event store to the narrower shape the turn lock expects.
 *
 * `usage` is read when the lock closes the turn: the `turn_end` event is the
 * only place a turn's cost belongs, and this adapter is the one seam both the
 * lock's and the loop's appends pass through. No event type is added.
 */
function asTurnStore(
  store: EventStore,
  options: TurnRunnerOptions,
  usage: () => TokenUsage | null,
): TurnStore {
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
      const measured = usage();
      const event = store.append(chain, {
        id: randomUUID(),
        node: draft.node,
        type: draft.type,
        data: draft.type === "turn_end" && measured !== null ? { ...draft.data, usage: measured } : draft.data,
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
  // Filled once the loop has run; read by the store adapter when the lock
  // writes turn_end, which is the only event that can carry a turn's cost.
  const measured: { current: TokenUsage | null } = { current: null };
  const turns = asTurnStore(store, options, () => measured.current);
  const append = (input: AppendInput): Event => {
    const event = store.append(chain, { id: randomUUID(), node, type: input.type, data: input.data });
    options.onAppend(event);
    return event;
  };

  const steer = options.steer;
  /**
   * A steer is the owner's words, so the chain keeps them like any other
   * message — as an ordinary `message` event flagged `steer`, which is what the
   * app renders inline. The session tag keeps it in the conversation it was
   * typed into, so the next turn's replay sees it where it happened.
   */
  const recordSteer = (text: string): void => {
    append({
      type: "message",
      data: {
        text,
        steer: true,
        ...(options.session !== undefined ? { session: options.session } : {}),
      },
    });
  };

  // Why the loop stopped. The lock writes it into `turn_end`, so a turn that
  // ends is readable as *how* it ended; the engine path never reaches the
  // loop and keeps the lock's own word, `released`. A record, not a `let`:
  // the loop sets it from its event callback, where a plain local would be
  // narrowed away by the compiler.
  const outcome: { reason: TurnEndReason } = { reason: "released" };

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
    // along whole.
    const asChat = history
      .filter(
        (message): message is { role: "user" | "assistant"; content: string } =>
          (message.role === "user" || message.role === "assistant") &&
          typeof message.content === "string",
      )
      .map((message): ChatMessage => ({ role: message.role, content: message.content }));
    // With a summariser the boundary moves in steps and the summary holds
    // still in between, so most requests of a long conversation start with
    // the same text as the one before. Without one, the fixed window applies.
    let compacted: { digest: string | null; recent: readonly ChatMessage[] };
    if (options.condenseOlder !== undefined) {
      const split = splitForCondensing(asChat);
      compacted = {
        digest: split.older.length > 0 ? await options.condenseOlder(split.older) : null,
        recent: split.recent,
      };
    } else {
      compacted = compactMessages(asChat, 40);
    }
    const turnPrompt =
      compacted.digest === null || compacted.digest.length === 0
        ? options.systemPrompt
        : `${options.systemPrompt}\n\n# Earlier in this conversation (condensed)\n\n${compacted.digest}`;
    // Plan mode is enforced on the tool list, not on the wording: what the
    // model never sees cannot be called. The instruction rides along because a
    // planner that is not told it is planning writes a paragraph, not a plan.
    const planning = options.planMode === true;
    const offered = options.tools ?? allTools();
    const turnTools = planning ? [...planModeTools(offered, true)] : [...offered];
    const refused = new Map<string, string>(
      planning
        ? planModeForbidden(offered).map((tool) => [tool.name, planModeRefusal(tool.name)] as const)
        : [],
    );
    const guidedPrompt = planning ? `${PLAN_MODE_PROMPT}\n\n${turnPrompt}` : turnPrompt;
    let answer = "";
    const thought = createThought();
    // A turn that ends without an explanation is a silent bug to a reader.
    // The error events of this turn say why it went nowhere; when none did,
    // the turn itself reports that it came back empty.
    let failed = false;

    const agent = new Agent({
      provider: options.provider,
      ...(options.fallbackModel !== undefined &&
      options.fallbackModel.length > 0 &&
      options.fallbackModel !== options.provider.model
        ? { fallback: { ...options.provider, model: options.fallbackModel } }
        : {}),
      tools: turnTools,
      systemPrompt: guidedPrompt,
      cwd: options.cwd,
      history: compacted.recent as typeof history,
      ...(options.maxSteps !== undefined ? { maxSteps: options.maxSteps } : {}),
      ...(options.stallTimeoutMs !== undefined ? { stallTimeoutMs: options.stallTimeoutMs } : {}),
      ...(options.effort !== undefined ? { effort: options.effort } : {}),
      ...(refused.size > 0 ? { refusedTools: refused } : {}),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      ...(steer !== undefined
        ? {
            /**
             * The one legal place for a steer: after a round's tool results and
             * before the next request. The first request still ends with the
             * live question, and appending there would put two user messages in
             * a row — the agent refuses that, so this guard keeps it from ever
             * happening instead of relying on that refusal.
             */
            onBeforeRequest: (messages: AgentMessage[]) => {
              if (messages[messages.length - 1]?.role !== "tool") return;
              const pending = steer.take();
              if (pending === null) return;
              messages.push({ role: "user", content: pending });
              recordSteer(pending);
            },
          }
        : {}),
      onEvent: (event) => {
        switch (event.type) {
          case "assistant_text":
            answer += event.text;
            break;
          case "reasoning":
            thought.add(event.text);
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
          case "turn_end":
            outcome.reason = event.reason;
            break;
          default:
            break;
        }
      },
    });

    try {
      await agent.send(userText, options.image);
    } finally {
      // Also on a failed or cancelled turn: the requests that did reach the
      // model were still billed.
      measured.current = agent.usage;
      // What the model thought is kept next to what it said, as its own
      // event: the transcript folds it away and no replay ever reads it. A
      // provider that streams no reasoning leaves no event, not an empty one.
      const reasoning = thought.text();
      if (reasoning !== null) {
        append({
          type: "reasoning",
          data: { text: reasoning, ...(options.session !== undefined ? { session: options.session } : {}) },
        });
      }
    }
    // A turn the owner stopped says so, and says nothing else: the loop
    // already dropped whatever it was about to answer.
    if (outcome.reason === "interrupted") append({ type: "error", data: { message: "stopped by you" } });
    else if (answer.trim()) append({ type: "assistant", data: { text: answer } });
    else if (!failed) append({ type: "error", data: { message: "the turn ended without an answer" } });
  } catch (err) {
    // A cancelled turn is not a failure: the user stopped it on purpose.
    if (options.signal?.aborted === true) {
      outcome.reason = "interrupted";
      append({ type: "error", data: { message: "stopped by you" } });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    append({ type: "error", data: { message } });
  } finally {
    try {
      await release(turns, chain, node, { reason: outcome.reason });
    } catch {
      // the turn already ended or was reclaimed; the chain is still consistent
    }
    // A steer that arrived after the last request could not be seen by this
    // turn — the answer was already on its way. It is not dropped: it joins
    // the chain after the turn closed, exactly where the model reads the
    // owner's next message.
    for (const text of steer?.drain() ?? []) recordSteer(text);
  }
}