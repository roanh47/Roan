import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Event } from "../protocol/types.js";
import { foldFacts } from "./distil.js";

function memory(seq: number, data: Record<string, unknown>): Event {
  return { v: 1, chain: "c", seq, id: `m-${String(seq)}`, node: "n", ts: seq, type: "memory", data } as Event;
}

describe("forgetting a memory", () => {
  it("takes a fact out of the fold", () => {
    const facts = foldFacts([
      memory(1, { text: "The server runs Debian" }),
      memory(2, { text: "The owner prefers short answers" }),
      memory(3, { text: "The server runs Debian", forgotten: true }),
    ]);
    assert.deepEqual(facts.map((fact) => fact.text), ["The owner prefers short answers"]);
  });

  it("brings a fact back when it is stated again later", () => {
    const facts = foldFacts([
      memory(1, { text: "The server runs Debian" }),
      memory(2, { text: "The server runs Debian", forgotten: true }),
      memory(3, { text: "The server runs Debian" }),
    ]);
    assert.deepEqual(facts.map((fact) => fact.text), ["The server runs Debian"]);
  });

  it("ignores forgetting something that was never remembered", () => {
    const facts = foldFacts([
      memory(1, { text: "A", forgotten: true }),
      memory(2, { text: "The owner prefers short answers" }),
    ]);
    assert.deepEqual(facts.map((fact) => fact.text), ["The owner prefers short answers"]);
  });
});
