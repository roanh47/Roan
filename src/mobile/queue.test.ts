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
  it("a new queue is empty", () => {
    const queue = createOutboundQueue();
    assert.equal(queue.size(), 0);
    assert.deepEqual(queue.head(5), []);
  });

  it("two queues share no events", () => {
    const first = createOutboundQueue();
    const second = createOutboundQueue();
    first.enqueue(event(1));
    assert.equal(first.size(), 1);
    assert.equal(second.size(), 0);
  });

  it("enqueue keeps the insertion order", () => {
    const queue = createOutboundQueue();
    queue.enqueue(event(3, "c"));
    queue.enqueue(event(1, "a"));
    queue.enqueue(event(2, "b"));
    assert.equal(queue.size(), 3);
    assert.deepEqual(ids(queue.head(3)), ["c", "a", "b"]);
  });

  it("enqueue drops an event with a duplicate id", () => {
    const queue = createOutboundQueue();
    const first = event(1, "x");
    assert.equal(queue.enqueue(first), true);
    assert.equal(queue.enqueue(event(1, "x")), false);
    assert.equal(queue.size(), 1);
    assert.equal(queue.head(1)[0], first);
  });

  it("an id may come back after it has been acked", () => {
    const queue = createOutboundQueue();
    queue.enqueue(event(1, "x"));
    queue.ack("x");
    assert.equal(queue.enqueue(event(1, "x")), true);
    assert.equal(queue.size(), 1);
  });

  it("head(n) returns at most n events and removes nothing", () => {
    const queue = filled(5);
    assert.deepEqual(ids(queue.head(2)), ["a-1", "a-2"]);
    assert.deepEqual(ids(queue.head(99)), ["a-1", "a-2", "a-3", "a-4", "a-5"]);
    assert.equal(queue.size(), 5);
  });

  it("head with zero or a negative gives an empty list", () => {
    const queue = filled(2);
    assert.deepEqual(queue.head(0), []);
    assert.deepEqual(queue.head(-3), []);
    assert.equal(queue.size(), 2);
  });

  it("ack removes the event and keeps the rest in order", () => {
    const queue = filled(4);
    queue.ack("a-2");
    assert.equal(queue.size(), 3);
    assert.deepEqual(ids(queue.head(3)), ["a-1", "a-3", "a-4"]);
  });

  it("ack of an unknown id names the id", () => {
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

  it("planFlush on an empty queue sends nothing", () => {
    const queue = createOutboundQueue();
    const plan = queue.planFlush(NOW, 10);
    assert.deepEqual(plan.send, []);
    assert.equal(plan.hold, 0);
    assert.equal(plan.reason, "queue empty: nothing to send");
  });

  it("planFlush sends everything when it fits", () => {
    const queue = filled(3);
    const plan = queue.planFlush(NOW, 5);
    assert.deepEqual(ids(plan.send), ["a-1", "a-2", "a-3"]);
    assert.equal(plan.hold, 0);
    assert.match(plan.reason, /3 events/);
    assert.equal(queue.size(), 3, "planning must not empty the queue");
  });

  it("planFlush cuts off at max and counts the rest as hold", () => {
    const queue = filled(5);
    const plan = queue.planFlush(NOW, 2);
    assert.deepEqual(ids(plan.send), ["a-1", "a-2"]);
    assert.equal(plan.hold, 3);
    assert.match(plan.reason, /3 events/);
    assert.equal(queue.size(), 5);
  });

  it("planFlush with max 0 sends nothing and holds everything", () => {
    const queue = filled(2);
    const plan = queue.planFlush(NOW, 0);
    assert.deepEqual(plan.send, []);
    assert.equal(plan.hold, 2);
    assert.match(plan.reason, /0/);
  });

  it("planFlush with a negative max names the value", () => {
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

  it("two plans in a row give the same result", () => {
    const queue = filled(4);
    const first = queue.planFlush(NOW, 3);
    const second = queue.planFlush(NOW, 3);
    assert.deepEqual(ids(first.send), ids(second.send));
    assert.equal(first.hold, second.hold);
  });

  it("after acking the sent head the next batch moves up", () => {
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
