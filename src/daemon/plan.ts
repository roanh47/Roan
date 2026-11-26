/**
 * Plan mode: one conversation at a time, the agent researches and writes a
 * plan, and nothing it does can touch the machine until the plan is approved.
 *
 * The mode is chain state, not a client setting. It travels as a `plan_mode`
 * event carrying `{ session, enabled }`, so every device folds the same answer
 * for the same conversation, and a device that was asleep during the toggle
 * still knows the mode when it wakes up.
 *
 * This file owns the event and the fold. The gate — which tools survive the
 * mode — lives in `plan-tools.ts` and is re-exported here, because a caller
 * wiring plan mode into a turn should not have to know there are two files.
 * Nothing in either touches a store, a socket or a renderer.
 *
 * Where it is wired: `src/daemon/main.ts` passes
 * `planMode: planModeEnabled(events, sessionId)` to `runTurn`, which withholds
 * the tools itself. The composer's toggle reaches the daemon as a `plan_mode`
 * control request, and the daemon answers it with `planModeEvent` (on) or
 * `approvePlan` (off).
 */

import type { EventType } from "../protocol/types.js";

export {
  isForbiddenInPlanMode,
  isReadOnlyTool,
  planModeForbidden,
  planModeRefusal,
  planModeTools,
} from "./plan-tools.js";

/** The one event type the frozen protocol knows for this feature. */
const PLAN_MODE: EventType = "plan_mode";

/** What a `plan_mode` event carries. */
export interface PlanModeData {
  /** The conversation the mode belongs to. */
  readonly session: string;
  /** True while the turn may not write or execute. */
  readonly enabled: boolean;
}

/** An appendable draft: exactly what the store takes for a `plan_mode` event. */
export interface PlanModePayload {
  readonly type: EventType;
  readonly data: PlanModeData;
}

/** Anything event-shaped; the fold does not care where it was read from. */
export interface PlanEventLike {
  readonly type: string;
  readonly data: unknown;
}

/**
 * The instruction that turns a model into a planner. It is what the builtin
 * loop reads, and the only thing a turn run by an engine Roan cannot gate
 * (a subprocess owning its own tools) ever receives — so it states the rule
 * instead of hinting at it.
 */
export const PLAN_MODE_PROMPT = [
  "# Plan mode (read-only)",
  "You are planning, not doing. You may read, list and search, and nothing else:",
  "do not write, edit or delete files and do not run commands.",
  "Answer with a concrete plan: the steps, the files each step touches, and the",
  "check that would prove it worked. The user approves the plan before anything",
  "is executed.",
].join("\n");

/** The event that puts a conversation in plan mode, or takes it out. */
export function planModeEvent(session: string, enabled: boolean): PlanModePayload {
  if (typeof session !== "string" || session.trim().length === 0) {
    throw new Error(`plan mode needs a session id, got ${JSON.stringify(session)}`);
  }
  if (typeof enabled !== "boolean") {
    throw new Error(`plan mode expects a boolean, got ${String(enabled)}`);
  }
  return { type: PLAN_MODE, data: { session, enabled } };
}

/**
 * Approving a plan is turning the mode off for that conversation, and nothing
 * more: the plan itself is already in the transcript, the approval is the
 * `enabled: false` that follows it. Returning the payload keeps the control
 * path pure — the caller appends it, this decides what it says.
 */
export function approvePlan(session: string): PlanModePayload {
  return planModeEvent(session, false);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Fold every `plan_mode` event into the state per conversation, newest wins.
 * A conversation with no event is simply not in the map, and reads as off.
 */
export function planModeFromEvents(events: readonly PlanEventLike[]): ReadonlyMap<string, boolean> {
  const state = new Map<string, boolean>();
  for (const event of events) {
    if (event.type !== PLAN_MODE) continue;
    const data = asRecord(event.data);
    if (data === null) continue;
    const session = data["session"];
    const enabled = data["enabled"];
    if (typeof session !== "string" || session.trim().length === 0) continue;
    if (typeof enabled !== "boolean") continue;
    state.set(session, enabled);
  }
  return state;
}

/** The folded state for one conversation; absent means off. */
export function planModeEnabled(events: readonly PlanEventLike[], session: string | undefined): boolean {
  if (session === undefined || session.length === 0) return false;
  return planModeFromEvents(events).get(session) === true;
}
