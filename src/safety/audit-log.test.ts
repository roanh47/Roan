import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAuditLog } from "./audit-log.js";
import type { AuditEntryInput } from "./audit-log.js";

/** Minimal valid entry; tests override only the field under test. */
function entry(overrides: Partial<AuditEntryInput> = {}): AuditEntryInput {
  return {
    tool: "read_file",
    decision: "allow",
    paths: ["/home/roan/notes.md"],
    reason: "inside the workspace",
    ...overrides,
  };
}

/** Record `count` entries into a log, returning the log. */
function fill(capacity: number, count: number) {
  const log = createAuditLog({ capacity });
  for (let index = 0; index < count; index += 1) {
    log.record(
      entry({
        tool: `tool_${index}`,
        decision: index % 2 === 0 ? "allow" : "ask",
      }),
    );
  }
  return log;
}

describe("createAuditLog capacity", () => {
  it("accepts any positive safe integer", () => {
    for (const capacity of [1, 2, 1000, Number.MAX_SAFE_INTEGER]) {
      const log = createAuditLog({ capacity });
      assert.equal(log.size(), 0);
    }
  });

  it("rejects a zero, negative, fractional or unsafe capacity", () => {
    for (const bad of [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      assert.throws(
        () => createAuditLog({ capacity: bad }),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.ok(error.message.includes(String(bad)), error.message);
          assert.ok(error.message.includes("capacity"), error.message);
          return true;
        },
      );
    }
  });

  it("rejects a capacity that is not a number at all", () => {
    const bad = "3" as unknown as number;
    assert.throws(
      () => createAuditLog({ capacity: bad }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes("3"), error.message);
        return true;
      },
    );
  });
});

describe("record validation", () => {
  it("rejects an empty or blank tool, naming the value", () => {
    for (const tool of ["", "   ", "\n\t"]) {
      assert.throws(
        () => createAuditLog({ capacity: 4 }).record(entry({ tool })),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.ok(error.message.includes(JSON.stringify(tool)), error.message);
          assert.ok(error.message.includes("tool"), error.message);
          return true;
        },
      );
    }
  });

  it("rejects an unknown decision, naming the value", () => {
    const bad = "maybe" as unknown as AuditEntryInput["decision"];
    assert.throws(
      () => createAuditLog({ capacity: 4 }).record(entry({ decision: bad })),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes("maybe"), error.message);
        assert.ok(error.message.includes("decision"), error.message);
        return true;
      },
    );
  });

  it("rejects paths that are not an array, naming what arrived", () => {
    const cases: ReadonlyArray<readonly [unknown, string]> = [
      ["/home/roan/notes.md", '"/home/roan/notes.md"'],
      [null, "null"],
      [{ path: "/x" }, "[object Object]"],
      [undefined, "undefined"],
      [7, "7"],
    ];
    for (const [paths, expected] of cases) {
      assert.throws(
        () =>
          createAuditLog({ capacity: 4 }).record(
            entry({ paths: paths as unknown as readonly string[] }),
          ),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.ok(error.message.includes(expected), error.message);
          assert.ok(error.message.includes("paths"), error.message);
          return true;
        },
      );
    }
  });

  it("does not store an entry that failed validation", () => {
    const log = createAuditLog({ capacity: 4 });
    assert.throws(() => log.record(entry({ tool: "" })));
    assert.equal(log.size(), 0);
    assert.deepEqual(log.list(), []);
  });
});

describe("record sequence and eviction", () => {
  it("stamps entries with a monotonic sequence starting at 1", () => {
    const log = fill(4, 3);
    assert.deepEqual(
      log.list().map((stored) => stored.seq),
      [1, 2, 3],
    );
  });

  it("returns the stamped entry from record", () => {
    const log = createAuditLog({ capacity: 2 });
    const stored = log.record(entry({ tool: "write_file", decision: "deny" }));
    assert.equal(stored.seq, 1);
    assert.equal(stored.tool, "write_file");
    assert.equal(stored.decision, "deny");
  });

  it("keeps only the last `capacity` entries", () => {
    const log = fill(3, 10);
    assert.equal(log.size(), 3);
    assert.deepEqual(
      log.list().map((stored) => [stored.seq, stored.tool]),
      [
        [8, "tool_7"],
        [9, "tool_8"],
        [10, "tool_9"],
      ],
    );
  });

  it("keeps counting sequence numbers after eviction", () => {
    const log = createAuditLog({ capacity: 1 });
    log.record(entry());
    log.record(entry());
    const [only] = log.list();
    assert.ok(only);
    assert.equal(only.seq, 2);
  });

  it("lists oldest first", () => {
    const log = fill(5, 5);
    const seqs = log.list().map((stored) => stored.seq);
    assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
  });

  it("holds nothing at capacity 1 until the first record", () => {
    const log = createAuditLog({ capacity: 1 });
    assert.equal(log.size(), 0);
    assert.deepEqual(log.toLines(), []);
    log.record(entry());
    assert.equal(log.size(), 1);
  });
});

describe("list", () => {
  it("returns a frozen array of frozen entries and paths", () => {
    const log = fill(2, 2);
    const listed = log.list();
    assert.ok(Object.isFrozen(listed));
    for (const stored of listed) {
      assert.ok(Object.isFrozen(stored));
      assert.ok(Object.isFrozen(stored.paths));
    }
  });

  it("cannot be mutated through the returned copy", () => {
    const log = fill(2, 1);
    const listed = log.list();
    const [stored] = listed;
    assert.ok(stored);

    assert.throws(() => {
      (listed as unknown as unknown[]).push({});
    }, TypeError);
    assert.throws(() => {
      (stored as { tool: string }).tool = "other";
    }, TypeError);
    assert.throws(() => {
      (stored.paths as string[]).push("/etc/passwd");
    }, TypeError);
    assert.throws(() => {
      (stored as { reason: string }).reason = "changed";
    }, TypeError);

    // The log itself is untouched by any of those attempts.
    const again = log.list();
    assert.equal(again.length, 1);
    assert.equal(again[0]?.tool, "tool_0");
    assert.deepEqual(again[0]?.paths, ["/home/roan/notes.md"]);
  });

  it("does not expose the caller's paths array", () => {
    const paths = ["/home/roan/a.md"];
    const log = createAuditLog({ capacity: 2 });
    log.record(entry({ paths }));
    paths.push("/home/roan/b.md");
    assert.deepEqual(log.list()[0]?.paths, ["/home/roan/a.md"]);
  });

  it("hands out a fresh copy on every call", () => {
    const log = fill(2, 1);
    const first = log.list();
    const second = log.list();
    assert.notStrictEqual(first, second);
    assert.notStrictEqual(first[0], second[0]);
    assert.deepEqual(first, second);
  });
});

describe("toLines", () => {
  it("renders one line per entry, oldest first, carrying every field", () => {
    const log = createAuditLog({ capacity: 4 });
    log.record(
      entry({
        tool: "delete_file",
        decision: "deny",
        paths: ["/home/roan/secrets.env", "/etc/shadow"],
        reason: "outside the workspace",
      }),
    );
    log.record(entry({ tool: "read_file", decision: "allow", paths: [] }));

    const lines = log.toLines();
    assert.equal(lines.length, 2);
    const [first, second] = lines;
    assert.ok(first);
    assert.ok(second);

    assert.ok(first.includes("delete_file"), first);
    assert.ok(first.includes("deny"), first);
    assert.ok(first.includes("/home/roan/secrets.env"), first);
    assert.ok(first.includes("/etc/shadow"), first);
    assert.ok(first.includes("outside the workspace"), first);

    assert.ok(second.includes("read_file"), second);
    assert.ok(second.includes("allow"), second);
    assert.equal(lines.filter((line) => line.includes("\n")).length, 0);
  });

  it("flattens line breaks out of fields", () => {
    const log = createAuditLog({ capacity: 2 });
    log.record(
      entry({
        tool: "shell",
        paths: ["/home/roan/a\nb.md"],
        reason: "line one\r\nline two\u2028line three",
      }),
    );
    const [line] = log.toLines();
    assert.ok(line);
    assert.equal(line.includes("\n"), false, line);
    assert.equal(line.includes("\r"), false, line);
    assert.ok(line.includes("line one"), line);
    assert.ok(line.includes("line three"), line);
    assert.equal(log.toLines().length, 1);
  });

  it("shows the retained window only", () => {
    const log = fill(2, 3);
    const lines = log.toLines();
    assert.equal(lines.length, 2);
    const [first, second] = lines;
    assert.ok(first);
    assert.ok(second);
    assert.ok(first.includes("tool_1"), first);
    assert.ok(second.includes("tool_2"), second);
  });
});
