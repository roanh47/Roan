/**
 * The steer inbox, stated as rules.
 *
 * One slot, newest wins, and `take` empties it: that is the whole contract the
 * turn runner relies on when it decides where a mid-turn message lands.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { createSteerInbox } from "./steer.js";

test("the inbox holds one message: take returns it and empties the slot", () => {
  const inbox = createSteerInbox();
  assert.equal(inbox.take(), null, "an untouched inbox has nothing to take");
  inbox.push("look at the failing test first");
  assert.equal(inbox.take(), "look at the failing test first");
  assert.equal(inbox.take(), null, "the same message is never handed out twice");
});

test("a second push replaces the first and reports what it displaced", () => {
  const inbox = createSteerInbox();
  assert.deepEqual(inbox.push("first thought"), { replaced: false, previous: null });
  assert.deepEqual(inbox.push("  second thought  "), {
    replaced: true,
    previous: "first thought",
  });
  assert.equal(inbox.take(), "second thought", "the newest word is the one that travels");
});

test("drain returns the waiting message once and clears the slot", () => {
  const inbox = createSteerInbox();
  assert.deepEqual(inbox.drain(), [], "nothing waits, nothing is returned");
  inbox.push("late but not lost");
  assert.deepEqual(inbox.drain(), ["late but not lost"]);
  assert.deepEqual(inbox.drain(), []);
  assert.equal(inbox.take(), null);
});

test("a blank push changes nothing and stores nothing", () => {
  const inbox = createSteerInbox();
  inbox.push("keep this");
  assert.deepEqual(inbox.push("   \n\t "), { replaced: false, previous: null });
  assert.equal(inbox.take(), "keep this", "a blank message must not displace a real one");
});
