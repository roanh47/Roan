import { describe, expect, test } from "vitest";
import { openTurn, turnPhase, turnQuietMs } from "./chain.js";
import type { ChainEvent, OpenTurn } from "./chain.js";

let seq = 0;
function event(type: ChainEvent["type"], data: Record<string, unknown> = {}, node = "this"): ChainEvent {
  seq += 1;
  return { id: `e${String(seq)}`, seq, ts: seq, node, type, data, v: 1, chain: "c" };
}

function run(events: readonly ChainEvent[]): string {
  const turn: OpenTurn | null = openTurn(events);
  return turnPhase(events, turn);
}

describe("turnPhase", () => {
  test("no turn is no phase", () => {
    expect(turnPhase([], null)).toBe("");
  });

  test("a turn with nothing after its start is thinking", () => {
    expect(run([event("turn_start", {})])).toBe("thinking");
  });

  test("assistant output means writing", () => {
    expect(
      run([event("turn_start", {}), event("assistant", { text: "par" })]),
    ).toBe("writing");
  });

  test("a tool call means running that tool, by name", () => {
    expect(
      run([event("turn_start", {}), event("assistant", { text: "hm" }), event("tool_call", { name: "read_dir" })]),
    ).toBe("running read_dir");
  });

  test("a tool call without a name still says something honest", () => {
    expect(run([event("turn_start", {}), event("tool_call", {})])).toBe("running a tool");
  });

  test("events from an earlier turn do not count", () => {
    const stale = event("tool_call", { name: "old_tool" });
    expect(
      run([
        stale,
        event("turn_end", {}),
        event("turn_start", {}),
        event("assistant", { text: "x" }),
      ]),
    ).toBe("writing");
  });

  test("a closed turn is no phase", () => {
    expect(run([event("turn_start", {}), event("assistant", { text: "x" }), event("turn_end", {})])).toBe("");
  });
});

describe("turnQuietMs", () => {
  test("no open turn is never quiet", () => {
    expect(turnQuietMs([], null, 5_000)).toBe(0);
  });

  test("a turn with only its start has been quiet since the start", () => {
    const start = { ...event("turn_start", {}), ts: 1_000 };
    const turn = openTurn([start]);
    expect(turnQuietMs([start], turn, 61_000)).toBe(60_000);
  });

  test("events inside the turn reset the clock", () => {
    const events = [
      { ...event("turn_start", {}), ts: 1_000 },
      { ...event("tool_call", { name: "read" }), ts: 70_000 },
    ];
    const turn = openTurn(events);
    expect(turnQuietMs(events, turn, 80_000)).toBe(10_000);
  });

  test("events from before the turn do not count", () => {
    const events = [
      { ...event("assistant", { text: "past" }), ts: 900_000 },
      { ...event("turn_start", {}), ts: 1_000 },
    ];
    const turn = openTurn(events);
    expect(turnQuietMs(events, turn, 2_000)).toBe(1_000);
  });
});
