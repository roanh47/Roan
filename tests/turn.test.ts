import assert from "node:assert/strict";
import test from "node:test";

import {
  acquire,
  deriveTurnState,
  release,
  SeqConflictError,
  TurnLockError,
} from "../src/turn/lock.ts";
import type {
  Event,
  TurnEventDraft,
  TurnStore,
} from "../src/turn/lock.ts";

/**
 * Minimal in-memory chain. `append` enforces the same compare-and-append rule
 * the real store must: the expected seq has to still be the next free one.
 */
class MemoryStore implements TurnStore {
  readonly events: Event[] = [];
  clock = 0;

  async tail(_chain: string, limit: number): Promise<readonly Event[]> {
    return this.events.slice(Math.max(0, this.events.length - limit));
  }

  async append(
    chain: string,
    expectedSeq: number,
    draft: TurnEventDraft,
  ): Promise<Event> {
    const head = this.events.at(-1)?.seq ?? 0;
    if (head + 1 !== expectedSeq) {
      throw new SeqConflictError(expectedSeq, head);
    }
    const event: Event = {
      v: 1,
      chain,
      seq: expectedSeq,
      id: `e${expectedSeq}`,
      node: draft.node,
      ts: this.clock,
      type: draft.type,
      data: draft.data,
    };
    this.events.push(event);
    return event;
  }
}

function start(
  seq: number,
  node: string,
  ts: number,
  type: "turn_start" | "turn_end" = "turn_start",
): Event {
  return {
    v: 1,
    chain: "c1",
    seq,
    id: `e${seq}`,
    node,
    ts,
    type,
    data: {},
  };
}

test("an open turn blocks a second node without writing anything", async () => {
  const store = new MemoryStore();
  store.clock = 1_000;
  const first = await acquire(store, "c1", "pc", { now: 1_000, ttlMs: 60_000 });
  if (first.state !== "granted") assert.fail("first acquire should be granted");

  store.clock = 1_100;
  const second = await acquire(store, "c1", "phone", {
    now: 1_100,
    ttlMs: 60_000,
  });
  if (second.state !== "busy") assert.fail("second acquire should be busy");

  assert.equal(second.owner, "pc");
  assert.equal(second.startedAt, 1_000);
  assert.equal(second.lastActivityAt, 1_000);
  assert.equal(second.expiresAt, 61_000);
  assert.equal(store.events.length, 1, "a blocked node must not append");
  assert.equal(deriveTurnState(store.events).owner, "pc");
});

test("a silent turn is reclaimed after the TTL, but not before", async () => {
  const store = new MemoryStore();
  const ttlMs = 10_000;
  const granted = await acquire(store, "c1", "pc", { now: 0, ttlMs });
  if (granted.state !== "granted") assert.fail("pc should get the turn");

  const justBefore = await acquire(store, "c1", "phone", {
    now: ttlMs - 1,
    ttlMs,
  });
  assert.equal(justBefore.state, "busy", "still within the TTL");
  assert.equal(store.events.length, 1);

  store.clock = ttlMs;
  const reclaimed = await acquire(store, "c1", "phone", {
    now: ttlMs,
    ttlMs,
  });
  if (reclaimed.state !== "granted") assert.fail("phone should reclaim");

  assert.equal(reclaimed.event.node, "phone");
  assert.equal(store.events.length, 2);
  const state = deriveTurnState(store.events, { now: ttlMs, ttlMs });
  assert.ok(state.open);
  assert.equal(state.owner, "phone");
  assert.equal(state.startedAt, ttlMs);
});

test("activity from the owner extends the expiry deadline", async () => {
  const store = new MemoryStore();
  const ttlMs = 10_000;
  await acquire(store, "c1", "pc", { now: 0, ttlMs });
  store.events.push({
    v: 1,
    chain: "c1",
    seq: 2,
    id: "e2",
    node: "pc",
    ts: 8_000,
    type: "assistant_text",
    data: {},
  });

  const atTwelve = await acquire(store, "c1", "phone", {
    now: 12_000,
    ttlMs,
  });
  assert.equal(atTwelve.state, "busy", "8s of silence is not expiry");

  store.clock = 18_000;
  const atNineteen = await acquire(store, "c1", "phone", {
    now: 18_000,
    ttlMs,
  });
  assert.equal(atNineteen.state, "granted", "18s after last activity");

  const state = deriveTurnState(store.events, { now: 18_000, ttlMs });
  assert.ok(state.open);
  assert.equal(state.owner, "phone");
});

test("a non-owner cannot release and the chain is untouched", async () => {
  const store = new MemoryStore();
  await acquire(store, "c1", "pc", { now: 0, ttlMs: 60_000 });

  await assert.rejects(
    release(store, "c1", "phone", { now: 1_000 }),
    (error: unknown) =>
      error instanceof TurnLockError && error.code === "not-turn-owner",
  );
  assert.equal(store.events.length, 1);
  assert.equal(store.events[0]?.type, "turn_start");
  assert.equal(deriveTurnState(store.events).open, true);
});

test("the owner can release, and the next node can then take the turn", async () => {
  const store = new MemoryStore();
  const granted = await acquire(store, "c1", "pc", { now: 0, ttlMs: 60_000 });
  if (granted.state !== "granted") assert.fail("pc should get the turn");

  store.clock = 500;
  const ended = await release(store, "c1", "pc", { now: 500 });
  assert.equal(ended.type, "turn_end");
  assert.equal(deriveTurnState(store.events).open, false);

  const next = await acquire(store, "c1", "phone", {
    now: 600,
    ttlMs: 60_000,
  });
  if (next.state !== "granted") assert.fail("phone should now get the turn");
  assert.equal(deriveTurnState(store.events).owner, "phone");
});

test("releasing with no open turn throws", async () => {
  const store = new MemoryStore();
  await assert.rejects(
    release(store, "c1", "pc"),
    (error: unknown) =>
      error instanceof TurnLockError && error.code === "no-open-turn",
  );
  assert.equal(store.events.length, 0);
});

test("two nodes racing for an empty chain: exactly one wins", async () => {
  const store = new MemoryStore();
  const results = await Promise.all([
    acquire(store, "c1", "pc", { now: 1_000, ttlMs: 60_000 }),
    acquire(store, "c1", "phone", { now: 1_000, ttlMs: 60_000 }),
  ]);

  const granted = results.filter((result) => result.state === "granted");
  const busy = results.filter((result) => result.state === "busy");
  assert.equal(granted.length, 1);
  assert.equal(busy.length, 1);
  assert.equal(store.events.length, 1);

  const winner = granted[0];
  const loser = busy[0];
  if (winner === undefined || winner.state !== "granted") {
    assert.fail("expected exactly one granted result");
  }
  if (loser === undefined || loser.state !== "busy") {
    assert.fail("expected exactly one busy result");
  }
  assert.equal(loser.owner, winner.event.node);
});

test("a foreign turn_end cannot close the owner's turn", () => {
  const state = deriveTurnState([
    start(1, "pc", 1_000),
    start(2, "phone", 1_100, "turn_end"),
  ]);
  assert.ok(state.open);
  assert.equal(state.owner, "pc");
  assert.equal(state.startedAt, 1_000);
});

test("invalid arguments throw a named error", async () => {
  const store = new MemoryStore();
  await assert.rejects(
    acquire(store, "c1", "  "),
    (error: unknown) =>
      error instanceof TurnLockError && error.code === "invalid-argument",
  );
  await assert.rejects(
    acquire(store, "c1", "pc", { ttlMs: 0 }),
    (error: unknown) =>
      error instanceof TurnLockError && error.code === "invalid-argument",
  );
});
