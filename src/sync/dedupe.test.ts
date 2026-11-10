import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dedupeEvents } from "./dedupe.js";
import type { Event } from "./types.js";

function event(seq: number, id = `a-${seq}`, node = "a"): Event {
  return { v: 1, chain: "gesprek", seq, id, node, ts: 1_700_000_000_000 + seq, type: "bericht", data: { seq } };
}

function ids(events: readonly Event[]): string[] {
  return events.map((e) => e.id);
}

describe("dedupeEvents", () => {
  it("lege invoer levert niets op", () => {
    const result = dedupeEvents([]);
    assert.deepEqual(result.kept, []);
    assert.deepEqual(result.dropped, []);
    assert.deepEqual(result.duplicateIds, []);
  });

  it("unieke events blijven allemaal staan", () => {
    const events = [event(1), event(2), event(3)];
    const result = dedupeEvents(events);
    assert.deepEqual(ids(result.kept), ["a-1", "a-2", "a-3"]);
    assert.deepEqual(result.dropped, []);
    assert.deepEqual(result.duplicateIds, []);
  });

  it("dubbel id: de eerste blijft, de rest gaat naar dropped", () => {
    const events = [event(1, "x"), event(1, "x"), event(2, "y")];
    const result = dedupeEvents(events);
    assert.deepEqual(ids(result.kept), ["x", "y"]);
    assert.deepEqual(ids(result.dropped), ["x"]);
    assert.deepEqual(result.duplicateIds, ["x"]);
    assert.equal(result.kept[0], events[0]);
  });

  it("zelfde seq met andere id is een mismatch en wordt gedropt", () => {
    const events = [event(1, "x"), event(1, "z"), event(2, "y")];
    const result = dedupeEvents(events);
    assert.deepEqual(ids(result.kept), ["x", "y"]);
    assert.deepEqual(ids(result.dropped), ["z"]);
    assert.deepEqual(result.duplicateIds, ["z"]);
  });

  it("mismatch en dubbel id samen: duplicateIds is gesorteerd en uniek", () => {
    const events = [
      event(1, "m"),
      event(1, "z"),
      event(2, "b"),
      event(2, "b"),
      event(3, "a"),
      event(4, "a"),
    ];
    const result = dedupeEvents(events);
    assert.deepEqual(ids(result.kept), ["m", "b", "a"]);
    assert.deepEqual(ids(result.dropped), ["z", "b", "a"]);
    assert.deepEqual(result.duplicateIds, ["a", "b", "z"]);
  });

  it("de volgorde van de invoer blijft behouden", () => {
    const events = [event(3, "c"), event(1, "a"), event(2, "b")];
    const result = dedupeEvents(events);
    assert.deepEqual(ids(result.kept), ["c", "a", "b"]);
    assert.deepEqual(
      result.kept.map((e) => e.seq),
      [3, 1, 2],
    );
  });

  it("de invoer wordt niet aangepast", () => {
    const events = [event(1, "x"), event(1, "x"), event(1, "z")];
    const before = events.slice();
    dedupeEvents(events);
    assert.deepEqual(events, before);
    assert.equal(events.length, 3);
  });
});
