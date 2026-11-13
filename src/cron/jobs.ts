import { promises as fs } from "node:fs";
import { join } from "node:path";

/**
 * Scheduled turns.
 *
 * A job is a prompt plus a rhythm, kept in `cron.json` next to the rest of the
 * agent so it travels with the chain. Each device runs the jobs it knows about;
 * the one that is awake does the work and the answer lands in the chain like any
 * other turn — which is what makes "while my laptop is off" work without a
 * cloud: the desktop keeps the schedule.
 */
export interface CronJob {
  readonly id: string;
  readonly title: string;
  readonly prompt: string;
  /** "30m", "2h", "1d" — deliberately not a full cron expression. */
  readonly every: string;
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

export async function loadCron(home: string): Promise<CronJob[]> {
  try {
    const raw = await fs.readFile(join(home, "cron.json"), "utf8");
    const parsed = JSON.parse(raw) as CronState;
    if (!Array.isArray(parsed.jobs)) return [];
    return parsed.jobs.filter(
      (job): job is CronJob =>
        typeof job?.id === "string" &&
        typeof job?.prompt === "string" &&
        typeof job?.every === "string" &&
        typeof job?.title === "string",
    );
  } catch {
    return [];
  }
}

/** Which jobs are due, given when each last ran. */
export function dueJobs(
  jobs: readonly CronJob[],
  lastRun: ReadonlyMap<string, number>,
  now: number,
): CronJob[] {
  const due: CronJob[] = [];
  for (const job of jobs) {
    if (job.enabled === false) continue;
    const interval = parseInterval(job.every);
    if (interval === null) continue;
    const previous = lastRun.get(job.id);
    if (previous === undefined || now - previous >= interval) due.push(job);
  }
  return due;
}
