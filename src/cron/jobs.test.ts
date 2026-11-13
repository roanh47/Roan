import assert from "node:assert/strict";
import { test } from "node:test";
import { dueJobs, parseInterval, type CronJob } from "./jobs.js";

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
