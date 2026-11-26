import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dueJobs,
  jobSchedule,
  parseInterval,
  unparseableSchedule,
  type CronJob,
} from "./jobs.js";

test("intervals are read, rubbish is not", () => {
  assert.equal(parseInterval("30m"), 1_800_000);
  assert.equal(parseInterval("2h"), 7_200_000);
  assert.equal(parseInterval("1d"), 86_400_000);
  assert.equal(parseInterval("90s"), 90_000);
  assert.equal(parseInterval("elke dag"), null);
});

test("a job that never ran is due, then waits its interval", () => {
  const job: CronJob = { id: "a", title: "Ochtend", prompt: "goedemorgen", every: "30m" };
  assert.equal(dueJobs([job], new Map(), 0).length, 1);
  assert.equal(dueJobs([job], new Map([["a", 0]]), 1_000).length, 0);
  assert.equal(dueJobs([job], new Map([["a", 0]]), 1_800_001).length, 1);
});

test("a disabled job never fires", () => {
  const job: CronJob = { id: "b", title: "Uit", prompt: "nee", every: "1m", enabled: false };
  assert.deepEqual(dueJobs([job], new Map(), Date.now()), []);
});

test("a legacy every-only job keeps firing without a schedule", () => {
  // A file written before `schedule` existed must not go quiet on upgrade.
  const job: CronJob = { id: "legacy", title: "Oud", prompt: "hoi", every: "90s" };
  assert.equal(dueJobs([job], new Map([["legacy", 0]]), 89_999).length, 0);
  assert.equal(dueJobs([job], new Map([["legacy", 0]]), 90_000).length, 1);
});

test("a schedule job follows its parsed rhythm", () => {
  const job: CronJob = { id: "s", title: "Wekker", prompt: "goedemorgen", schedule: "daily 07:30" };
  const day = (hour: number, minute: number): number =>
    new Date(2026, 0, 10, hour, minute, 0, 0).getTime();
  const yesterdayEvening = new Date(2026, 0, 9, 20, 0, 0, 0).getTime();

  // Last ran yesterday evening: today's 07:30 slot is the next one.
  assert.equal(dueJobs([job], new Map([["s", yesterdayEvening]]), day(7, 0)).length, 0);
  assert.equal(dueJobs([job], new Map([["s", yesterdayEvening]]), day(7, 31)).length, 1);
  // And once run, it waits for tomorrow.
  assert.equal(dueJobs([job], new Map([["s", day(7, 31)]]), day(20, 0)).length, 0);
});

test("every-style schedules are read by the same path", () => {
  const job: CronJob = { id: "e", title: "Elk half uur", prompt: "status", schedule: "every 30m" };
  const start = 1_000_000;
  assert.equal(dueJobs([job], new Map([["e", start]]), start + 1_799_999).length, 0);
  assert.equal(dueJobs([job], new Map([["e", start]]), start + 1_800_000).length, 1);
});

test("a schedule names one rhythm, even when every is also present", () => {
  const job: CronJob = {
    id: "both",
    title: "Beide",
    prompt: "kaas",
    every: "1m",
    schedule: "daily 07:30",
  };
  const startedAt = new Date(2026, 0, 10, 7, 31, 0, 0).getTime();
  assert.equal(jobSchedule(job)?.kind, "daily");
  // A minute later the legacy interval would fire; the schedule must win.
  assert.equal(dueJobs([job], new Map([["both", startedAt]]), startedAt + 61_000).length, 0);
});

test("an unparseable schedule is skipped and reported, never guessed", () => {
  const broken: CronJob = { id: "x", title: "Kapot", prompt: "oeps", schedule: "daily 25:00" };
  const alsoBroken: CronJob = { id: "y", title: "Ook", prompt: "oeps", schedule: "elke dag" };
  assert.deepEqual(dueJobs([broken, alsoBroken], new Map(), Date.now()), []);
  assert.deepEqual(
    unparseableSchedule([broken, alsoBroken]).map((job) => job.id),
    ["x", "y"],
  );
  assert.deepEqual(unparseableSchedule([]), []);
});

test("a job without any rhythm is not due and not reported as a bad schedule", () => {
  const job = { id: "n", title: "Leeg", prompt: "niets" } as CronJob;
  assert.deepEqual(dueJobs([job], new Map(), Date.now()), []);
  assert.deepEqual(unparseableSchedule([job]), []);
});
