import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type Event, EventStore } from "./store.js";
import { verifyChain, verifyStore } from "./verify.js";

/**
 * This test sits in src/chain/ (and not in tests/) because tsconfig only
 * includes "src" and `npm test` runs the compiled dist/**\/*.test.js. A test
 * outside rootDir would neither typecheck nor run.
 *
 * The events are built by hand here: verifyChain only looks at chain, seq and
 * id, so the payload does not matter.
 */

const CHAIN = "main";
const NODE = "node-a";
const T0 = 1_700_000_000_000;

function makeEvent(seq: number, id: string, chain: string = CHAIN): Event {
  return {
    v: 1,
    chain,
    seq,
    id,
    node: NODE,
    ts: T0 + seq,
    type: "message",
    data: { seq },
  };
}

/** A contiguous, unique chain of `count` events starting at seq 1. */
function healthyChain(count: number): Event[] {
  const events: Event[] = [];
  for (let seq = 1; seq <= count; seq += 1) {
    events.push(makeEvent(seq, `id-${seq}`));
  }
  return events;
}

/** The codes of all problems, in the order verifyChain reports them. */
function codes(events: readonly Event[]): string[] {
  return verifyChain(events).problems.map((problem) => problem.code);
}

/** The first problem with `code`, or undefined when there is none. */
function problemWith(events: readonly Event[], code: string): { code: string; seq: number } | undefined {
  return verifyChain(events).problems.find((problem) => problem.code === code);
}

describe("verifyChain", () => {
  it("accepts a healthy chain of three events", () => {
    const report = verifyChain(healthyChain(3));

    assert.equal(report.ok, true);
    assert.deepEqual(report.problems, []);
  });

  it("accepts an empty chain", () => {
    const report = verifyChain([]);

    assert.equal(report.ok, true);
    assert.deepEqual(report.problems, []);
  });

  it("reports a gap when seq 2 is missing", () => {
    const events = [makeEvent(1, "id-1"), makeEvent(3, "id-3")];

    const report = verifyChain(events);
    assert.equal(report.ok, false);
    assert.ok(codes(events).includes("gap"), `expected a gap, got ${JSON.stringify(codes(events))}`);

    const gap = problemWith(events, "gap");
    assert.ok(gap, "expected a gap problem");
    assert.equal(gap.seq, 2);
  });

  it("reports a gap at seq 1 when the chain starts at 2", () => {
    const events = [makeEvent(2, "id-2"), makeEvent(3, "id-3")];

    const gap = problemWith(events, "gap");
    assert.ok(gap, "expected a gap problem");
    assert.equal(gap.seq, 1);
    assert.equal(verifyChain(events).ok, false);
  });

  it("reports duplicate-id when the same id sits on two seqs", () => {
    const events = [makeEvent(1, "same-id"), makeEvent(2, "same-id"), makeEvent(3, "id-3")];

    const report = verifyChain(events);
    assert.equal(report.ok, false);
    assert.ok(
      codes(events).includes("duplicate-id"),
      `expected duplicate-id, got ${JSON.stringify(codes(events))}`,
    );

    const duplicate = problemWith(events, "duplicate-id");
    assert.ok(duplicate, "expected a duplicate-id problem");
    assert.equal(duplicate.seq, 2);
  });

  it("reports bad-order when events are not sorted by seq", () => {
    const events = [makeEvent(1, "id-1"), makeEvent(3, "id-3"), makeEvent(2, "id-2")];

    const report = verifyChain(events);
    assert.equal(report.ok, false);
    assert.ok(
      codes(events).includes("bad-order"),
      `expected bad-order, got ${JSON.stringify(codes(events))}`,
    );

    const badOrder = problemWith(events, "bad-order");
    assert.ok(badOrder, "expected a bad-order problem");
    assert.equal(badOrder.seq, 2);
  });

  it("reports no problems for a long healthy chain", () => {
    const events = healthyChain(50);

    const report = verifyChain(events);
    assert.equal(report.ok, true);
    assert.equal(report.problems.length, 0);
  });
});

describe("verifyStore", () => {
  it("accepts a real store with appended events", () => {
    const store = EventStore.open(":memory:");
    try {
      for (let seq = 1; seq <= 3; seq += 1) {
        store.append(CHAIN, { id: `id-${seq}`, node: NODE, type: "message", data: { seq } });
      }

      const report = verifyStore(store, CHAIN);
      assert.equal(report.ok, true);
      assert.deepEqual(report.problems, []);
    } finally {
      store.close();
    }
  });

  it("accepts an empty store", () => {
    const store = EventStore.open(":memory:");
    try {
      const report = verifyStore(store, "leeg");
      assert.equal(report.ok, true);
      assert.deepEqual(report.problems, []);
    } finally {
      store.close();
    }
  });
});
