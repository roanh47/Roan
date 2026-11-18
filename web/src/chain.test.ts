import { describe, expect, test } from "vitest";
import { openTurn, turnPhase } from "./chain.js";
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
