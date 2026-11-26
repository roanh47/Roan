import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sessionMessages } from "../chain/sessions.js";
import type { Event, EventType } from "../protocol/types.js";
import {
  isSideSession,
  SIDE_SESSION_PREFIX,
  sideMessage,
  sideSession,
  type SideQuestion,
} from "./side-question.js";

/**
 * Rule under test: a side question is answered beside the conversation.
 *
 * Its session id is derived, so it is stable and never equals the parent's; the
 * payload names the parent message it quotes; and the existing session fold,
 * selecting by session, cannot return a side message for the parent. The chain
 * is built by hand — the fold reads only type, seq, ts and data, so no store
 * and no clock are involved.
 */

const CHAIN = "main";
const NODE = "node-a";
const T0 = 1_700_000_000_000;

function event(seq: number, type: EventType, data: unknown): Event {
  return { v: 1, chain: CHAIN, seq, id: `id-${String(seq)}`, node: NODE, ts: T0 + seq, type, data };
}

const PARENT = "s-main";
const question: SideQuestion = { text: "what does the lockfile actually guard?", session: PARENT };

describe("sideSession", () => {
  it("derives the same id from the same session and number", () => {
    assert.equal(sideSession(PARENT), `${SIDE_SESSION_PREFIX}${PARENT}:1`);
    assert.equal(sideSession(PARENT), sideSession(PARENT));
    assert.equal(sideSession(PARENT, 3), sideSession(PARENT, 3));
  });

  it("gives each question its own id, and each conversation different ids", () => {
    const first = sideSession(PARENT, 1);
    const second = sideSession(PARENT, 2);
    const other = sideSession("s-other", 1);

    assert.notEqual(first, second);
    assert.notEqual(first, other);
    assert.equal(new Set([first, second, other]).size, 3);
  });

  it("is always distinct from the parent it starts from", () => {
    assert.notEqual(sideSession(PARENT), PARENT);
    assert.equal(isSideSession(PARENT), false);
    assert.equal(isSideSession(sideSession(PARENT)), true);
  });

  it("recognises only ids it could have produced", () => {
    assert.equal(isSideSession("side:s-main:1"), true);
    assert.equal(isSideSession("side:s-main:12"), true);
    assert.equal(isSideSession("s-main"), false);
    assert.equal(isSideSession(""), false);
    assert.equal(isSideSession("side:"), false);
    assert.equal(isSideSession("side:s-main"), false);
    assert.equal(isSideSession("side:s-main:"), false);
    assert.equal(isSideSession("side:s-main:0"), false);
    assert.equal(isSideSession("side:s-main:x"), false);
    assert.equal(isSideSession("aside:s-main:1"), false);
  });

  it("refuses to start a side question from a side session", () => {
    assert.throws(() => sideSession(sideSession(PARENT)), RangeError);
  });

  it("refuses an empty parent or a non-positive question number", () => {
    assert.throws(() => sideSession(""), TypeError);
    assert.throws(() => sideSession("  "), TypeError);
    assert.throws(() => sideSession(PARENT, 0), RangeError);
    assert.throws(() => sideSession(PARENT, -1), RangeError);
    assert.throws(() => sideSession(PARENT, 1.5), RangeError);
  });
});

describe("sideMessage", () => {
  it("marks the parent session and the message it quotes", () => {
    const payload = sideMessage(question, 3);

    assert.deepEqual(payload, {
      text: question.text,
      session: sideSession(PARENT),
      sideOf: { session: PARENT, seq: 3 },
    });
  });

  it("never lets the payload carry the parent as its own session", () => {
    const payload = sideMessage(question, 0);

    assert.equal(payload.session, sideSession(PARENT));
    assert.notEqual(payload.session, PARENT);
    assert.equal(isSideSession(payload.session), true);
    assert.equal(payload.sideOf.session, PARENT);
  });

  it("refuses a blank question, a side parent and a seq that cannot exist", () => {
    assert.throws(() => sideMessage({ text: "   ", session: PARENT }, 1), TypeError);
    assert.throws(() => sideMessage({ text: "x", session: "" }, 1), TypeError);
    assert.throws(() => sideMessage({ text: "x", session: sideSession(PARENT) }, 1), RangeError);
    assert.throws(() => sideMessage(question, -1), RangeError);
    assert.throws(() => sideMessage(question, 2.5), RangeError);
  });
});

describe("a side question in the chain", () => {
  /** Parent conversation, then a side question and its answer beside it. */
  function chain(): { events: Event[]; side: string } {
    const side = sideSession(PARENT);
    const payload = sideMessage(question, 3);
    return {
      side,
      events: [
        event(1, "session", { id: PARENT, title: "Main" }),
        event(2, "message", { text: "how does the queue work?", session: PARENT }),
        event(3, "assistant", { text: "one writer per turn", session: PARENT }),
        event(4, "message", payload),
        event(5, "assistant", { text: "the lockfile is what stops a second writer", session: side }),
      ],
    };
  }

  it("never appears in the parent's message list", () => {
    const { events } = chain();

    assert.deepEqual(sessionMessages(events, PARENT), [
      { role: "user", text: "how does the queue work?" },
      { role: "assistant", text: "one writer per turn" },
    ]);
  });

  it("keeps its question and answer in the side session", () => {
    const { events, side } = chain();

    assert.deepEqual(sessionMessages(events, side), [
      { role: "user", text: question.text },
      { role: "assistant", text: "the lockfile is what stops a second writer" },
    ]);
  });

  it("leaves the parent's session count untouched", () => {
    const { events } = chain();
    const parentMessages = sessionMessages(events, PARENT);
    const sideMessages = sessionMessages(events, sideSession(PARENT));

    assert.equal(parentMessages.length, 2);
    assert.equal(sideMessages.length, 2);
    assert.equal(parentMessages.length + sideMessages.length, 4);
  });
});
