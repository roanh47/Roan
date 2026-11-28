import { normalizeUsage } from "../../src/usage.js";

/**
 * What Roan used, added up from the chain.
 *
 * Every finished turn records the tokens it cost on its `turn_end` event.
 * This folds those into the numbers a person asks for: today, the last
 * seven days, everything, and a line per day. Pure: events in, totals out.
 */

export interface UsageEventLike {
  readonly type: string;
  readonly ts: number;
  readonly data: unknown;
}

export interface Totals {
  readonly turns: number;
  readonly input: number;
  readonly output: number;
}

export interface DayTotals extends Totals {
  /** Local calendar day, `YYYY-MM-DD`. */
  readonly day: string;
}

export interface UsageSummary {
  readonly today: Totals;
  readonly week: Totals;
  readonly all: Totals;
  /** Newest day first. */
  readonly days: readonly DayTotals[];
}

const NONE: Totals = { turns: 0, input: 0, output: 0 };

function dayOf(ts: number): string {
  const date = new Date(ts);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function add(total: Totals, input: number, output: number): Totals {
  return { turns: total.turns + 1, input: total.input + input, output: total.output + output };
}

export function summariseUsage(events: readonly UsageEventLike[], now: number = Date.now()): UsageSummary {
  const byDay = new Map<string, Totals>();
  let all = NONE;
  let week = NONE;
  const today = dayOf(now);
  const weekStart = now - 7 * 24 * 3_600_000;

  for (const event of events) {
    if (event.type !== "turn_end") continue;
    const usage = normalizeUsage(
      typeof event.data === "object" && event.data !== null ? (event.data as Record<string, unknown>)["usage"] : null,
    );
    if (usage === null) continue;
    const day = dayOf(event.ts);
    byDay.set(day, add(byDay.get(day) ?? NONE, usage.input, usage.output));
    all = add(all, usage.input, usage.output);
    if (event.ts >= weekStart) week = add(week, usage.input, usage.output);
  }

  const days = [...byDay.entries()]
    .map(([day, totals]) => ({ day, ...totals }))
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
  return { today: byDay.get(today) ?? NONE, week, all, days };
}

/** 1234567 → "1.2M", 12345 → "12k", 950 → "950". */
export function compactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${String(Math.round(value / 1000))}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(Math.round(value));
}
