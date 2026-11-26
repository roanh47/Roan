import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MessageQueue } from "./queue.js";

/**
 * Rule under test: what the owner typed while the agent was busy comes out in
 * the order it was typed, and every message comes out exactly once.
 *
 * The queue holds no timer and no I/O, so order is asserted directly and no
 * fake clock is involved.
 */

describe("MessageQueue", () => {
  it("starts empty and hands out nothing", () => {
    const queue = new MessageQueue();

    assert.equal(queue.size, 0);
    assert.equal(queue.isEmpty, true);
    assert.equal(queue.peek(), undefined);
    assert.equal(queue.shift(), undefined);
  });

  it("hands messages back first in, first out", () => {
    const queue = new MessageQueue();
    queue.enqueue("first");
    queue.enqueue("second");
    queue.enqueue("third");

    assert.equal(queue.size, 3);
    assert.equal(queue.peek(), "first");
    assert.equal(queue.shift(), "first");
    assert.equal(queue.shift(), "second");
    assert.equal(queue.shift(), "third");
    assert.equal(queue.shift(), undefined);
    assert.equal(queue.size, 0);
  });

  it("peeks without consuming, and reports the depth after each enqueue", () => {
    const queue = new MessageQueue();

    assert.equal(queue.enqueue("one"), 1);
    assert.equal(queue.peek(), "one");
    assert.equal(queue.peek(), "one");
    assert.equal(queue.enqueue("two"), 2);
    assert.equal(queue.size, 2);
  });

  it("refuses empty and whitespace-only text instead of queueing a blank turn", () => {
    const queue = new MessageQueue();

    assert.throws(() => queue.enqueue(""), TypeError);
    assert.throws(() => queue.enqueue("   \n\t "), TypeError);
    assert.equal(queue.size, 0);
    assert.equal(queue.isEmpty, true);
  });

  it("sends the trimmed text, since that is the text that was meant", () => {
    const queue = new MessageQueue();
    queue.enqueue("  what about the lock?  ");

    assert.equal(queue.shift(), "what about the lock?");
  });

  it("keeps order across a burst of enqueues, and shift returns each item once", () => {
    const queue = new MessageQueue();
    const typed = ["a", "b", "c", "d", "e", "f"];

    for (const text of typed) queue.enqueue(text);

    const handed: string[] = [];
    let next = queue.shift();
    while (next !== undefined) {
      handed.push(next);
      next = queue.shift();
    }

    assert.deepEqual(handed, typed);
    // Every message exactly once: no duplicate, nothing dropped.
    assert.deepEqual([...handed].sort(), [...typed].sort());
    assert.equal(queue.size, 0);
  });

  it("preserves order when enqueues and shifts interleave", () => {
    const queue = new MessageQueue();
    queue.enqueue("1");
    assert.equal(queue.shift(), "1");
    queue.enqueue("2");
    queue.enqueue("3");
    assert.equal(queue.shift(), "2");
    queue.enqueue("4");
    assert.equal(queue.shift(), "3");
    assert.equal(queue.shift(), "4");
    assert.equal(queue.shift(), undefined);
  });

  it("clears everything, including after a partial drain", () => {
    const queue = new MessageQueue();
    queue.enqueue("old");
    queue.enqueue("older");
    assert.equal(queue.shift(), "old");

    queue.clear();

    assert.equal(queue.size, 0);
    assert.equal(queue.isEmpty, true);
    assert.equal(queue.peek(), undefined);
    assert.equal(queue.shift(), undefined);

    // A cleared queue still accepts new work.
    queue.enqueue("new");
    assert.equal(queue.shift(), "new");
  });

  it("removes one message by the index the owner pointed at", () => {
    const queue = new MessageQueue();
    queue.enqueue("a");
    queue.enqueue("b");
    queue.enqueue("c");

    assert.equal(queue.removeAt(1), "b");
    assert.deepEqual(queue.toArray(), ["a", "c"]);
    assert.equal(queue.size, 2);
  });

  it("ignores an index that names nothing, without losing a neighbour", () => {
    const queue = new MessageQueue();
    queue.enqueue("only");

    assert.equal(queue.removeAt(-1), undefined);
    assert.equal(queue.removeAt(1), undefined);
    assert.equal(queue.removeAt(0.5), undefined);
    assert.deepEqual(queue.toArray(), ["only"]);
  });

  it("reports its contents without handing out its own array", () => {
    const queue = new MessageQueue();
    queue.enqueue("keep");

    const copy = queue.toArray();
    copy.push("smuggled");
    copy.length = 0;

    assert.deepEqual(queue.toArray(), ["keep"]);
    assert.equal(queue.size, 1);
  });
});
