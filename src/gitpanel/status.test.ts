import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  STATUS_ARGV,
  applyDiffStats,
  commitBlocker,
  diffStatArgv,
  mergeDiffStats,
  parseDiffStat,
  parseStatus,
  readDiffStat,
  readStatus,
  summarise,
  type CommandRunner,
} from "./status.js";

/**
 * Fixtures are the literal bytes git prints, NULs included. Nothing here runs
 * git: the two `read*` helpers take a runner that records its argv.
 */

function nul(...fields: string[]): string {
  return fields.map((field) => `${field}\u0000`).join("");
}

describe("parseStatus", () => {
  it("reads a clean tree as nothing at all", () => {
    const status = parseStatus("");

    assert.deepEqual(status.files, []);
    assert.deepEqual(status.staged, []);
    assert.deepEqual(status.unstaged, []);
    assert.deepEqual(status.untracked, []);
    assert.equal(summarise(status), "No changes");
  });

  it("splits staged, unstaged and untracked, and keeps a MM file in both", () => {
    const status = parseStatus(
      nul("MM src/a.ts", " M src/b.ts", "?? notes/new idea.md", "A  docs/x.md", "D  gone.ts"),
    );

    assert.deepEqual(
      status.files.map((file) => [file.path, file.code, file.staged, file.unstaged, file.untracked]),
      [
        ["src/a.ts", "MM", true, true, false],
        ["src/b.ts", " M", false, true, false],
        ["notes/new idea.md", "??", false, false, true],
        ["docs/x.md", "A ", true, false, false],
        ["gone.ts", "D ", true, false, false],
      ],
    );
    assert.deepEqual(status.staged.map((file) => file.path), ["src/a.ts", "docs/x.md", "gone.ts"]);
    assert.deepEqual(status.unstaged.map((file) => file.path), ["src/a.ts", "src/b.ts"]);
    assert.deepEqual(status.untracked.map((file) => file.path), ["notes/new idea.md"]);
    assert.equal(summarise(status), "3 staged, 2 unstaged, 1 untracked");
  });

  it("pairs a rename with its source path and keeps the new name as the path", () => {
    const status = parseStatus(nul("R  src/new.ts", "src/old.ts", " M after.ts"));

    assert.equal(status.files.length, 2);
    assert.deepEqual(status.files[0], {
      path: "src/new.ts",
      originalPath: "src/old.ts",
      code: "R ",
      staged: true,
      unstaged: false,
      untracked: false,
    });
    // The old path was consumed, not mistaken for a record of its own.
    assert.deepEqual(status.files[1]?.path, "after.ts");
    assert.equal(status.staged.length, 1);
  });

  it("handles a copy the same way", () => {
    const status = parseStatus(nul("C  b.ts", "a.ts"));

    assert.equal(status.files[0]?.path, "b.ts");
    assert.equal(status.files[0]?.originalPath, "a.ts");
    assert.equal(status.files[0]?.staged, true);
  });

  it("keeps spaces and newlines in a path, because NUL is the separator", () => {
    const status = parseStatus(nul("?? a b/c\nd.txt"));

    assert.equal(status.untracked[0]?.path, "a b/c\nd.txt");
  });

  it("reports ignored files separately and keeps them out of the buckets", () => {
    const status = parseStatus(nul("!! dist/x.js", "?? keep.md"));

    assert.deepEqual(status.ignored.map((file) => file.path), ["dist/x.js"]);
    assert.deepEqual(status.files.map((file) => file.path), ["keep.md"]);
    assert.equal(summarise(status), "1 untracked");
  });

  it("skips headers, blank fields and lines that are not records", () => {
    const status = parseStatus(nul("## main...origin/main", "", "garbage", "X", "?? real.ts"));

    assert.deepEqual(status.untracked.map((file) => file.path), ["real.ts"]);
  });

  it("accepts a newline-separated fixture, including the old -> new rename form", () => {
    const status = parseStatus("M  a.ts\r\n?? b.ts\r\nR  old.ts -> new.ts\r\n");

    assert.deepEqual(status.files.map((file) => file.path), ["a.ts", "b.ts", "new.ts"]);
    assert.equal(status.files[2]?.originalPath, "old.ts");
    assert.equal(status.untracked.length, 1);
  });
});

describe("parseDiffStat", () => {
  it("reads added and removed per file", () => {
    const stats = parseDiffStat("12\t3\tsrc/a.ts\n0\t7\tsrc/b.ts\n");

    assert.deepEqual(stats, [
      { path: "src/a.ts", added: 12, removed: 3, binary: false },
      { path: "src/b.ts", added: 0, removed: 7, binary: false },
    ]);
  });

  it("keeps a binary file as 0/0 with a flag instead of inventing counts", () => {
    assert.deepEqual(parseDiffStat("-\t-\tassets/logo.png"), [
      { path: "assets/logo.png", added: 0, removed: 0, binary: true },
    ]);
  });

  it("resolves both rename spellings to the new path", () => {
    const stats = parseDiffStat("4\t1\tsrc/{old => new}/file.ts\n9\t0\tbefore.ts => after.ts\n");

    assert.deepEqual(stats.map((entry) => entry.path), ["src/new/file.ts", "after.ts"]);
  });

  it("skips malformed lines and empty output", () => {
    assert.deepEqual(parseDiffStat(""), []);
    assert.deepEqual(parseDiffStat("no tabs here\n1\tonly-two\nx\ty\tkept.ts"), []);
  });
});

describe("mergeDiffStats", () => {
  it("adds the staged and unstaged counts for the same path", () => {
    const merged = mergeDiffStats(
      [{ path: "a.ts", added: 2, removed: 0, binary: false }],
      [
        { path: "a.ts", added: 1, removed: 5, binary: false },
        { path: "b.bin", added: 0, removed: 0, binary: true },
      ],
    );

    assert.deepEqual(merged, [
      { path: "a.ts", added: 3, removed: 5, binary: false },
      { path: "b.bin", added: 0, removed: 0, binary: true },
    ]);
  });
});

describe("applyDiffStats", () => {
  const status = parseStatus(nul("MM src/a.ts", "R  src/new.ts", "src/old.ts", "?? note.md"));

  it("attaches counts by path and by a rename's source", () => {
    const decorated = applyDiffStats(status, [
      { path: "src/a.ts", added: 4, removed: 2, binary: false },
      { path: "src/old.ts", added: 1, removed: 1, binary: false },
    ]);

    assert.deepEqual(decorated.files[0]?.stat, { added: 4, removed: 2, binary: false });
    assert.equal(decorated.files[1]?.originalPath, "src/old.ts");
    assert.deepEqual(decorated.files[1]?.stat, { added: 1, removed: 1, binary: false });
    // A file with no stat entry is left exactly as it was.
    assert.equal(decorated.files[2]?.stat, undefined);
    // The buckets carry the same decorated objects.
    assert.equal(decorated.staged[0]?.stat?.added, 4);
  });

  it("returns the status untouched when there are no stats", () => {
    assert.equal(applyDiffStats(status, []), status);
  });
});

describe("commitBlocker", () => {
  it("asks for a message first, then for something staged", () => {
    const unstagedOnly = parseStatus(nul(" M a.ts"));
    const staged = parseStatus(nul("M  a.ts"));

    assert.equal(commitBlocker(staged, "  "), "Write a commit message first.");
    assert.equal(commitBlocker(unstagedOnly, "fix"), "Nothing staged yet.");
    assert.equal(commitBlocker(staged, "fix"), null);
  });
});

describe("readStatus / readDiffStat", () => {
  it("asks the injected runner for porcelain v1 -z and parses the answer", async () => {
    const calls: string[][] = [];
    const run: CommandRunner = (argv) => {
      calls.push([...argv]);
      return Promise.resolve(nul("M  a.ts"));
    };

    const status = await readStatus(run);

    assert.deepEqual(calls[0], [...STATUS_ARGV]);
    assert.equal(status.staged[0]?.path, "a.ts");
  });

  it("passes --cached for the staged diffstat only", async () => {
    const calls: string[][] = [];
    const run: CommandRunner = (argv) => {
      calls.push([...argv]);
      return Promise.resolve("3\t0\ta.ts\n");
    };

    const working = await readDiffStat(run);
    const staged = await readDiffStat(run, { staged: true });

    assert.deepEqual(calls[0], [...diffStatArgv(false)]);
    assert.deepEqual(calls[1], [...diffStatArgv(true)]);
    assert.ok(calls[1]?.includes("--cached"));
    assert.deepEqual(working, staged);
  });
});
