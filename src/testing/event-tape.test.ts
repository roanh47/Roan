import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentEvent } from "../types.js";
import { recordTape, replayTape } from "./event-tape.js";

const TAPE_SAMPLE: AgentEvent[] = [
  { type: "assistant_text", text: "looking at the repo" },
  { type: "tool_start", name: "read_file", args: '{"path":"src/types.ts"}' },
  { type: "tool_end", name: "read_file", ok: true, output: "export type Role" },
  { type: "error", message: "tool timed out" },
  { type: "turn_end", steps: 3 },
];

describe("recordTape", () => {
  it("writes one JSON object per line, each terminated by a newline", () => {
    const tape = recordTape(TAPE_SAMPLE);
    const lines = tape.split("\n");
    assert.equal(lines.at(-1), "");
    assert.equal(lines.length, TAPE_SAMPLE.length + 1);

    const body = lines.slice(0, -1);
    assert.deepEqual(
      body.map((line) => JSON.parse(line) as unknown),
      TAPE_SAMPLE,
    );
    assert.equal(tape, TAPE_SAMPLE.map((event) => `${JSON.stringify(event)}\n`).join(""));
  });

  it("yields an empty string for an empty tape", () => {
    assert.equal(recordTape([]), "");
  });

  it("keeps newlines inside string payloads escaped, not literal", () => {
    const tape = recordTape([{ type: "error", message: "line one\nline two" }]);
    assert.equal(tape.split("\n").length, 2);
    assert.deepEqual(replayTape(tape), [{ type: "error", message: "line one\nline two" }]);
  });
});

describe("replayTape", () => {
  it("round-trips every event shape", () => {
    assert.deepEqual(replayTape(recordTape(TAPE_SAMPLE)), TAPE_SAMPLE);
  });

  it("returns an empty array for an empty tape", () => {
    assert.deepEqual(replayTape(""), []);
  });

  it("ignores blank trailing lines", () => {
    const tape = recordTape(TAPE_SAMPLE);
    assert.deepEqual(replayTape(`${tape}\n\n\n`), TAPE_SAMPLE);
  });

  it("reports the 1-based line number and text of a line that is not JSON", () => {
    const tape = `${recordTape(TAPE_SAMPLE.slice(0, 2))}not json at all\n`;
    assert.throws(
      () => replayTape(tape),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes("line 3"), error.message);
        assert.ok(error.message.includes("not json at all"), error.message);
        return true;
      },
    );
  });

  it("rejects a JSON line whose type is not a known event", () => {
    const tape = `${recordTape(TAPE_SAMPLE.slice(0, 1))}{"type":"bogus_event","x":1}\n`;
    assert.throws(
      () => replayTape(tape),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes("line 2"), error.message);
        assert.ok(error.message.includes("bogus_event"), error.message);
        assert.ok(error.message.includes('{"type":"bogus_event","x":1}'), error.message);
        return true;
      },
    );
  });

  it("rejects a JSON value that carries no event type", () => {
    for (const line of ["42", "null", '"assistant_text"', "[]", "{}"]) {
      assert.throws(
        () => replayTape(`${line}\n`),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.ok(error.message.includes("line 1"), error.message);
          return true;
        },
      );
    }
  });

  it("does not tolerate a blank line between records", () => {
    const lines = recordTape(TAPE_SAMPLE).split("\n");
    const holed = [lines[0], "", ...lines.slice(1)].join("\n");
    assert.throws(
      () => replayTape(holed),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes("line 2"), error.message);
        return true;
      },
    );
  });

  it("shortens a very long offending line instead of echoing it whole", () => {
    const monster = "x".repeat(5000);
    assert.throws(
      () => replayTape(`${monster}\n`),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.length < 400, `message was ${error.message.length} chars`);
        assert.ok(error.message.includes("line 1"), error.message);
        return true;
      },
    );
  });
});
