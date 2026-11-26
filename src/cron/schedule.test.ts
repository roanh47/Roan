import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_EVERY_MINUTES, nextRunAt, parseSchedule } from "./schedule.js";
import { createFakeClock } from "../testing/fake-clock.js";

/** Local wall-clock fields, so the assertions do not depend on the test host. */
function localParts(ms: number): { day: number; hour: number; minute: number } {
  const date = new Date(ms);
  return { day: date.getDate(), hour: date.getHours(), minute: date.getMinutes() };
}

test("every Nm and every Nh normalise to minutes", () => {
  assert.deepEqual(parseSchedule("every 30m"), { kind: "every", minutes: 30 });
  assert.deepEqual(parseSchedule("every 2h"), { kind: "every", minutes: 120 });
  assert.deepEqual(parseSchedule("  every   45m  "), { kind: "every", minutes: 45 });
  assert.deepEqual(parseSchedule("EVERY 1H"), { kind: "every", minutes: 60 });
});

test("daily HH:MM normalises to hour and minute", () => {
  assert.deepEqual(parseSchedule("daily 07:30"), { kind: "daily", hour: 7, minute: 30 });
  assert.deepEqual(parseSchedule("Daily 23:05"), { kind: "daily", hour: 23, minute: 5 });
  assert.deepEqual(parseSchedule("daily 0:00"), { kind: "daily", hour: 0, minute: 0 });
});

test("rubbish schedules are null, never a guess", () => {
  for (const spec of [
    "",
    "every",
    "every 30",
    "every 0m",
    "every 0h",
    "every -5m",
    "every m",
    "every 30s",
    "every 2d",
    `every ${String(MAX_EVERY_MINUTES / 60 + 1)}h`,
    "daily",
    "daily 24:00",
    "daily 07:60",
    "daily 7:3",
    "daily 07:30:00",
    "daily 0730",
    "elke dag om 7 uur",
    "*/30 * * * *",
  ]) {
    assert.equal(parseSchedule(spec), null, `${JSON.stringify(spec)} should not parse`);
  }
});

test("every: the next run is one interval after now", () => {
  const schedule = { kind: "every", minutes: 30 } as const;
  const now = 1_700_000_000_000;
  assert.equal(nextRunAt(schedule, now), now + 30 * 60_000);
});

test("daily: still ahead today means today", () => {
  const clock = createFakeClock("2026-03-10T06:00:00");
  const next = nextRunAt({ kind: "daily", hour: 7, minute: 30 }, clock.now());
  const parts = localParts(next);
  assert.deepEqual(parts, { day: 10, hour: 7, minute: 30 });
  assert.ok(next > clock.now());
});

test("daily: already past means tomorrow, not a late catch-up", () => {
  const clock = createFakeClock("2026-03-10T09:00:00");
  const next = nextRunAt({ kind: "daily", hour: 7, minute: 30 }, clock.now());
  assert.deepEqual(localParts(next), { day: 11, hour: 7, minute: 30 });
});

test("daily: exactly on the minute waits for tomorrow (no double fire)", () => {
  const clock = createFakeClock("2026-03-10T07:30:00");
  const next = nextRunAt({ kind: "daily", hour: 7, minute: 30 }, clock.now());
  assert.deepEqual(localParts(next), { day: 11, hour: 7, minute: 30 });
});

test("daily: crosses midnight and month end", () => {
  const clock = createFakeClock("2026-03-31T23:45:00");
  const next = nextRunAt({ kind: "daily", hour: 7, minute: 30 }, clock.now());
  const date = new Date(next);
  assert.deepEqual(
    { month: date.getMonth(), day: date.getDate(), hour: date.getHours(), minute: date.getMinutes() },
    { month: 3, day: 1, hour: 7, minute: 30 },
  );
});

test("daily: crosses a year boundary", () => {
  const clock = createFakeClock("2026-12-31T22:10:00");
  const next = nextRunAt({ kind: "daily", hour: 6, minute: 0 }, clock.now());
  const date = new Date(next);
  assert.deepEqual(
    { year: date.getFullYear(), month: date.getMonth(), day: date.getDate(), hour: date.getHours() },
    { year: 2027, month: 0, day: 1, hour: 6 },
  );
});

test("nextRunAt refuses a clock it cannot use", () => {
  assert.throws(() => nextRunAt({ kind: "every", minutes: 5 }, Number.NaN), /finite epoch/);
  assert.throws(() => nextRunAt({ kind: "every", minutes: 0 }, 0), /positive integer/);
  assert.throws(() => nextRunAt({ kind: "daily", hour: 25, minute: 0 }, 0), /24h clock/);
});
