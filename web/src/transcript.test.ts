import { describe, expect, test } from "vitest";
import { buildRows } from "./components/Transcript.js";
import type { ChainEvent } from "./chain.js";

let seq = 0;
function ev(type: ChainEvent["type"], data: Record<string, unknown> = {}, ts?: number): ChainEvent {
  seq += 1;
  return { id: `e${String(seq)}`, seq, ts: ts ?? seq, node: "pc", type, data, v: 1, chain: "c" };
}

describe("buildRows", () => {
  test("assistant rows carry the seq of their first event", () => {
    const rows = buildRows([ev("message", { text: "hi" }), ev("assistant", { text: "a" })], "pc");
    const answer = rows.find((row) => row.kind === "assistant");
    expect(answer !== undefined && answer.kind === "assistant" ? answer.seq : null).toBe(2);
  });

  test("streamed assistant events stay one block", () => {
    const rows = buildRows(
      [ev("message", { text: "hi" }), ev("assistant", { text: "one" }), ev("assistant", { text: "two" })],
      "pc",
    );
    const answers = rows.filter((row) => row.kind === "assistant");
    expect(answers.length).toBe(1);
    expect(answers[0]?.kind === "assistant" ? answers[0].text : "").toBe("one\ntwo");
  });

  test("only the last answer of a conversation carries the actions", () => {
    const rows = buildRows(
      [
        ev("message", { text: "q1" }),
        ev("assistant", { text: "a1" }),
        ev("message", { text: "q2" }),
        ev("assistant", { text: "a2" }),
      ],
      "pc",
    );
    const answers = rows.filter((row) => row.kind === "assistant");
    expect(answers.length).toBe(2);
    expect(answers[0]?.kind === "assistant" ? answers[0].actions : null).toBe(false);
    expect(answers[1]?.kind === "assistant" ? answers[1].actions : null).toBe(true);
  });

  test("three tools in a row collapse into one internal-steps toggle", () => {
    const rows = buildRows(
      [
        ev("message", { text: "go" }),
        ev("tool_call", { name: "memory" }),
        ev("tool_result", { name: "memory", ok: true, output: "1" }),
        ev("tool_call", { name: "skills" }),
        ev("tool_result", { name: "skills", ok: true, output: "2" }),
        ev("tool_call", { name: "exec" }),
        ev("tool_result", { name: "exec", ok: true, output: "3" }),
      ],
      "pc",
    );
    expect(rows.length).toBe(2);
    const steps = rows[1];
    expect(steps !== undefined && steps.kind === "steps" ? steps.tools.length : null).toBe(3);
  });

  test("two tools stay individual pills", () => {
    const rows = buildRows(
      [
        ev("message", { text: "go" }),
        ev("tool_call", { name: "a" }),
        ev("tool_result", { name: "a", ok: true, output: "1" }),
        ev("tool_call", { name: "b" }),
        ev("tool_result", { name: "b", ok: true, output: "2" }),
      ],
      "pc",
    );
    expect(rows.filter((row) => row.kind === "tool").length).toBe(2);
    expect(rows.some((row) => row.kind === "steps")).toBe(false);
  });

  test("a steps group does not swallow the answer that follows", () => {
    const rows = buildRows(
      [
        ev("message", { text: "go" }),
        ev("tool_call", { name: "a" }),
        ev("tool_result", { name: "a", ok: true, output: "1" }),
        ev("tool_call", { name: "b" }),
        ev("tool_result", { name: "b", ok: true, output: "2" }),
        ev("tool_call", { name: "c" }),
        ev("tool_result", { name: "c", ok: true, output: "3" }),
        ev("assistant", { text: "done" }),
      ],
      "pc",
    );
    const kinds = rows.map((row) => row.kind);
    expect(kinds).toEqual(["user", "steps", "assistant"]);
  });

  test("two tool groups in one turn each stay their own toggle", () => {
    const rows = buildRows(
      [
        ev("message", { text: "go" }),
        ev("tool_call", { name: "a" }),
        ev("tool_result", { name: "a", ok: true, output: "1" }),
        ev("assistant", { text: "mid" }),
        ev("tool_call", { name: "b" }),
        ev("tool_result", { name: "b", ok: true, output: "2" }),
        ev("tool_call", { name: "c" }),
        ev("tool_result", { name: "c", ok: true, output: "3" }),
        ev("tool_call", { name: "d" }),
        ev("tool_result", { name: "d", ok: true, output: "4" }),
      ],
      "pc",
    );
    expect(rows.filter((row) => row.kind === "steps").length).toBe(1);
    expect(rows.filter((row) => row.kind === "tool").length).toBe(1);
  });
});
