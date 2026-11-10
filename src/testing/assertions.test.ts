import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertErrorMentions,
  assertSameSet,
  assertSortedStrings,
} from "./assertions.js";

/** Runs `fn` and returns the assertion message it throws. */
function messageFrom(fn: () => void): string {
  try {
    fn();
  } catch (error: unknown) {
    assert.ok(error instanceof Error, "expected an Error to be thrown");
    return error.message;
  }
  assert.fail("expected the callback to throw, but it returned normally");
}

describe("assertSameSet", () => {
  it("accepts the same members in a different order with duplicates", () => {
    assertSameSet(["b", "a", "b"], ["a", "b"]);
    assertSameSet([], []);
  });

  it("names missing and extra members on failure", () => {
    const message = messageFrom(() => {
      assertSameSet(["a", "c", "c"], ["a", "b"]);
    });
    const summary = message.slice(0, message.indexOf("\n"));
    assert.ok(summary.includes("missing"), message);
    assert.ok(summary.includes('"b"'), message);
    assert.ok(summary.includes("extra"), message);
    assert.ok(summary.includes('"c"'), message);
    assert.ok(!summary.includes('"a"'), message);
  });
});

describe("assertSortedStrings", () => {
  it("accepts an ascending list including duplicates", () => {
    assertSortedStrings([]);
    assertSortedStrings(["alpha"]);
    assertSortedStrings(["alpha", "alpha", "beta", "gamma"]);
  });

  it("names the first out-of-order pair on failure", () => {
    const message = messageFrom(() => {
      assertSortedStrings(["alpha", "gamma", "beta", "delta"]);
    });
    const summary = message.slice(0, message.indexOf("\n"));
    assert.ok(summary.includes("not sorted"), message);
    assert.ok(summary.includes("index 1"), message);
    assert.ok(summary.includes("index 2"), message);
    assert.ok(summary.includes('"gamma"'), message);
    assert.ok(summary.includes('"beta"'), message);
    assert.ok(!summary.includes('"delta"'), message);
  });
});

describe("assertErrorMentions", () => {
  it("returns the thrown error when the message matches", () => {
    const error = assertErrorMentions(() => {
      throw new Error("bad maxBytes value");
    }, "maxBytes");
    assert.equal(error.message, "bad maxBytes value");
  });

  it("fails when the message does not contain the needle", () => {
    const message = messageFrom(() => {
      assertErrorMentions(() => {
        throw new Error("something else");
      }, "maxBytes");
    });
    assert.ok(message.includes("maxBytes"), message);
    assert.ok(message.includes("something else"), message);
  });

  it("fails when the function does not throw", () => {
    const message = messageFrom(() => {
      assertErrorMentions(() => 42, "maxBytes");
    });
    assert.ok(message.includes("returned normally"), message);
    assert.ok(message.includes("maxBytes"), message);
  });
});
