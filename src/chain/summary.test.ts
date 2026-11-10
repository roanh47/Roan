import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Event } from "../sync/types.js";
import { formatSummary, summarize } from "./summary.js";

/**
 * Deze test staat naast de bron in src/chain/ omdat tsconfig alleen "src"
 * include't en `npm test` de gecompileerde dist/**\/*.test.js draait.
 *
 * summarize() kijkt alleen naar seq, type en data, dus de events worden hier
 * met de hand gebouwd; er is geen store en geen tijd nodig.
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
  it("geeft nullen en largest null voor een lege keten", () => {
    const summary = summarize([]);

    assert.equal(summary.count, 0);
    assert.equal(summary.firstSeq, 0);
    assert.equal(summary.lastSeq, 0);
    assert.deepEqual(summary.perType, {});
    assert.equal(summary.largest, null);
    assert.equal(summary.contiguous, true);
  });

  it("telt per type en levert de typesleutels gesorteerd", () => {
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

  it("meldt een gat als niet-aaneengesloten", () => {
    const summary = summarize([makeEvent(1, "message"), makeEvent(3, "message")]);

    assert.equal(summary.count, 2);
    assert.equal(summary.firstSeq, 1);
    assert.equal(summary.lastSeq, 3);
    assert.equal(summary.contiguous, false);
  });

  it("meldt een dubbele seq als niet-aaneengesloten", () => {
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

  it("kiest de grootste payload, ook als die niet het laatste event is", () => {
    const summary = summarize([
      makeEvent(1, "message", { text: "kort" }),
      makeEvent(2, "tool_result", { text: "x".repeat(500), n: 42 }),
      makeEvent(3, "message", { text: "ook kort" }),
    ]);

    assert.ok(summary.largest, "verwachtte een largest-payload");
    assert.equal(summary.largest.seq, 2);
    assert.equal(
      summary.largest.bytes,
      Buffer.byteLength(JSON.stringify({ text: "x".repeat(500), n: 42 }), "utf8"),
    );
  });

  it("is ongevoelig voor de volgorde van de input", () => {
    const events = [makeEvent(3, "message"), makeEvent(1, "message"), makeEvent(2, "message")];
    const summary = summarize(events);

    assert.equal(summary.firstSeq, 1);
    assert.equal(summary.lastSeq, 3);
    assert.equal(summary.contiguous, true);
  });
});

describe("formatSummary", () => {
  it("geeft één regel voor een lege keten", () => {
    assert.deepEqual(formatSummary(summarize([])), ["Lege keten: geen events."]);
  });

  it("noemt aantallen, types en de grootste payload", () => {
    const lines = formatSummary(
      summarize([
        makeEvent(1, "message", { text: "a" }),
        makeEvent(2, "tool_call", { text: "bb" }),
      ]),
    );

    assert.equal(lines.length, 4);
    assert.equal(lines[0], "Events: 2, seq 1..2");
    assert.equal(lines[1], "Per type: message 1, tool_call 1");
    assert.ok(lines[2]?.startsWith("Grootste payload: seq 2, "), lines[2] ?? "");
    assert.ok(lines[3]?.includes("aaneengesloten"), lines[3] ?? "");
  });
});
