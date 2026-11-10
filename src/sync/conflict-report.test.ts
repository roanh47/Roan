import assert from "node:assert/strict";
import { test } from "node:test";
import { describeConflict, type ConflictReport, type Side } from "./conflict-report.js";

/** A side with the events 1..head, ids being `<node>-<seq>`. */
function side(head: number, node = "a"): Side {
  const ids = new Map<number, string>();
  for (let seq = 1; seq <= head; seq++) ids.set(seq, `${node}-${seq}`);
  return { head, idAt: (seq: number) => ids.get(seq) };
}

/** A side built from explicit ids, keyed by seq. */
function withIds(head: number, ids: ReadonlyMap<number, string>): Side {
  return { head, idAt: (seq: number) => ids.get(seq) };
}

function check(report: ConflictReport, kind: ConflictReport["kind"]): void {
  assert.equal(report.kind, kind);
  assert.ok(report.lines.length > 0, "expected at least one line");
  for (const line of report.lines) {
    assert.equal(typeof line, "string");
    assert.ok(line.length > 0);
  }
}

test("a matching chain reports no difference", () => {
  const report = describeConflict(side(4), side(4));

  check(report, "none");
  assert.match(report.lines.join(" "), /seq 4/);
});

test("both sides empty is still a match", () => {
  check(describeConflict(side(0), side(0)), "none");
});

test("local ahead: the line names local and the size of the gap", () => {
  const report = describeConflict(side(6), side(4));

  check(report, "ahead");
  const text = report.lines.join(" ");
  assert.match(text, /local is ahead of remote/);
  assert.match(text, /by 2 events/);
  assert.match(text, /from seq 5/);
});

test("remote ahead: the line names remote and the size of the gap", () => {
  const report = describeConflict(side(2), side(5, "a"));

  check(report, "ahead");
  const text = report.lines.join(" ");
  assert.match(text, /remote is ahead of local/);
  assert.match(text, /by 3 events/);
  assert.match(text, /from seq 3/);
});

test("a one-event gap is singular", () => {
  const report = describeConflict(side(3), side(2));

  check(report, "ahead");
  assert.match(report.lines.join(" "), /by 1 event\b/);
});

test("an empty local chain against a populated remote is ahead, not a conflict", () => {
  const report = describeConflict(side(0), side(3));

  check(report, "ahead");
  assert.match(report.lines.join(" "), /from seq 1/);
});

test("a shared seq with different ids is a conflict naming that seq and both ids", () => {
  const remote = withIds(
    5,
    new Map<number, string>([
      [1, "a-1"],
      [2, "b-2"],
      [3, "b-3"],
      [4, "b-4"],
      [5, "b-5"],
    ]),
  );

  const report = describeConflict(side(3), remote);

  check(report, "conflict");
  const text = report.lines.join(" ");
  assert.match(text, /Seq 2/);
  assert.match(text, /a-2/);
  assert.match(text, /b-2/);
});

test("the first differing seq wins even when later seqs also differ", () => {
  const local = side(3);
  const remote = withIds(
    3,
    new Map<number, string>([
      [1, "a-1"],
      [2, "b-2"],
      [3, "b-3"],
    ]),
  );

  const report = describeConflict(local, remote);

  check(report, "conflict");
  assert.match(report.lines.join(" "), /Seq 2/);
});

test("a hole in idAt on one side is not treated as a conflict", () => {
  const holey: Side = {
    head: 3,
    idAt: (seq: number) => (seq === 2 ? undefined : `a-${seq}`),
  };

  const report = describeConflict(side(3), holey);

  check(report, "none");
});

test("a hole on one side does not hide a real difference at another seq", () => {
  const holey: Side = {
    head: 4,
    idAt: (seq: number) => {
      if (seq === 2) return undefined;
      if (seq === 4) return "b-4";
      return `a-${seq}`;
    },
  };

  const report = describeConflict(side(4), holey);

  check(report, "conflict");
  assert.match(report.lines.join(" "), /Seq 4/);
});

test("a side that never reports an id is ahead-tolerated, not a conflict", () => {
  const silent: Side = { head: 2, idAt: () => undefined };

  check(describeConflict(side(4), silent), "ahead");
});

test("a negative local head throws naming the field and the side", () => {
  assert.throws(
    () => describeConflict({ head: -1, idAt: () => undefined }, side(0)),
    /local\.head must not be negative/,
  );
});

test("a negative remote head throws naming the field and the side", () => {
  assert.throws(
    () => describeConflict(side(0), { head: -2, idAt: () => undefined }),
    /remote\.head must not be negative/,
  );
});

test("a non-integer head throws naming the field and the side", () => {
  assert.throws(
    () => describeConflict({ head: 1.5, idAt: () => undefined }, side(0)),
    /local\.head must be an integer/,
  );
  assert.throws(
    () => describeConflict(side(0), { head: Number.NaN, idAt: () => undefined }),
    /remote\.head must be an integer/,
  );
});

test("heads are validated even when the shared range is empty", () => {
  assert.throws(
    () => describeConflict({ head: -1, idAt: () => undefined }, { head: -1, idAt: () => undefined }),
    /local\.head must not be negative/,
  );
});
