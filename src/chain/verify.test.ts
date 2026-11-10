import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type Event, EventStore } from "./store.js";
import { verifyChain, verifyStore } from "./verify.js";

/**
 * Deze test staat in src/chain/ (en niet in tests/) omdat tsconfig alleen
 * "src" include't en `npm test` de gecompileerde dist/**\/*.test.js draait. Een
 * test buiten rootDir zou dus niet typechecken en niet draaien.
 *
 * De events worden hier met de hand gebouwd: verifyChain kijkt alleen naar
 * chain, seq en id, dus de payload doet er niet toe.
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

/** Een aaneengesloten, unieke keten van `count` events vanaf seq 1. */
function healthyChain(count: number): Event[] {
  const events: Event[] = [];
  for (let seq = 1; seq <= count; seq += 1) {
    events.push(makeEvent(seq, `id-${seq}`));
  }
  return events;
}

/** De codes van alle problemen, in de volgorde die verifyChain ze meldt. */
function codes(events: readonly Event[]): string[] {
  return verifyChain(events).problems.map((problem) => problem.code);
}

/** Het eerste probleem met `code`, of undefined als het er niet is. */
function problemWith(events: readonly Event[], code: string): { code: string; seq: number } | undefined {
  return verifyChain(events).problems.find((problem) => problem.code === code);
}

describe("verifyChain", () => {
  it("keurt een gezonde keten van drie events goed", () => {
    const report = verifyChain(healthyChain(3));

    assert.equal(report.ok, true);
    assert.deepEqual(report.problems, []);
  });

  it("keurt een lege keten goed", () => {
    const report = verifyChain([]);

    assert.equal(report.ok, true);
    assert.deepEqual(report.problems, []);
  });

  it("meldt een gat als seq 2 ontbreekt", () => {
    const events = [makeEvent(1, "id-1"), makeEvent(3, "id-3")];

    const report = verifyChain(events);
    assert.equal(report.ok, false);
    assert.ok(codes(events).includes("gap"), `verwachtte een gap, kreeg ${JSON.stringify(codes(events))}`);

    const gap = problemWith(events, "gap");
    assert.ok(gap, "verwachtte een gap-probleem");
    assert.equal(gap.seq, 2);
  });

  it("meldt een gat op seq 1 als de keten bij 2 begint", () => {
    const events = [makeEvent(2, "id-2"), makeEvent(3, "id-3")];

    const gap = problemWith(events, "gap");
    assert.ok(gap, "verwachtte een gap-probleem");
    assert.equal(gap.seq, 1);
    assert.equal(verifyChain(events).ok, false);
  });

  it("meldt duplicate-id als hetzelfde id op twee seqs staat", () => {
    const events = [makeEvent(1, "same-id"), makeEvent(2, "same-id"), makeEvent(3, "id-3")];

    const report = verifyChain(events);
    assert.equal(report.ok, false);
    assert.ok(
      codes(events).includes("duplicate-id"),
      `verwachtte duplicate-id, kreeg ${JSON.stringify(codes(events))}`,
    );

    const duplicate = problemWith(events, "duplicate-id");
    assert.ok(duplicate, "verwachtte een duplicate-id-probleem");
    assert.equal(duplicate.seq, 2);
  });

  it("meldt bad-order als events niet op seq gesorteerd zijn", () => {
    const events = [makeEvent(1, "id-1"), makeEvent(3, "id-3"), makeEvent(2, "id-2")];

    const report = verifyChain(events);
    assert.equal(report.ok, false);
    assert.ok(
      codes(events).includes("bad-order"),
      `verwachtte bad-order, kreeg ${JSON.stringify(codes(events))}`,
    );

    const badOrder = problemWith(events, "bad-order");
    assert.ok(badOrder, "verwachtte een bad-order-probleem");
    assert.equal(badOrder.seq, 2);
  });

  it("meldt geen problemen voor een lange gezonde keten", () => {
    const events = healthyChain(50);

    const report = verifyChain(events);
    assert.equal(report.ok, true);
    assert.equal(report.problems.length, 0);
  });
});

describe("verifyStore", () => {
  it("keurt een echte store met toegevoegde events goed", () => {
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

  it("keurt een lege store goed", () => {
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
