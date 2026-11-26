/**
 * The background-task screen's data, without React.
 *
 * The panel is a view: it receives jobs and callbacks and never fetches or
 * mutates the chain itself. These helpers are the parts worth testing on their
 * own — a toggle that hits one job, a delete that removes one, and the check
 * that stops an empty or unreadable draft from being sent up.
 */

import { parseSchedule } from "../../../src/cron/schedule.js";

/** One scheduled task as the chain hands it to the app. */
export interface BackgroundJob {
  readonly id: string;
  readonly prompt: string;
  /** A spec string: `every 30m`, `every 2h`, `daily 07:30`. */
  readonly schedule: string;
  readonly enabled: boolean;
}

/** Flips one job's switch, leaving the others alone. */
export function setJobEnabled(
  jobs: readonly BackgroundJob[],
  id: string,
  enabled: boolean,
): BackgroundJob[] {
  return jobs.map((job) => (job.id === id ? { ...job, enabled } : job));
}

/** Drops one job by id; an unknown id is a no-op, not an error. */
export function removeJob(jobs: readonly BackgroundJob[], id: string): BackgroundJob[] {
  return jobs.filter((job) => job.id !== id);
}

/** The one-line summary under a job: its rhythm and whether it is on. */
export function describeJob(job: BackgroundJob): string {
  return `${job.schedule} · ${job.enabled ? "on" : "paused"}`;
}

/** What is wrong with a draft, or null when it can be sent. */
export function validateDraft(draft: { prompt: string; schedule: string }): string | null {
  if (draft.prompt.trim().length === 0) return "A prompt, please: what should he do?";
  if (draft.schedule.trim().length === 0) return "A schedule, please.";
  if (parseSchedule(draft.schedule) === null) return "Use \"every 30m\", \"every 2h\" or \"daily 07:30\".";
  return null;
}
