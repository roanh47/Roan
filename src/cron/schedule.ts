/**
 * When a background task runs, as data.
 *
 * A spec is the short form a person types — `every 30m`, `every 2h`,
 * `daily 07:30` — not a cron expression. `parseSchedule` turns it into a
 * normalised object or null, and `nextRunAt` answers the only question the
 * scheduler asks: given a clock reading, when is this due next?
 *
 * Nothing here reads the clock itself: `now` is always an argument, so the
 * whole module is pure and a test can aim it at any minute of any day.
 */

/** Repeat every `minutes` minutes, measured from the previous firing. */
export interface EverySchedule {
  readonly kind: "every";
  readonly minutes: number;
}

/** A wall-clock moment, once a day, in the machine's local time. */
export interface DailySchedule {
  readonly kind: "daily";
  readonly hour: number;
  readonly minute: number;
}

export type Schedule = EverySchedule | DailySchedule;

/** Longest accepted repeat: a day. Anything longer belongs in `daily`. */
export const MAX_EVERY_MINUTES = 24 * 60;

/** `every <n>m` / `every <n>h`, case-insensitive, one space or more. */
const EVERY = /^every\s+(\d+)\s*(m|h)$/i;
/** `daily HH:MM`, one or two hour digits, exactly two minute digits. */
const DAILY = /^daily\s+(\d{1,2}):(\d{2})$/i;

/**
 * Reads a schedule spec.
 *
 * Returns null for anything it does not understand rather than guessing: a
 * job with a spec nobody can parse must not be silently rescheduled to some
 * near-enough rhythm. Ranges are checked, so `every 0m`, `daily 24:00` and
 * `daily 07:60` are all rejected.
 */
export function parseSchedule(spec: string): Schedule | null {
  if (typeof spec !== "string") return null;
  const text = spec.trim();

  const every = EVERY.exec(text);
  if (every !== null) {
    const amount = Number(every[1]);
    const unit = every[2]?.toLowerCase();
    const minutes = unit === "h" ? amount * 60 : amount;
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_EVERY_MINUTES) return null;
    return { kind: "every", minutes };
  }

  const daily = DAILY.exec(text);
  if (daily !== null) {
    const hour = Number(daily[1]);
    const minute = Number(daily[2]);
    if (hour > 23 || minute > 59) return null;
    return { kind: "daily", hour, minute };
  }

  return null;
}

/**
 * The first firing strictly after `now`.
 *
 * `every` counts from `now`, so a job first seen at boot waits one full
 * interval instead of firing the moment the app opens. `daily` is the next
 * time the local clock reads `hour:minute`; when the clock is already at that
 * minute the answer is tomorrow, which is what keeps a minute of polling from
 * turning into two runs.
 *
 * The date is built from local calendar fields rather than by adding 24 hours,
 * so a day that is 23 or 25 hours long (daylight saving) still fires at the
 * wall-clock time the person asked for.
 */
export function nextRunAt(schedule: Schedule, now: number): number {
  if (!Number.isFinite(now)) {
    throw new Error(`nextRunAt: now must be a finite epoch in ms, got ${String(now)}`);
  }

  if (schedule.kind === "every") {
    if (!Number.isInteger(schedule.minutes) || schedule.minutes < 1) {
      throw new Error(`nextRunAt: every-minutes must be a positive integer, got ${String(schedule.minutes)}`);
    }
    return now + schedule.minutes * 60_000;
  }

  const { hour, minute } = schedule;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new Error(`nextRunAt: daily time must be a valid 24h clock time, got ${String(hour)}:${String(minute)}`);
  }

  const current = new Date(now);
  const todayAt = new Date(
    current.getFullYear(),
    current.getMonth(),
    current.getDate(),
    hour,
    minute,
    0,
    0,
  ).getTime();
  if (todayAt > now) return todayAt;

  // `Date` normalises day 32 and month overflow, and keeps the wall-clock
  // fields across a DST shift.
  return new Date(
    current.getFullYear(),
    current.getMonth(),
    current.getDate() + 1,
    hour,
    minute,
    0,
    0,
  ).getTime();
}
