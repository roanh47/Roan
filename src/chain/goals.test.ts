import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Event, EventType } from "../protocol/types.js";
import { activeGoals, foldGoals, goalContext } from "./goals.js";

/**
 * Sits next to the source because tsconfig includes only "src" and `npm test`
 * runs the compiled dist/**\/*.test.js. The fold reads type, ts and data only,
 * so events are built by hand; no store and no clock are involved.
 */

const CHAIN = "main";
const NODE = "node-a";
const T0 = 1_700_000_000_000;

function event(seq: number, type: EventType, data: unknown): Event {
  return { v: 1, chain: CHAIN, seq, id: `id-${seq}`, node: NODE, ts: T0 + seq, type, data };
}

function goal(seq: number, id: string, text: string, createdAt: number, status: string = "open"): Event {
  return event(seq, "goal", { id, text, status, createdAt });
}

function update(seq: number, id: string, data: Record<string, unknown>): Event {
  return event(seq, "goal_update", { goal: id, ...data });
}

describe("foldGoals", () => {
  it("orders goals by createdAt, not by chain order", () => {
    const goals = foldGoals([
      goal(1, "g-late", "ship the app", T0 + 3000),
      goal(2, "g-early", "write the tests", T0 + 1000),
      goal(3, "g-mid", "read PLAN.md", T0 + 2000),
    ]);

    assert.deepEqual(
      goals.map((entry) => entry.id),
      ["g-early", "g-mid", "g-late"],
    );
    assert.deepEqual(
      goals.map((entry) => entry.text),
      ["write the tests", "read PLAN.md", "ship the app"],
    );
  });

  it("keeps the newest event per goal and drops older rewrites", () => {
    const goals = foldGoals([
      goal(1, "g1", "old text", T0 + 1000),
      goal(2, "g1", "new text", T0 + 2000),
    ]);

    assert.equal(goals.length, 1);
    assert.equal(goals[0]?.text, "new text");
    assert.equal(goals[0]?.createdAt, T0 + 2000);
  });

  it("ignores a goal_update for a goal it has never seen", () => {
    const goals = foldGoals([
      goal(1, "g1", "real goal", T0 + 1000),
      update(2, "ghost", { status: "done", note: "close it" }),
      update(3, "g1", { note: "step one done" }),
    ]);

    assert.equal(goals.length, 1);
    assert.equal(goals[0]?.id, "g1");
    assert.equal(goals[0]?.note, "step one done");
    assert.equal(activeGoals(goals).length, 1);
  });

  it("ignores an update that arrives before its goal", () => {
    const goals = foldGoals([
      update(1, "g1", { status: "done" }),
      goal(2, "g1", "created later", T0 + 1000),
    ]);

    assert.equal(goals.length, 1);
    assert.equal(goals[0]?.status, "open");
  });

  it("applies status transitions and keeps the note that came with them", () => {
    let goals = foldGoals([goal(1, "g1", "do the thing", T0 + 1000)]);
    assert.equal(goals[0]?.status, "open");

    goals = foldGoals([
      goal(1, "g1", "do the thing", T0 + 1000),
      update(2, "g1", { status: "done", note: "finished in one turn" }),
    ]);
    assert.equal(goals[0]?.status, "done");
    assert.equal(goals[0]?.note, "finished in one turn");
    assert.deepEqual(activeGoals(goals), []);

    goals = foldGoals([
      goal(1, "g1", "do the thing", T0 + 1000),
      update(2, "g1", { status: "done" }),
      update(3, "g1", { status: "open", note: "reopened: the check failed" }),
    ]);
    assert.equal(goals[0]?.status, "open");
    assert.equal(activeGoals(goals).length, 1);

    goals = foldGoals([
      goal(1, "g1", "do the thing", T0 + 1000),
      update(2, "g1", { status: "cancelled" }),
    ]);
    assert.equal(goals[0]?.status, "cancelled");
  });

  it("rejects an unknown status instead of inventing one", () => {
    const goals = foldGoals([
      goal(1, "g1", "text", T0 + 1000),
      update(2, "g1", { status: "paused" }),
    ]);

    assert.equal(goals[0]?.status, "open");
  });

  it("returns an empty list for gibberish payloads", () => {
    assert.deepEqual(foldGoals([]), []);
    assert.deepEqual(
      foldGoals([event(1, "goal", null), event(2, "goal", { text: "no id" }), event(3, "goal", "nope")]),
      [],
    );
  });
});

describe("goalContext", () => {
  it("is empty when there is nothing open", () => {
    assert.equal(goalContext([]), "");
    const closed = foldGoals([
      goal(1, "g1", "done one", T0 + 1000),
      update(2, "g1", { status: "done" }),
    ]);
    assert.equal(goalContext(closed), "");
  });

  it("names the open goals, one line each", () => {
    const goals = foldGoals([
      goal(1, "g1", "keep the chain append-only", T0 + 1000),
      goal(2, "g2", "ask before touching dist/", T0 + 2000),
      goal(3, "g3", "old order", T0 + 3000),
      update(4, "g3", { status: "cancelled" }),
    ]);

    assert.equal(
      goalContext(goals),
      "Standing orders:\n- keep the chain append-only\n- ask before touching dist/",
    );
  });

  it("accepts an already filtered list", () => {
    const goals = foldGoals([goal(1, "g1", "one", T0 + 1000), goal(2, "g2", "two", T0 + 2000)]);

    assert.equal(goalContext(activeGoals(goals)), "Standing orders:\n- one\n- two");
  });
});
