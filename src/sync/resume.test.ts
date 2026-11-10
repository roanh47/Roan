import assert from "node:assert/strict";
import { test } from "node:test";
import { planResume, type ResumePlan, type ResumeSide } from "./resume.js";

/** A side with the events 1..head, ids being `<node>-<seq>`. */
function side(head: number, node = "a"): ResumeSide {
  const ids = new Map<number, string>();
  for (let seq = 1; seq <= head; seq++) ids.set(seq, `${node}-${seq}`);
  return { head, idAt: (seq: number) => ids.get(seq) };
}

/** A side built from explicit ids, keyed by seq. */
function withIds(head: number, ids: ReadonlyMap<number, string>): ResumeSide {
  return { head, idAt: (seq: number) => ids.get(seq) };
}

function mismatched(): ReadonlyMap<number, string> {
  const ids = new Map<number, string>([
    [1, "a-1"],
    [2, "a-2-other"],
    [3, "a-3"],
    [4, "b-4"],
    [5, "b-5"],
  ]);
  return ids;
}

function check(plan: ResumePlan, action: ResumePlan["action"], from: number): void {
  assert.equal(plan.action, action);
  assert.equal(plan.from, from);
  assert.equal(typeof plan.reason, "string");
  assert.ok(plan.reason.length > 0);
}

test("both sides empty: nothing to do", () => {
  check(planResume(side(0), side(0)), "none", 0);
});

test("equal heads: nothing to do", () => {
  check(planResume(side(3), side(3)), "none", 0);
});

test("remote ahead: pull starting after the local head", () => {
  const plan = planResume(side(2), side(5, "a"));
  check(plan, "pull", 3);
  assert.match(plan.reason, /from seq 3/);
});

test("remote ahead from an empty local chain: pull from seq 1", () => {
  check(planResume(side(0), side(4)), "pull", 1);
});

test("local ahead: push starting after the remote head", () => {
  const plan = planResume(side(6), side(4));
  check(plan, "push", 5);
  assert.match(plan.reason, /seq 5/);
});

test("an overlapping seq with a different id is a conflict naming that seq", () => {
  const local = side(3);
  const remote = withIds(5, mismatched());

  const plan = planResume(local, remote);
  check(plan, "conflict", 0);
  assert.match(plan.reason, /Seq 2/);
});

test("a conflict is reported before the head comparison", () => {
  const local = side(3);
  const remote = withIds(
    3,
    new Map<number, string>([
      [1, "a-1"],
      [2, "a-2"],
      [3, "b-3"],
    ]),
  );

  const plan = planResume(local, remote);
  check(plan, "conflict", 0);
  assert.match(plan.reason, /Seq 3/);
});

test("a side that cannot report an id is not treated as a conflict", () => {
  const remote: ResumeSide = { head: 2, idAt: () => undefined };
  check(planResume(side(4), remote), "push", 3);
});
