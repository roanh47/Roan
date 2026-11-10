import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFakeClock } from "./fake-clock.js";

const START = "2026-01-01T00:00:00.000Z";
const START_MS = Date.parse(START);

/** Asserts that `fn` throws an Error whose message contains every fragment. */
function throwsMentioning(fn: () => void, fragments: readonly string[]): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof Error);
    for (const fragment of fragments) {
      assert.ok(error.message.includes(fragment), error.message);
    }
    return true;
  });
}

describe("createFakeClock", () => {
  it("seeds both readings from the start string", () => {
    const clock = createFakeClock(START);
    assert.equal(clock.now(), START_MS);
    assert.equal(clock.nowIso(), START);
  });

  it("reports a non-UTC seed back in UTC", () => {
    const clock = createFakeClock("2026-01-01T12:00:00+02:00");
    assert.equal(clock.nowIso(), "2026-01-01T10:00:00.000Z");
  });

  it("rejects a seed that does not name a moment", () => {
    throwsMentioning(() => createFakeClock("not a date"), ["createFakeClock", '"not a date"']);
  });
});

describe("FakeClock.advance", () => {
  it("moves the reading forward", () => {
    const clock = createFakeClock(START);
    clock.advance(1500);
    assert.equal(clock.now(), START_MS + 1500);
    assert.equal(clock.nowIso(), "2026-01-01T00:00:01.500Z");
  });

  it("accumulates across calls", () => {
    const clock = createFakeClock(START);
    clock.advance(1000);
    clock.advance(2000);
    assert.equal(clock.now(), START_MS + 3000);
  });

  it("accepts zero as a no-op", () => {
    const clock = createFakeClock(START);
    clock.advance(0);
    assert.equal(clock.now(), START_MS);
  });

  it("rejects a negative or non-finite amount, naming it", () => {
    const clock = createFakeClock(START);
    for (const bad of [-1, -0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      throwsMentioning(() => {
        clock.advance(bad);
      }, ["advance", String(bad)]);
    }
    // A rejected advance must leave the reading where it was.
    assert.equal(clock.now(), START_MS);
  });
});

describe("FakeClock.set", () => {
  it("jumps forward to an absolute time", () => {
    const clock = createFakeClock(START);
    clock.set("2026-01-02T06:30:00.000Z");
    assert.equal(clock.now(), Date.parse("2026-01-02T06:30:00.000Z"));
    assert.equal(clock.nowIso(), "2026-01-02T06:30:00.000Z");
  });

  it("allows setting the current time again", () => {
    const clock = createFakeClock(START);
    clock.set(START);
    assert.equal(clock.now(), START_MS);
  });

  it("refuses to move backwards, naming both times", () => {
    const clock = createFakeClock("2026-01-02T00:00:00.000Z");
    throwsMentioning(
      () => {
        clock.set(START);
      },
      ["set", "2026-01-02T00:00:00.000Z", START],
    );
    assert.equal(clock.nowIso(), "2026-01-02T00:00:00.000Z");
  });

  it("rejects an unparseable time, naming it", () => {
    const clock = createFakeClock(START);
    throwsMentioning(
      () => {
        clock.set("soon");
      },
      ["set", '"soon"'],
    );
    assert.equal(clock.now(), START_MS);
  });
});
