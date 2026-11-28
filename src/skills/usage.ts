/**
 * Which skills are actually used.
 *
 * Every time the agent opens a skill it calls `skill_view`, and that call is
 * a `tool_call` event in the chain. Counting those is the whole curator: a
 * skill that is opened often is earning its place, one that never is either
 * has a description that does not say when to use it, or is not needed. The
 * owner sees the numbers and decides; nothing is removed on its own.
 *
 * Pure: events in, counts out.
 */

export interface UsageEventLike {
  readonly type: string;
  readonly data: unknown;
  readonly ts?: number;
}

export interface SkillUse {
  readonly uses: number;
  /** When it was last opened, in milliseconds; null when the event had no time. */
  readonly lastUsed: number | null;
}

function nameFromArgs(args: unknown): string | null {
  let parsed: unknown = args;
  if (typeof args === "string") {
    try {
      parsed = JSON.parse(args);
    } catch {
      return null;
    }
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const name = (parsed as Record<string, unknown>)["name"];
  return typeof name === "string" && name.trim().length > 0 ? name.trim() : null;
}

/** How often each skill was opened, by name. */
export function skillUsage(events: readonly UsageEventLike[]): Map<string, SkillUse> {
  const usage = new Map<string, SkillUse>();
  for (const event of events) {
    if (event.type !== "tool_call") continue;
    if (typeof event.data !== "object" || event.data === null) continue;
    const data = event.data as Record<string, unknown>;
    if (data["name"] !== "skill_view") continue;
    const skill = nameFromArgs(data["args"]);
    if (skill === null) continue;
    const before = usage.get(skill);
    const at = typeof event.ts === "number" && Number.isFinite(event.ts) ? event.ts : null;
    usage.set(skill, {
      uses: (before?.uses ?? 0) + 1,
      lastUsed: at ?? before?.lastUsed ?? null,
    });
  }
  return usage;
}

/** What the curator says about one skill, in words for the owner. */
export function skillVerdict(use: SkillUse | undefined, now: number, staleAfterMs: number = 30 * 24 * 3_600_000): string {
  if (use === undefined || use.uses === 0) return "never used";
  const times = use.uses === 1 ? "used once" : `used ${String(use.uses)} times`;
  if (use.lastUsed !== null && now - use.lastUsed > staleAfterMs) return `${times}, not in the last month`;
  return times;
}
