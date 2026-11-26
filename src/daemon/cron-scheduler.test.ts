import assert from "node:assert/strict";
import { test } from "node:test";
import { CronScheduler, DEFAULT_POLL_MS, type CronRun, type ScheduledJob } from "./cron-scheduler.js";
import { createFakeClock } from "../testing/fake-clock.js";

const MINUTE = 60_000;

function job(id: string, schedule: string, extra: Partial<ScheduledJob> = {}): ScheduledJob {
  return { id, prompt: `prompt for ${id}`, schedule, enabled: true, ...extra };
}

/** A scheduler on a hand-wound clock, with the runs it produced. */
function harness(jobs: readonly ScheduledJob[], options: { onRun?: (run: CronRun) => void | Promise<void> } = {}) {
  const clock = createFakeClock("2026-05-04T09:00:00");
  const runs: CronRun[] = [];
  const logged: string[] = [];
  const scheduler = new CronScheduler({
    jobs: () => jobs,
    now: () => clock.now(),
    log: (message) => logged.push(message),
    runner: async (run) => {
      runs.push(run);
      await options.onRun?.(run);
    },
  });
  return { clock, runs, logged, scheduler };
}

test("a job first seen is scheduled, not fired", async () => {
  const { scheduler, runs } = harness([job("a", "every 30m")]);
  assert.deepEqual(await scheduler.tick(), []);
  assert.equal(runs.length, 0);
});

test("a job fires once its interval has gone by, with its prompt", async () => {
  const { scheduler, runs, clock } = harness([job("a", "every 30m")]);
  await scheduler.tick();
  clock.advance(29 * MINUTE);
  assert.deepEqual(await scheduler.tick(), []);
  clock.advance(1 * MINUTE);

  const fired = await scheduler.tick();
  assert.equal(fired.length, 1);
  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.jobId, "a");
  assert.equal(runs[0]?.prompt, "prompt for a");
});

test("every firing gets a fresh session marker", async () => {
  const { scheduler, runs, clock } = harness([job("a", "every 30m")]);
  await scheduler.tick();
  const seed = clock.now();
  clock.advance(30 * MINUTE);
  await scheduler.tick();
  clock.advance(30 * MINUTE);
  await scheduler.tick();

  assert.equal(runs.length, 2);
  const first = runs[0]?.session;
  const second = runs[1]?.session;
  assert.equal(typeof first, "string");
  assert.equal(typeof second, "string");
  assert.notEqual(first, second);
  assert.match(first ?? "", /^cron:a:\d+:\d+$/);
  assert.equal(first, `cron:a:${String(seed + 30 * MINUTE)}:1`);
  assert.equal(second, `cron:a:${String(seed + 60 * MINUTE)}:2`);
});

test("two ticks in the same minute fire the job once", async () => {
  const { scheduler, runs, clock } = harness([job("a", "every 1m")]);
  await scheduler.tick();
  clock.advance(MINUTE);

  const first = await scheduler.tick();
  clock.advance(1);
  const second = await scheduler.tick();
  clock.advance(58_999);
  const third = await scheduler.tick();

  assert.equal(first.length, 1);
  assert.deepEqual(second, []);
  assert.deepEqual(third, []);
  assert.equal(runs.length, 1);
});

test("a tick that overlaps a running tick fires nothing", async () => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const clock = createFakeClock("2026-05-04T09:00:00");
  const runs: CronRun[] = [];
  const scheduler = new CronScheduler({
    jobs: () => [job("slow", "every 1m")],
    now: () => clock.now(),
    runner: async (run) => {
      runs.push(run);
      await gate;
    },
  });

  await scheduler.tick();
  clock.advance(MINUTE);

  const inFlight = scheduler.tick();
  clock.advance(1);
  assert.deepEqual(await scheduler.tick(), []);
  release?.();
  const finished = await inFlight;

  assert.equal(finished.length, 1);
  assert.equal(runs.length, 1);
});

test("a disabled job never fires", async () => {
  const { scheduler, runs, clock } = harness([job("off", "every 30m", { enabled: false })]);
  await scheduler.tick();
  clock.advance(10 * 24 * 60 * MINUTE);
  assert.deepEqual(await scheduler.tick(), []);
  assert.equal(runs.length, 0);
});

test("a job with an unreadable schedule is skipped and logged", async () => {
  const { scheduler, runs, logged, clock } = harness([job("bad", "elke dag om 7 uur")]);
  await scheduler.tick();
  clock.advance(10 * 24 * 60 * MINUTE);
  assert.deepEqual(await scheduler.tick(), []);
  assert.equal(runs.length, 0);
  assert.ok(logged.some((line) => line.includes("\"bad\"") && line.includes("schedule")));
});

test("daily jobs fire at the local wall-clock minute, once, then tomorrow", async () => {
  const clock = createFakeClock("2026-05-04T07:00:00");
  const runs: CronRun[] = [];
  const scheduler = new CronScheduler({
    jobs: () => [job("ochtend", "daily 07:30")],
    now: () => clock.now(),
    runner: (run) => {
      runs.push(run);
    },
  });

  await scheduler.tick(); // 07:00 — seeds
  clock.advance(30 * MINUTE); // 07:30
  assert.equal((await scheduler.tick()).length, 1);
  clock.advance(30 * MINUTE); // 08:00 same day
  assert.deepEqual(await scheduler.tick(), []);
  clock.set("2026-05-05T07:29:00"); // next day, one minute early
  assert.deepEqual(await scheduler.tick(), []);
  clock.set("2026-05-05T07:30:00");
  assert.equal((await scheduler.tick()).length, 1);
  assert.equal(runs.length, 2);
});

test("daily jobs fire across midnight", async () => {
  const clock = createFakeClock("2026-05-04T23:00:00");
  const runs: CronRun[] = [];
  const scheduler = new CronScheduler({
    jobs: () => [job("nacht", "daily 00:15")],
    now: () => clock.now(),
    runner: (run) => {
      runs.push(run);
    },
  });
  await scheduler.tick(); // 23:00 — seeds 00:15 tomorrow
  clock.set("2026-05-05T00:15:00");
  assert.equal((await scheduler.tick()).length, 1);
  assert.equal(runs.length, 1);
});

test("one failing runner does not stop the other jobs or retry in a loop", async () => {
  const clock = createFakeClock("2026-05-04T09:00:00");
  const runs: CronRun[] = [];
  const logged: string[] = [];
  const scheduler = new CronScheduler({
    jobs: () => [job("boom", "every 1m"), job("fine", "every 1m")],
    now: () => clock.now(),
    log: (message) => logged.push(message),
    runner: (run) => {
      if (run.jobId === "boom") throw new Error("runner exploded");
      runs.push(run);
    },
  });

  await scheduler.tick();
  clock.advance(MINUTE);
  const fired = await scheduler.tick();
  assert.deepEqual(
    fired.map((run) => run.jobId),
    ["boom", "fine"],
  );
  assert.equal(runs.length, 1);

  clock.advance(1);
  assert.deepEqual(await scheduler.tick(), []);
  assert.equal(logged.filter((line) => line.includes("boom")).length, 1);
});

test("start arms one timer and stop clears it", async () => {
  const clock = createFakeClock("2026-05-04T09:00:00");
  const armed: { callback: () => void; intervalMs: number }[] = [];
  const cleared: unknown[] = [];
  const runs: CronRun[] = [];
  const scheduler = new CronScheduler({
    jobs: () => [job("a", "every 1m")],
    now: () => clock.now(),
    intervalMs: 1_000,
    timers: {
      setInterval(callback, intervalMs) {
        armed.push({ callback, intervalMs });
        return "handle-1";
      },
      clearInterval(handle) {
        cleared.push(handle);
      },
    },
    runner: (run) => {
      runs.push(run);
    },
  });

  assert.equal(scheduler.started, false);
  scheduler.start();
  scheduler.start();
  assert.equal(scheduler.started, true);
  assert.equal(armed.length, 1);
  assert.equal(armed[0]?.intervalMs, 1_000);

  await scheduler.tick(); // seed
  clock.advance(MINUTE);
  armed[0]?.callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs.length, 1);

  scheduler.stop();
  scheduler.stop();
  assert.equal(scheduler.started, false);
  assert.deepEqual(cleared, ["handle-1"]);
});

test("the default poll interval is 30 seconds and a bad one is refused", () => {
  assert.equal(DEFAULT_POLL_MS, 30_000);
  assert.throws(() => new CronScheduler({ runner: () => undefined, intervalMs: 0 }), /positive number/);
  assert.throws(() => new CronScheduler({ runner: () => undefined, intervalMs: Number.NaN }), /positive number/);
});

test("setJobs swaps the list and forgets state for jobs that left", async () => {
  const { scheduler, runs, clock } = harness([job("old", "every 30m")]);
  await scheduler.tick();
  clock.advance(30 * MINUTE);

  scheduler.setJobs([job("new", "every 30m")]);
  assert.deepEqual(await scheduler.tick(), []);
  assert.equal(runs.length, 0);

  clock.advance(30 * MINUTE);
  const fired = await scheduler.tick();
  assert.deepEqual(
    fired.map((run) => run.jobId),
    ["new"],
  );
});
