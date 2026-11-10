import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePolicy, planRotation } from "./log-rotate.js";

const policy = { maxFiles: 5, maxBytes: 1024 };

describe("parsePolicy", () => {
  it("keeps an in-range policy as given", () => {
    assert.deepEqual(parsePolicy({ maxFiles: 3, maxBytes: 4096 }), {
      maxFiles: 3,
      maxBytes: 4096,
    });
  });

  it("clamps maxFiles into 1..50", () => {
    assert.equal(parsePolicy({ maxFiles: 0, maxBytes: 1024 }).maxFiles, 1);
    assert.equal(parsePolicy({ maxFiles: -7, maxBytes: 1024 }).maxFiles, 1);
    assert.equal(parsePolicy({ maxFiles: 500, maxBytes: 1024 }).maxFiles, 50);
  });

  it("clamps maxBytes into 1024..1 GiB", () => {
    assert.equal(parsePolicy({ maxFiles: 3, maxBytes: 1 }).maxBytes, 1024);
    assert.equal(parsePolicy({ maxFiles: 3, maxBytes: 0 }).maxBytes, 1024);
    assert.equal(parsePolicy({ maxFiles: 3, maxBytes: 5 * 1024 ** 3 }).maxBytes, 1024 ** 3);
    assert.equal(parsePolicy({ maxFiles: 3, maxBytes: 1024 ** 3 }).maxBytes, 1024 ** 3);
  });

  it("floors a fractional value before clamping", () => {
    assert.equal(parsePolicy({ maxFiles: 3.9, maxBytes: 2048.8 }).maxFiles, 3);
    assert.equal(parsePolicy({ maxFiles: 3.9, maxBytes: 2048.8 }).maxBytes, 2048);
  });

  it("throws naming the field and value when maxFiles is not a number", () => {
    assert.throws(
      () => parsePolicy({ maxFiles: "ten", maxBytes: 2048 }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes("maxFiles"), error.message);
        assert.ok(error.message.includes('"ten"'), error.message);
        return true;
      },
    );
  });

  it("throws naming the field and value when maxBytes is not finite", () => {
    assert.throws(
      () => parsePolicy({ maxFiles: 3, maxBytes: Number.POSITIVE_INFINITY }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes("maxBytes"), error.message);
        assert.ok(error.message.includes("Infinity"), error.message);
        return true;
      },
    );
  });

  it("throws naming the field when a value is missing", () => {
    assert.throws(
      () => parsePolicy({ maxFiles: 3 }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes("maxBytes"), error.message);
        assert.ok(error.message.includes("undefined"), error.message);
        return true;
      },
    );
  });

  it("rejects a non-object policy", () => {
    assert.throws(() => parsePolicy(null), /must be an object/);
    assert.throws(() => parsePolicy("policy"), /must be an object/);
  });
});

describe("planRotation", () => {
  it("shifts existing suffixes up, newest first, with the active file last", () => {
    const plan = planRotation(
      [
        { path: "/logs/roan.log", size: 4096 },
        { path: "/logs/roan.log.1", size: 2048 },
        { path: "/logs/roan.log.2", size: 1024 },
      ],
      policy,
    );

    assert.deepEqual(plan.renames, [
      { from: "/logs/roan.log.2", to: "/logs/roan.log.3" },
      { from: "/logs/roan.log.1", to: "/logs/roan.log.2" },
      { from: "/logs/roan.log", to: "/logs/roan.log.1" },
    ]);
    assert.deepEqual(plan.remove, []);
  });

  it("deletes suffixes that would exceed maxFiles", () => {
    const plan = planRotation(
      [
        { path: "/logs/roan.log", size: 4096 },
        { path: "/logs/roan.log.1", size: 2048 },
        { path: "/logs/roan.log.2", size: 1024 },
      ],
      { maxFiles: 2, maxBytes: 1024 },
    );

    assert.deepEqual(plan.remove, ["/logs/roan.log.2"]);
    assert.deepEqual(plan.renames, [
      { from: "/logs/roan.log.1", to: "/logs/roan.log.2" },
      { from: "/logs/roan.log", to: "/logs/roan.log.1" },
    ]);
  });

  it("does nothing when the active file is at or under maxBytes", () => {
    const atLimit = planRotation([{ path: "/logs/roan.log", size: 1024 }], policy);
    assert.deepEqual(atLimit, { renames: [], remove: [] });

    const under = planRotation(
      [
        { path: "/logs/roan.log", size: 10 },
        { path: "/logs/roan.log.1", size: 10 },
      ],
      policy,
    );
    assert.deepEqual(under, { renames: [], remove: [] });
  });

  it("keeps log families independent and plans each on its own", () => {
    const plan = planRotation(
      [
        { path: "/logs/a.log", size: 4096 },
        { path: "/logs/a.log.1", size: 10 },
        { path: "/logs/b.log", size: 10 },
        { path: "/logs/b.log.1", size: 10 },
      ],
      policy,
    );

    assert.deepEqual(plan.renames, [
      { from: "/logs/a.log.1", to: "/logs/a.log.2" },
      { from: "/logs/a.log", to: "/logs/a.log.1" },
    ]);
    assert.deepEqual(plan.remove, []);
  });

  it("never returns a rename onto a name that a later rename still occupies", () => {
    const plan = planRotation(
      [
        { path: "x.log", size: 2048 },
        { path: "x.log.1", size: 2048 },
        { path: "x.log.2", size: 2048 },
        { path: "x.log.3", size: 2048 },
      ],
      { maxFiles: 3, maxBytes: 1024 },
    );

    const targets = plan.renames.map((rename) => rename.to);
    assert.equal(new Set(targets).size, targets.length);
    assert.deepEqual(plan.remove, ["x.log.3"]);
    assert.deepEqual(plan.renames, [
      { from: "x.log.2", to: "x.log.3" },
      { from: "x.log.1", to: "x.log.2" },
      { from: "x.log", to: "x.log.1" },
    ]);
  });
});
