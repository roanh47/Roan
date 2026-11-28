import { describe, expect, it } from "vitest";
import { compactNumber, summariseUsage } from "./usage-totals.js";

const HOUR = 3_600_000;
const now = new Date(2026, 10, 28, 12, 0, 0).getTime();

const turn = (ts: number, input: number, output: number) => ({
  type: "turn_end",
  ts,
  data: { usage: { input, output } },
});

describe("usage totals", () => {
  it("adds up today, the last seven days and everything", () => {
    const summary = summariseUsage(
      [
        turn(now - HOUR, 1000, 200),
        turn(now - 2 * HOUR, 500, 100),
        turn(now - 3 * 24 * HOUR, 4000, 400),
        turn(now - 30 * 24 * HOUR, 9000, 900),
        { type: "turn_end", ts: now, data: {} },
        { type: "message", ts: now, data: { usage: { input: 5, output: 5 } } },
      ],
      now,
    );
    expect(summary.today).toEqual({ turns: 2, input: 1500, output: 300 });
    expect(summary.week).toEqual({ turns: 3, input: 5500, output: 700 });
    expect(summary.all).toEqual({ turns: 4, input: 14500, output: 1600 });
  });

  it("lists the days newest first", () => {
    const summary = summariseUsage([turn(now - 3 * 24 * HOUR, 1, 1), turn(now - HOUR, 2, 2)], now);
    expect(summary.days.map((day) => day.day)).toEqual(["2026-11-28", "2026-11-25"]);
    expect(summary.days[0]).toEqual({ day: "2026-11-28", turns: 1, input: 2, output: 2 });
  });

  it("is all zeros with nothing to count", () => {
    const summary = summariseUsage([], now);
    expect(summary.all).toEqual({ turns: 0, input: 0, output: 0 });
    expect(summary.days).toEqual([]);
  });

  it("writes large numbers short", () => {
    expect(compactNumber(950)).toBe("950");
    expect(compactNumber(1500)).toBe("1.5k");
    expect(compactNumber(12_345)).toBe("12k");
    expect(compactNumber(1_234_567)).toBe("1.2M");
  });
});
