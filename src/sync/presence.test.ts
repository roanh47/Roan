import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_PRESENCE_TTL_MS, Presence } from "./presence.js";
import type { Event, HelloFrame } from "./types.js";

const CHAIN = "gesprek";

function event(seq: number, node: string, ts = 1_700_000_000_000): Event {
  return { v: 1, chain: CHAIN, seq, id: `${node}-${String(seq)}`, node, ts, type: "message", data: { seq } };
}

function hello(node: string, haveSeq: number): HelloFrame {
  return { t: "hello", v: 1, chain: CHAIN, node, haveSeq };
}

/** Clock that only moves when the test says so. */
function clock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let value = start;
  return {
    now: () => value,
    advance: (ms: number) => {
      value += ms;
    },
  };
}

describe("presence", () => {
  it("the local node stays live in its own node list while the daemon runs", () => {
    const time = clock();
    const presence = new Presence({ self: { node: "a", chain: CHAIN }, now: time.now, ttlMs: 1_000 });
    presence.seeSelf(4);

    // No peer ever says anything; time passes well past the TTL.
    time.advance(DEFAULT_PRESENCE_TTL_MS * 10);

    const snapshot = presence.snapshot();
    const me = snapshot.live.find((entry) => entry.node === "a");
    assert.notEqual(me, undefined, "the local node is missing from its own live list");
    assert.equal(me?.live, true);
    assert.equal(me?.head, 4);
    assert.deepEqual(snapshot.stale, []);
    assert.equal(presence.isLive("a"), true);
    assert.equal(presence.head("a"), 4);
  });

  it("a peer without a sign of life still expires, and the local node does not", () => {
    const time = clock();
    const presence = new Presence({ self: { node: "a", chain: CHAIN }, now: time.now, ttlMs: 1_000 });
    presence.seeHello(hello("b", 3));
    assert.equal(presence.isLive("b"), true);

    time.advance(1_001);
    assert.equal(presence.isLive("b"), false);
    assert.equal(presence.isLive("a"), true);
    assert.deepEqual(
      presence.live().map((entry) => entry.node),
      ["a"],
    );
    assert.deepEqual(
      presence.stale().map((entry) => entry.node),
      ["b"],
    );
    assert.equal(presence.head("b"), undefined, "the head of an expired peer is not a live fact");
  });

  it("a local node never drops itself", () => {
    const presence = new Presence({ self: { node: "a", chain: CHAIN }, now: clock().now });
    presence.seeHello(hello("a", 1));
    presence.drop("a");
    assert.deepEqual(
      presence.live().map((entry) => entry.node),
      ["a"],
    );
  });

  it("a head reported for the local node is its own chain, not a peer's claim", () => {
    const presence = new Presence({ self: { node: "a", chain: CHAIN }, now: clock().now });
    presence.seeSelf(9);
    // A peer that reports us back does not lower or raise what we hold.
    presence.seeEvent(event(2, "a"), "inbound");
    assert.equal(presence.head("a"), 9);
  });

  it("absence of self-awareness keeps the old behaviour", () => {
    const time = clock();
    const presence = new Presence({ now: time.now, ttlMs: 1_000 });
    presence.seeEvent(event(1, "a"));
    time.advance(1_001);
    assert.deepEqual(presence.live(), []);
    assert.equal(presence.head("a"), undefined);
  });

  it("a peer that speaks again becomes live without a second entry", () => {
    const time = clock();
    const presence = new Presence({ self: { node: "a", chain: CHAIN }, now: time.now, ttlMs: 1_000 });
    presence.seeHello(hello("b", 2));
    time.advance(5_000);
    assert.equal(presence.isLive("b"), false);
    presence.seeEvent(event(3, "b"));
    assert.equal(presence.isLive("b"), true);
    assert.equal(presence.head("b"), 3);
    assert.equal(presence.snapshot().live.filter((entry) => entry.node === "b").length, 1);
  });
});
