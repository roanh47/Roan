/**
 * The background-task clock.
 *
 * A scheduler is a list of jobs plus a runner: every time it is asked to
 * `tick()` it looks at the clock, works out which jobs are due, and calls the
 * runner once per job with the prompt and a marker for the turn that firing
 * belongs to. It owns no real clock and no real timer unless you give it one,
 * so a test drives it with a hand-wound clock and `start()`/`stop()` are
 * checked against a fake timer instead of the wall clock.
 *
 * Two rules keep a job from running twice for the same moment:
 *
 * - after firing, the job's next due time moves forward, and
 * - the minute a job fired in is remembered, so a second tick in that same
 *   minute is a no-op even if the schedule is shorter than the polling
 *   interval or two ticks overlap.
 *
 * A job first seen by the scheduler is only scheduled, never fired: an app
 * that starts at 09:14 does not replay the 07:30 job it was closed for.
 */

import { nextRunAt, parseSchedule, type Schedule } from "../cron/schedule.js";

/** One background task as the chain stores it. `schedule` is a spec string. */
export interface ScheduledJob {
  readonly id: string;
  readonly prompt: string;
  /** `every 30m`, `every 2h`, `daily 07:30`. */
  readonly schedule: string;
  readonly enabled: boolean;
}

/** One firing, as handed to the runner. */
export interface CronRun {
  readonly jobId: string;
  readonly prompt: string;
  /**
   * Fresh per firing, stable once made: identifies the turn this run belongs
   * to, so the daemon can start a session for it and the next firing gets its
   * own. Never reused, which is what makes two runs of one job two sessions.
   */
  readonly session: string;
  /** Clock reading the firing was decided on, in epoch ms. */
  readonly firedAt: number;
}

/** Called once per fired job. May be async; a rejection is logged, not fatal. */
export type CronRunner = (run: CronRun) => void | Promise<void>;

/** Where jobs come from. May be async so the daemon can re-read its file. */
export type CronJobSource = () => readonly ScheduledJob[] | Promise<readonly ScheduledJob[]>;

/** Timer seam; production passes `setInterval`, tests pass a fake. */
export interface CronTimers {
  setInterval(callback: () => void, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface CronSchedulerOptions {
  readonly runner: CronRunner;
  /** Defaults to an empty list; use `setJobs` or pass a source. */
  readonly jobs?: CronJobSource;
  /** Clock seam; defaults to `Date.now`. */
  readonly now?: () => number;
  /** Timer seam; defaults to Node's `setInterval`. */
  readonly timers?: CronTimers;
  /** Polling interval used by `start()`; defaults to 30 s. */
  readonly intervalMs?: number;
  /** Where failures go; defaults to silence (the core never prints). */
  readonly log?: (message: string) => void;
}

/** How often `start()` wakes up when the caller has no opinion. */
export const DEFAULT_POLL_MS = 30_000;

const nodeTimers: CronTimers = {
  setInterval(callback, intervalMs) {
    return setInterval(callback, intervalMs);
  },
  clearInterval(handle) {
    clearInterval(handle as ReturnType<typeof setInterval>);
  },
};

const EMPTY: readonly ScheduledJob[] = [];

function checkInterval(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`cron scheduler intervalMs must be a positive number, got ${String(value)}`);
  }
  return value;
}

export class CronScheduler {
  private readonly runner: CronRunner;
  private readonly now: () => number;
  private readonly timers: CronTimers;
  private readonly log: (message: string) => void;
  private readonly intervalMs: number;
  private source: CronJobSource;

  /** Next due time per job id, in epoch ms. */
  private readonly due = new Map<string, number>();
  /** Minute bucket a job last fired in, for the same-minute guard. */
  private readonly firedMinute = new Map<string, number>();
  private handle: unknown = undefined;
  private running = false;
  private ticking = false;
  private firings = 0;

  constructor(options: CronSchedulerOptions) {
    this.runner = options.runner;
    this.now = options.now ?? (() => Date.now());
    this.timers = options.timers ?? nodeTimers;
    this.log = options.log ?? (() => undefined);
    this.intervalMs = checkInterval(options.intervalMs ?? DEFAULT_POLL_MS);
    this.source = options.jobs ?? (() => EMPTY);
  }

  /** Replace the job list with a fixed one (the daemon re-reads its chain). */
  setJobs(jobs: readonly ScheduledJob[]): void {
    this.source = () => jobs;
    this.forgetMissing(new Set(jobs.map((job) => job.id)));
  }

  /** True while a polling timer is armed. */
  get started(): boolean {
    return this.running;
  }

  /**
   * One pass of the clock: fire every enabled, parseable job whose time has
   * come, and return what fired. Safe to call while a previous pass is still
   * awaiting its runner — the second call does nothing.
   */
  async tick(): Promise<CronRun[]> {
    if (this.ticking) return [];
    this.ticking = true;
    try {
      const now = this.now();
      const minute = Math.floor(now / 60_000);
      const jobs = await this.source();
      this.forgetMissing(new Set(jobs.map((job) => job.id)));

      const fired: CronRun[] = [];
      for (const job of jobs) {
        if (job.enabled === false) continue;
        const schedule = parseSchedule(job.schedule);
        if (schedule === null) {
          this.log(`cron: job "${job.id}" has no usable schedule (${JSON.stringify(job.schedule)})`);
          continue;
        }

        const dueAt = this.due.get(job.id);
        if (dueAt === undefined) {
          // First sight: schedule it, do not run it.
          this.due.set(job.id, nextRunAt(schedule, now));
          continue;
        }
        if (now < dueAt) continue;
        if (this.firedMinute.get(job.id) === minute) continue;

        this.advance(job.id, schedule, now, minute);
        fired.push(await this.fire(job, now));
      }
      return fired;
    } finally {
      this.ticking = false;
    }
  }

  /** Arm the polling timer. Calling it twice is a no-op. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.handle = this.timers.setInterval(() => {
      void this.tick().catch((error: unknown) => this.log(`cron: ${String(error)}`));
    }, this.intervalMs);
  }

  /** Disarm the timer. Idempotent, and leaves the due times where they are. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    const handle = this.handle;
    this.handle = undefined;
    if (handle !== undefined) this.timers.clearInterval(handle);
  }

  /**
   * Moves the cursor before the run is awaited: a runner that takes longer
   * than the schedule must not be started again in the meantime.
   */
  private advance(id: string, schedule: Schedule, now: number, minute: number): void {
    this.due.set(id, nextRunAt(schedule, now));
    this.firedMinute.set(id, minute);
  }

  private async fire(job: ScheduledJob, now: number): Promise<CronRun> {
    this.firings += 1;
    const run: CronRun = {
      jobId: job.id,
      prompt: job.prompt,
      session: `cron:${job.id}:${now}:${this.firings}`,
      firedAt: now,
    };
    try {
      await this.runner(run);
    } catch (error) {
      // One failing job must not take the others down, and must not make the
      // scheduler retry in a loop: the cursor has already moved.
      this.log(`cron: job "${job.id}" failed: ${String(error)}`);
    }
    return run;
  }

  /** Drops state for jobs that vanished, so an id reused later starts clean. */
  private forgetMissing(ids: ReadonlySet<string>): void {
    for (const id of this.due.keys()) if (!ids.has(id)) this.due.delete(id);
    for (const id of this.firedMinute.keys()) if (!ids.has(id)) this.firedMinute.delete(id);
  }
}
