import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createOutboundQueue } from "./queue.js";
import type { Event } from "../sync/types.js";

const NOW = "2026-11-10T21:00:00.000Z";

function event(seq: number, id = `a-${seq}`, node = "a"): Event {
  return {
    v: 1,
    chain: "gesprek",
    seq,
    id,
    node,
    ts: 1_700_000_000_000 + seq,
    type: "bericht",
    data: { seq },
  };
}

function ids(events: readonly Event[]): string[] {
  return events.map((e) => e.id);
}

function filled(count: number) {
  const queue = createOutboundQueue();
  for (let seq = 1; seq <= count; seq += 1) {
    queue.enqueue(event(seq));
  }
  return queue;
}

describe("createOutboundQueue", () => {
  it("een nieuwe wachtrij is leeg", () => {
    const queue = createOutboundQueue();
    assert.equal(queue.size(), 0);
    assert.deepEqual(queue.head(5), []);
  });

  it("twee wachtrijen delen geen events", () => {
    const first = createOutboundQueue();
    const second = createOutboundQueue();
    first.enqueue(event(1));
    assert.equal(first.size(), 1);
    assert.equal(second.size(), 0);
  });

  it("enqueue bewaart de invoegvolgorde", () => {
    const queue = createOutboundQueue();
    queue.enqueue(event(3, "c"));
    queue.enqueue(event(1, "a"));
    queue.enqueue(event(2, "b"));
    assert.equal(queue.size(), 3);
    assert.deepEqual(ids(queue.head(3)), ["c", "a", "b"]);
  });

  it("enqueue laat een event met een dubbel id vallen", () => {
    const queue = createOutboundQueue();
    const first = event(1, "x");
    assert.equal(queue.enqueue(first), true);
    assert.equal(queue.enqueue(event(1, "x")), false);
    assert.equal(queue.size(), 1);
    assert.equal(queue.head(1)[0], first);
  });

  it("een id mag terugkomen nadat het is geackt", () => {
    const queue = createOutboundQueue();
    queue.enqueue(event(1, "x"));
    queue.ack("x");
    assert.equal(queue.enqueue(event(1, "x")), true);
    assert.equal(queue.size(), 1);
  });

  it("head(n) geeft hooguit n events en breekt niets af", () => {
    const queue = filled(5);
    assert.deepEqual(ids(queue.head(2)), ["a-1", "a-2"]);
    assert.deepEqual(ids(queue.head(99)), ["a-1", "a-2", "a-3", "a-4", "a-5"]);
    assert.equal(queue.size(), 5);
  });

  it("head met nul of negatief geeft een lege lijst", () => {
    const queue = filled(2);
    assert.deepEqual(queue.head(0), []);
    assert.deepEqual(queue.head(-3), []);
    assert.equal(queue.size(), 2);
  });

  it("ack verwijdert het event en houdt de rest in volgorde", () => {
    const queue = filled(4);
    queue.ack("a-2");
    assert.equal(queue.size(), 3);
    assert.deepEqual(ids(queue.head(3)), ["a-1", "a-3", "a-4"]);
  });

  it("ack van een onbekend id noemt het id", () => {
    const queue = filled(1);
    assert.throws(
      () => queue.ack("bestaat-niet"),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /bestaat-niet/);
        return true;
      },
    );
    assert.equal(queue.size(), 1);
  });

  it("planFlush op een lege wachtrij verstuurt niets", () => {
    const queue = createOutboundQueue();
    const plan = queue.planFlush(NOW, 10);
    assert.deepEqual(plan.send, []);
    assert.equal(plan.hold, 0);
    assert.equal(plan.reason, "wachtrij leeg: niets te versturen");
  });

  it("planFlush verstuurt alles als het past", () => {
    const queue = filled(3);
    const plan = queue.planFlush(NOW, 5);
    assert.deepEqual(ids(plan.send), ["a-1", "a-2", "a-3"]);
    assert.equal(plan.hold, 0);
    assert.match(plan.reason, /3 events/);
    assert.equal(queue.size(), 3, "plannen mag de wachtrij niet leegmaken");
  });

  it("planFlush kapt af op max en telt de rest als hold", () => {
    const queue = filled(5);
    const plan = queue.planFlush(NOW, 2);
    assert.deepEqual(ids(plan.send), ["a-1", "a-2"]);
    assert.equal(plan.hold, 3);
    assert.match(plan.reason, /3 events/);
    assert.equal(queue.size(), 5);
  });

  it("planFlush met max 0 verstuurt niets en houdt alles", () => {
    const queue = filled(2);
    const plan = queue.planFlush(NOW, 0);
    assert.deepEqual(plan.send, []);
    assert.equal(plan.hold, 2);
    assert.match(plan.reason, /0/);
  });

  it("planFlush met een negatieve max noemt de waarde", () => {
    const queue = filled(1);
    assert.throws(
      () => queue.planFlush(NOW, -4),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /-4/);
        return true;
      },
    );
    assert.equal(queue.size(), 1);
  });

  it("twee plannen na elkaar geven hetzelfde resultaat", () => {
    const queue = filled(4);
    const first = queue.planFlush(NOW, 3);
    const second = queue.planFlush(NOW, 3);
    assert.deepEqual(ids(first.send), ids(second.send));
    assert.equal(first.hold, second.hold);
  });

  it("na ack van de verstuurde kop schuift de volgende batch op", () => {
    const queue = filled(4);
    const first = queue.planFlush(NOW, 2);
    for (const sent of first.send) {
      queue.ack(sent.id);
    }
    const second = queue.planFlush(NOW, 2);
    assert.deepEqual(ids(second.send), ["a-3", "a-4"]);
    assert.equal(second.hold, 0);
  });
});
