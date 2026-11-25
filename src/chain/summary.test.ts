import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Event } from "../sync/types.js";
import { formatSummary, summarize } from "./summary.js";

/**
 * This test sits next to the source in src/chain/ because tsconfig only
 * includes "src" and `npm test` runs the compiled dist/**\/*.test.js.
 *
 * summarize() only looks at seq, type and data, so the events are built by
 * hand here; no store and no clock are needed.
 */

const CHAIN = "main";
const NODE = "node-a";

function makeEvent(seq: number, type: string, data: unknown = { seq }): Event {
  return {
    v: 1,
    chain: CHAIN,
    seq,
    id: `id-${seq}`,
    node: NODE,
    ts: 1_700_000_000_000 + seq,
    type,
    data,
  };
}

describe("summarize", () => {
  it("returns zeroes and largest null for an empty chain", () => {
    const summary = summarize([]);

    assert.equal(summary.count, 0);
    assert.equal(summary.firstSeq, 0);
    assert.equal(summary.lastSeq, 0);
    assert.deepEqual(summary.perType, {});
    assert.equal(summary.largest, null);
    assert.equal(summary.contiguous, true);
  });

  it("counts per type and returns the type keys sorted", () => {
    const summary = summarize([
      makeEvent(1, "message"),
      makeEvent(2, "tool_call"),
      makeEvent(3, "message"),
      makeEvent(4, "turn_end"),
      makeEvent(5, "message"),
      makeEvent(6, "tool_call"),
    ]);

    assert.equal(summary.count, 6);
    assert.equal(summary.firstSeq, 1);
    assert.equal(summary.lastSeq, 6);
    assert.deepEqual(summary.perType, { message: 3, tool_call: 2, turn_end: 1 });
    assert.deepEqual(Object.keys(summary.perType), ["message", "tool_call", "turn_end"]);
    assert.equal(summary.contiguous, true);
  });

  it("reports a gap as not contiguous", () => {
    const summary = summarize([makeEvent(1, "message"), makeEvent(3, "message")]);

    assert.equal(summary.count, 2);
    assert.equal(summary.firstSeq, 1);
    assert.equal(summary.lastSeq, 3);
    assert.equal(summary.contiguous, false);
  });

  it("reports a duplicate seq as not contiguous", () => {
    const summary = summarize([
      makeEvent(1, "message"),
      makeEvent(2, "message"),
      makeEvent(2, "tool_call"),
      makeEvent(3, "message"),
    ]);

    assert.equal(summary.count, 4);
    assert.equal(summary.firstSeq, 1);
    assert.equal(summary.lastSeq, 3);
    assert.equal(summary.contiguous, false);
  });

  it("picks the largest payload, even when it is not the last event", () => {
    const summary = summarize([
      makeEvent(1, "message", { text: "kort" }),
      makeEvent(2, "tool_result", { text: "x".repeat(500), n: 42 }),
      makeEvent(3, "message", { text: "ook kort" }),
    ]);

    assert.ok(summary.largest, "expected a largest payload");
    assert.equal(summary.largest.seq, 2);
    assert.equal(
      summary.largest.bytes,
      Buffer.byteLength(JSON.stringify({ text: "x".repeat(500), n: 42 }), "utf8"),
    );
  });

  it("is insensitive to the order of the input", () => {
    const events = [makeEvent(3, "message"), makeEvent(1, "message"), makeEvent(2, "message")];
    const summary = summarize(events);

    assert.equal(summary.firstSeq, 1);
    assert.equal(summary.lastSeq, 3);
    assert.equal(summary.contiguous, true);
  });
});

describe("formatSummary", () => {
  it("returns one line for an empty chain", () => {
    assert.deepEqual(formatSummary(summarize([])), ["Empty chain: no events."]);
  });

  it("mentions counts, types and the largest payload", () => {
    const lines = formatSummary(
      summarize([
        makeEvent(1, "message", { text: "a" }),
        makeEvent(2, "tool_call", { text: "bb" }),
      ]),
    );

    assert.equal(lines.length, 4);
    assert.equal(lines[0], "Events: 2, seq 1..2");
    assert.equal(lines[1], "Per type: message 1, tool_call 1");
    assert.ok(lines[2]?.startsWith("Largest payload: seq 2, "), lines[2] ?? "");
    assert.ok(lines[3]?.includes("contiguous"), lines[3] ?? "");
  });
});
