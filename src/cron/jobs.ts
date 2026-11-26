import { promises as fs } from "node:fs";
import { join } from "node:path";
import { nextRunAt, parseSchedule, type Schedule } from "./schedule.js";

/**
 * Scheduled turns.
 *
 * A job is a prompt plus a rhythm, kept in `cron.json` next to the rest of the
 * agent so it travels with the chain. Each device runs the jobs it knows about;
 * the one that is awake does the work and the answer lands in the chain like any
 * other turn — which is what makes "while my laptop is off" work without a
 * cloud: the desktop keeps the schedule.
 *
 * Two rhythm spellings are accepted. `schedule` is the current one and speaks
 * the same language as the panel in the app (`every 30m`, `every 2h`,
 * `daily 07:30`); `every` is the older bare interval (`30m`, `2h`, `1d`) and
 * still works so a file written before `schedule` existed keeps firing.
 */
export interface CronJob {
  readonly id: string;
  readonly title: string;
  readonly prompt: string;
  /**
   * Older spelling: a bare interval such as `30m`, `2h`, `1d`. Ignored when
   * `schedule` is present, so a migrated job has exactly one meaning.
   */
  readonly every?: string;
  /** `every 30m`, `every 2h`, `daily 07:30` — see `parseSchedule`. */
  readonly schedule?: string;
  readonly enabled?: boolean;
}

export interface CronState {
  readonly jobs: readonly CronJob[];
}

export function parseInterval(value: string): number | null {
  const match = /^(\d+)(s|m|h|d)$/.exec(value.trim());
  if (match === null) return null;
  const amount = Number(match[1]);
  const unit = match[2];
  const factor = unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return amount * factor;
}

/** The parsed `schedule` of a job, or null when it has none or it is unreadable. */
export function jobSchedule(job: CronJob): Schedule | null {
  return typeof job.schedule === "string" ? parseSchedule(job.schedule) : null;
}

/**
 * Jobs that name a `schedule` nobody can parse.
 *
 * They are skipped rather than guessed at: a daily job misread as an hourly one
 * would answer four times a day, and a typo must not turn into a rhythm. The
 * daemon logs these once; `dueJobs` keeps quiet so the fold stays pure.
 */
export function unparseableSchedule(jobs: readonly CronJob[]): CronJob[] {
  return jobs.filter((job) => typeof job.schedule === "string" && parseSchedule(job.schedule) === null);
}

export async function loadCron(home: string): Promise<CronJob[]> {
  try {
    const raw = await fs.readFile(join(home, "cron.json"), "utf8");
    const parsed = JSON.parse(raw) as CronState;
    if (!Array.isArray(parsed.jobs)) return [];
    return parsed.jobs.filter(
      (job): job is CronJob =>
        typeof job?.id === "string" &&
        typeof job?.title === "string" &&
        typeof job?.prompt === "string" &&
        (typeof job?.schedule === "string" || typeof job?.every === "string"),
    );
  } catch {
    return [];
  }
}

/**
 * Which jobs are due, given when each last ran.
 *
 * A job that never ran is due: a newly added job should do its work now rather
 * than wait a day for its first daily slot. After that the schedule governs.
 * A job whose rhythm cannot be read never runs — the caller reports it.
 */
export function dueJobs(
  jobs: readonly CronJob[],
  lastRun: ReadonlyMap<string, number>,
  now: number,
): CronJob[] {
  const due: CronJob[] = [];
  for (const job of jobs) {
    if (job.enabled === false) continue;
    const previous = lastRun.get(job.id);
    if (previous === undefined) {
      // Only jobs with a readable rhythm count as due; an unreadable one would
      // otherwise fire once per tick forever.
      if (typeof job.schedule === "string") {
        if (parseSchedule(job.schedule) !== null) due.push(job);
      } else if (typeof job.every === "string" && parseInterval(job.every) !== null) {
        due.push(job);
      }
      continue;
    }
    if (typeof job.schedule === "string") {
      const schedule = parseSchedule(job.schedule);
      if (schedule === null) continue;
      // The first firing strictly after the last run is the moment this job
      // became due; `daily` handles the wall clock and DST for us.
      if (now >= nextRunAt(schedule, previous)) due.push(job);
      continue;
    }
    const interval = parseInterval(job.every ?? "");
    if (interval === null) continue;
    if (now - previous >= interval) due.push(job);
  }
  return due;
}
