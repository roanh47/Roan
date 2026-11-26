import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EnvEntry } from "../env/types.js";
import { applyImport, planImport } from "./apply.js";

function entry(path: string, content: string): EnvEntry {
  return {
    path,
    kind: "file",
    sha256: "0".repeat(64),
    size: Buffer.byteLength(content, "utf8"),
    encoding: "utf8",
    content,
  };
}

describe("planImport", () => {
  it("adds every entry whose target name is free", () => {
    const plan = planImport([], [entry("imported/AGENTS.md", "a"), entry("imported/SOUL.md", "s")]);
    assert.deepEqual(
      plan.adds.map((item) => item.path),
      ["imported/AGENTS.md", "imported/SOUL.md"],
    );
    assert.deepEqual(plan.conflicts, []);
  });

  it("reports an existing target as a conflict and leaves it out of adds", () => {
    const plan = planImport(
      ["AGENTS.md", "imported/CLAUDE.md"],
      [entry("imported/AGENTS.md", "new"), entry("imported/CLAUDE.md", "claude")],
    );

    assert.deepEqual(
      plan.adds.map((item) => item.path),
      ["imported/AGENTS.md"],
    );
    assert.equal(plan.conflicts.length, 1);
    assert.equal(plan.conflicts[0]?.path, "imported/CLAUDE.md");
    assert.equal(plan.conflicts[0]?.reason, "exists");
  });

  it("reports a duplicate target inside one batch instead of stacking it", () => {
    const plan = planImport([], [
      entry("imported/AGENTS.md", "first"),
      entry("imported/AGENTS.md", "second"),
    ]);

    assert.equal(plan.adds.length, 1);
    assert.equal(plan.adds[0]?.content, "first");
    assert.equal(plan.conflicts.length, 1);
    assert.equal(plan.conflicts[0]?.reason, "duplicate");
  });

  it("sorts adds and conflicts by path", () => {
    const plan = planImport(
      ["imported/MEMORY.md"],
      [entry("imported/SOUL.md", "s"), entry("imported/AGENTS.md", "a"), entry("imported/MEMORY.md", "m")],
    );

    assert.deepEqual(
      plan.adds.map((item) => item.path),
      ["imported/AGENTS.md", "imported/SOUL.md"],
    );
    assert.deepEqual(
      plan.conflicts.map((item) => item.path),
      ["imported/MEMORY.md"],
    );
  });

  it("does not mutate the inputs", () => {
    const existing = ["imported/CLAUDE.md"];
    const entries = [entry("imported/AGENTS.md", "a"), entry("imported/CLAUDE.md", "c")];
    const snapshot = structuredClone(entries);

    planImport(existing, entries);

    assert.deepEqual(existing, ["imported/CLAUDE.md"]);
    assert.deepEqual(entries, snapshot);
  });

  it("throws when the arguments are not arrays", () => {
    assert.throws(() => planImport(null as unknown as string[], []), /existingNames/);
    assert.throws(() => planImport([], null as unknown as EnvEntry[]), /entries/);
  });
});

describe("applyImport", () => {
  it("writes nothing without confirmation", () => {
    const plan = planImport([], [entry("imported/AGENTS.md", "a")]);
    assert.deepEqual(applyImport(plan, false), []);
  });

  it("returns the adds only when confirmed", () => {
    const plan = planImport(
      ["imported/CLAUDE.md"],
      [entry("imported/AGENTS.md", "a"), entry("imported/CLAUDE.md", "c")],
    );

    const written = applyImport(plan, true);
    assert.deepEqual(
      written.map((item) => item.path),
      ["imported/AGENTS.md"],
    );
    assert.equal(written[0]?.content, "a");
  });

  it("never writes a conflicting entry, even when confirmed", () => {
    const plan = planImport(["imported/AGENTS.md"], [entry("imported/AGENTS.md", "new")]);
    assert.deepEqual(plan.adds, []);
    assert.deepEqual(applyImport(plan, true), []);
  });

  it("hands back copies, so a caller cannot edit the plan through them", () => {
    const plan = planImport([], [entry("imported/AGENTS.md", "a")]);
    const written = applyImport(plan, true);
    const first = written[0];
    assert.ok(first !== undefined);
    first.content = "changed";
    assert.equal(plan.adds[0]?.content, "a");
  });
});
