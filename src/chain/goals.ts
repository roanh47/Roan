/**
 * Standing orders: what the person told the agent to keep doing.
 *
 * A `goal` event creates or rewrites a goal; `goal_update` moves its status and
 * leaves a note. Both are folded the same way everywhere, so every device in
 * the chain agrees on which orders are still open, and a session that starts
 * later can be handed the list before the first message.
 *
 * The fold is pure: only the events themselves are read — no store, no clock.
 */

/** The minimum a goal fold needs; the chain's Event satisfies it, and so does the web client's. */
export interface GoalEventLike {
  readonly type: string;
  readonly data: unknown;
  /** Chain timestamp; used as the goal's createdAt when the payload has none. */
  readonly ts?: number;
}

/** Where a goal stands. `open` is the only state that reaches the prompt. */
export type GoalStatus = "open" | "done" | "cancelled";

/** One standing order, as folded from the chain. */
export interface Goal {
  readonly id: string;
  readonly text: string;
  readonly status: GoalStatus;
  /** Chain timestamp of the `goal` event that introduced it; ordering key. */
  readonly createdAt: number;
  /** Last note from a `goal_update`, when there was one. */
  readonly note?: string;
}

const STATUSES: ReadonlySet<string> = new Set<GoalStatus>(["open", "done", "cancelled"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asStatus(value: unknown): GoalStatus | null {
  return typeof value === "string" && STATUSES.has(value) ? (value as GoalStatus) : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** One goal with the fields overridden only where `next` says something. */
function withNote(goal: Omit<Goal, "note">, note: string | undefined): Goal {
  return note === undefined ? goal : { ...goal, note };
}

/** Oldest first, id as the tie-break so two clocks that agree still order. */
function byCreatedAt(a: Goal, b: Goal): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The goals in the chain, newest event per goal winning and the list ordered
 * by `createdAt`.
 *
 * A `goal_update` for an id that no `goal` event ever introduced is ignored:
 * an update can only change something that exists. A `goal` event for an id
 * already present rewrites the fields it carries and keeps the rest, so a
 * rename or a status flip does not lose the text or the creation time.
 */
export function foldGoals(events: readonly GoalEventLike[]): Goal[] {
  const byId = new Map<string, Goal>();

  for (const event of events) {
    if (event.type === "goal") {
      const data = asRecord(event.data);
      if (data === null) continue;
      const id = nonEmptyString(data["id"]);
      if (id === null) continue;

      const previous = byId.get(id);
      const text = typeof data["text"] === "string" ? data["text"] : previous?.text ?? "";
      const status = asStatus(data["status"]) ?? previous?.status ?? "open";
      const createdAt = finiteNumber(data["createdAt"]) ?? previous?.createdAt ?? event.ts ?? Date.now();
      const note = typeof data["note"] === "string" ? data["note"] : previous?.note;

      byId.set(id, withNote({ id, text, status, createdAt }, note));
      continue;
    }

    if (event.type !== "goal_update") continue;
    const data = asRecord(event.data);
    if (data === null) continue;
    const id = nonEmptyString(data["goal"]);
    if (id === null) continue;
    const previous = byId.get(id);
    if (previous === undefined) continue;

    const status = asStatus(data["status"]) ?? previous.status;
    const note = typeof data["note"] === "string" ? data["note"] : previous.note;

    byId.set(id, withNote({ ...previous, status }, note));
  }

  return [...byId.values()].sort(byCreatedAt);
}

/** The goals still open, in folded order. Closed ones stay in the chain. */
export function activeGoals(goals: readonly Goal[]): Goal[] {
  return goals.filter((goal) => goal.status === "open");
}

/**
 * The block a new session prepends so the agent knows its standing orders.
 *
 * Empty string when nothing is open — a fresh chain adds nothing to the prompt.
 * Accepts either the full fold or an already filtered list; only open goals are
 * ever mentioned.
 */
export function goalContext(goals: readonly Goal[]): string {
  const open = activeGoals(goals);
  if (open.length === 0) return "";
  const lines = open.map((goal) => `- ${goal.text.trim().length > 0 ? goal.text.trim() : goal.id}`);
  return `Standing orders:\n${lines.join("\n")}`;
}
