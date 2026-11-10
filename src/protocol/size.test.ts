import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ELLIPSIS, byteLength, truncateForEvent } from "./size.js";

/** A string has no lone surrogate exactly when code points round-trip. */
function isWholeCodePoints(text: string): boolean {
  return Array.from(text).join("") === text;
}

describe("byteLength", () => {
  it("counts ASCII as one byte per character", () => {
    assert.equal(byteLength(""), 0);
    assert.equal(byteLength("abc"), 3);
    assert.equal(byteLength("hello world"), 11);
  });

  it("counts multi-byte characters at their UTF-8 width", () => {
    assert.equal(byteLength("😀"), 4);
    assert.equal(byteLength("日本語"), 9);
    assert.equal(byteLength("café"), 5);
  });
});

describe("truncateForEvent", () => {
  it("leaves text that fits untouched", () => {
    const out = truncateForEvent("hello", 10);
    assert.deepEqual(out, { text: "hello", truncated: false, originalBytes: 5 });
  });

  it("does not truncate text exactly at the budget", () => {
    const out = truncateForEvent("hello", 5);
    assert.equal(out.truncated, false);
    assert.equal(out.text, "hello");
    assert.equal(out.originalBytes, 5);
  });

  it("truncates once the text is one byte over the budget", () => {
    const out = truncateForEvent("hello", 5 + 1);
    assert.equal(out.truncated, false);

    const tight = truncateForEvent("hello", 4);
    assert.deepEqual(tight, {
      text: `h${ELLIPSIS}`,
      truncated: true,
      originalBytes: 5,
    });
    assert.ok(byteLength(tight.text) <= 4);
  });

  it("cuts on a code point boundary for CJK text", () => {
    const out = truncateForEvent("日本語テスト", 10);
    assert.equal(out.truncated, true);
    assert.equal(out.originalBytes, 18);
    // 10 - 3 marker bytes = 7, which holds two 3-byte characters.
    assert.equal(out.text, `日本${ELLIPSIS}`);
    assert.ok(byteLength(out.text) <= 10);
    assert.ok(isWholeCodePoints(out.text));
  });

  it("never splits a surrogate pair", () => {
    const out = truncateForEvent("x😀y", 5);
    assert.equal(out.truncated, true);
    assert.equal(out.originalBytes, 6);
    // Budget after the marker is 2 bytes: "x" fits, the emoji does not.
    assert.equal(out.text, `x${ELLIPSIS}`);
    assert.ok(byteLength(out.text) <= 5);
    assert.ok(isWholeCodePoints(out.text));

    // Only the marker fits when the first character is four bytes wide.
    const emojiOnly = truncateForEvent("😀😀", 6);
    assert.equal(emojiOnly.text, ELLIPSIS);
    assert.ok(isWholeCodePoints(emojiOnly.text));
  });

  it("returns an empty string when the marker cannot fit", () => {
    assert.deepEqual(truncateForEvent("long text", 2), {
      text: "",
      truncated: true,
      originalBytes: 9,
    });
  });

  it("rejects a non-integer, zero or negative budget", () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(
        () => truncateForEvent("abc", bad),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.ok(error.message.includes(String(bad)), error.message);
          assert.ok(error.message.includes("maxBytes"), error.message);
          return true;
        },
      );
    }
  });
});
