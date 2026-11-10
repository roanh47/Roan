import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkEventBudget, eventBytes } from "./event-budget.js";
import { byteLength } from "./size.js";
import type { Event } from "../sync/types.js";

/** A tiny, fully ASCII event used as the baseline for the tests below. */
function smallEvent(data: unknown = { text: "hi" }): Event {
  return {
    v: 1,
    chain: "main",
    seq: 1,
    id: "evt-1",
    node: "node-a",
    ts: 1_700_000_000_000,
    type: "message",
    data,
  };
}

describe("eventBytes", () => {
  it("measures the whole serialised event", () => {
    const event = smallEvent();
    assert.equal(eventBytes(event), byteLength(JSON.stringify(event)));
  });

  it("counts data, so a bigger payload is a bigger event", () => {
    const small = eventBytes(smallEvent({ text: "hi" }));
    const big = eventBytes(smallEvent({ text: "x".repeat(1000) }));
    assert.ok(big > small, `${big} should exceed ${small}`);
  });

  it("counts multibyte text as bytes, not characters", () => {
    const ascii = eventBytes(smallEvent("aaa"));
    const emoji = eventBytes(smallEvent("😀"));
    // "aaa" is three bytes, "😀" is one character but four bytes.
    assert.equal(emoji - ascii, 1);
    assert.ok("😀".length < byteLength("😀"));
  });
});

describe("checkEventBudget", () => {
  it("lets a small event through and reports its measured size", () => {
    const event = smallEvent({ text: "hi" });
    const bytes = eventBytes(event);
    const result = checkEventBudget(event, 4096);
    assert.equal(result.ok, true);
    assert.equal(result.bytes, bytes);
    assert.equal(typeof result.largestField, "string");
  });

  it("fits an event that is exactly at the budget", () => {
    const event = smallEvent({ text: "hi" });
    const bytes = eventBytes(event);
    assert.equal(checkEventBudget(event, bytes).ok, true);
    assert.equal(checkEventBudget(event, bytes - 1).ok, false);
  });

  it("rejects a big data payload and blames data", () => {
    const payload = "x".repeat(5000);
    const event = smallEvent(payload);
    const result = checkEventBudget(event, 512);
    assert.equal(result.ok, false);
    assert.ok(result.bytes > 512);
    assert.equal(result.largestField, "data");
    // Only the key is reported; the payload must never travel with it.
    assert.ok(!JSON.stringify(result).includes(payload));
  });

  it("resolves ties alphabetically so the answer is stable", () => {
    const event: Event = {
      v: 1,
      chain: "aa",
      seq: 1,
      id: "",
      node: "bb",
      ts: 1,
      type: "",
      data: null,
    };
    // chain, node and data all serialise to four bytes; chain wins on order.
    assert.equal(checkEventBudget(event, 1).largestField, "chain");
  });

  it("throws on a maxBytes that is not a positive safe integer", () => {
    const bad = [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_VALUE,
    ];
    for (const maxBytes of bad) {
      assert.throws(
        () => checkEventBudget(smallEvent(), maxBytes),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.ok(error.message.includes("maxBytes"), error.message);
          assert.ok(
            error.message.includes(String(maxBytes)),
            error.message,
          );
          return true;
        },
      );
    }
  });
});
