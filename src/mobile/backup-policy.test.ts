import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeBackupPolicy,
  included,
  neverIncluded,
  parseSchedule,
  type BackupSchedule,
} from "./backup-policy.js";

const DEFAULTS: BackupSchedule = { everyHours: 24, keep: 7 };

const ENTRIES = { everyHours: 12, keep: 5 };

function messageOf(error: unknown): string {
  assert.equal(error instanceof Error, true);
  return (error as Error).message;
}

describe("backup entries", () => {
  it("covers the four included categories", () => {
    const paths = included.map((entry) => entry.path);

    assert.deepEqual(paths, [
      "env/snapshot.json",
      "sessions/",
      "skills/",
      "config/",
    ]);
  });

  it("keeps secrets, keys, tokens and logs out", () => {
    const paths = neverIncluded.map((entry) => entry.path);

    assert.equal(paths.includes("secrets/"), true);
    assert.equal(
      paths.some((path) => path.includes("api-keys")),
      true,
    );
    assert.equal(
      paths.some((path) => path.includes("tokens")),
      true,
    );
    assert.equal(paths.includes("logs/"), true);
  });

  it("gives every entry a non-empty reason", () => {
    for (const entry of [...included, ...neverIncluded]) {
      assert.notEqual(entry.label.trim(), "");
      assert.notEqual(entry.reason.trim(), "");
    }
  });

  it("never overlaps the included and never-included lists", () => {
    const excluded = new Set(neverIncluded.map((entry) => entry.path));

    for (const entry of included) {
      assert.equal(excluded.has(entry.path), false);
    }
  });
});

describe("parseSchedule", () => {
  it("uses defaults for missing fields", () => {
    assert.deepEqual(parseSchedule({}, DEFAULTS), DEFAULTS);
    assert.deepEqual(parseSchedule(undefined, DEFAULTS), DEFAULTS);
    assert.deepEqual(parseSchedule(null, DEFAULTS), DEFAULTS);
  });

  it("keeps in-range values as they are", () => {
    assert.deepEqual(parseSchedule(ENTRIES, DEFAULTS), {
      everyHours: 12,
      keep: 5,
    });
  });

  it("clamps everyHours at the low end", () => {
    assert.equal(parseSchedule({ everyHours: 0, keep: 5 }, DEFAULTS).everyHours, 1);
    assert.equal(parseSchedule({ everyHours: -48 }, DEFAULTS).everyHours, 1);
  });

  it("clamps everyHours at the high end", () => {
    assert.equal(parseSchedule({ everyHours: 169 }, DEFAULTS).everyHours, 168);
    assert.equal(parseSchedule({ everyHours: 100_000 }, DEFAULTS).everyHours, 168);
  });

  it("clamps keep at the low end", () => {
    assert.equal(parseSchedule({ keep: 0 }, DEFAULTS).keep, 1);
    assert.equal(parseSchedule({ keep: -3 }, DEFAULTS).keep, 1);
  });

  it("clamps keep at the high end", () => {
    assert.equal(parseSchedule({ keep: 31 }, DEFAULTS).keep, 30);
    assert.equal(parseSchedule({ keep: 999 }, DEFAULTS).keep, 30);
  });

  it("keeps everyHours on the boundary values", () => {
    assert.equal(parseSchedule({ everyHours: 1 }, DEFAULTS).everyHours, 1);
    assert.equal(parseSchedule({ everyHours: 168 }, DEFAULTS).everyHours, 168);
  });

  it("names everyHours when it is not a finite number", () => {
    assert.throws(
      () => parseSchedule({ everyHours: "soon" }, DEFAULTS),
      (error: unknown) => {
        const message = messageOf(error);
        assert.equal(/field "everyHours"/.test(message), true);
        assert.equal(/must be a finite number/.test(message), true);
        return true;
      },
    );
    assert.throws(
      () => parseSchedule({ everyHours: Number.NaN }, DEFAULTS),
      /field "everyHours"/,
    );
    assert.throws(
      () => parseSchedule({ everyHours: Number.POSITIVE_INFINITY }, DEFAULTS),
      /field "everyHours"/,
    );
    assert.throws(
      () => parseSchedule({ everyHours: "12" }, DEFAULTS),
      /field "everyHours"/,
    );
  });

  it("names keep when it is not a finite number", () => {
    assert.throws(
      () => parseSchedule({ keep: {} }, DEFAULTS),
      (error: unknown) => {
        const message = messageOf(error);
        assert.equal(/field "keep"/.test(message), true);
        assert.equal(/must be a finite number/.test(message), true);
        return true;
      },
    );
    assert.throws(
      () => parseSchedule({ keep: Number.NaN }, DEFAULTS),
      /field "keep"/,
    );
    assert.throws(
      () => parseSchedule({ keep: Number.NEGATIVE_INFINITY }, DEFAULTS),
      /field "keep"/,
    );
  });

  it("throws instead of silently falling back to the default on bad input", () => {
    assert.throws(() => parseSchedule({ keep: "many" }, DEFAULTS), /field "keep"/);
  });
});

describe("describeBackupPolicy", () => {
  const lines = describeBackupPolicy({ everyHours: 6, keep: 3 });
  const text = lines.join("\n");

  it("returns a few short lines", () => {
    assert.equal(lines.length <= 4, true);
    for (const line of lines) {
      assert.notEqual(line.trim(), "");
      assert.equal(line.includes("\n"), false);
    }
  });

  it("mentions the schedule values", () => {
    assert.equal(text.includes("6"), true);
    assert.equal(text.includes("3"), true);
    assert.equal(/every 6 h/.test(text), true);
    assert.equal(/keep 3/.test(text), true);
  });

  it("mentions every never-included entry", () => {
    for (const entry of neverIncluded) {
      assert.equal(text.includes(entry.path), true, `missing ${entry.path}`);
    }
  });

  it("mentions the included entries too", () => {
    for (const entry of included) {
      assert.equal(text.includes(entry.path), true, `missing ${entry.path}`);
    }
  });

  it("reflects a clamped schedule", () => {
    const clamped = parseSchedule({ everyHours: 500, keep: 0 }, DEFAULTS);
    const clampedText = describeBackupPolicy(clamped).join("\n");

    assert.equal(/every 168 h/.test(clampedText), true);
    assert.equal(/keep 1/.test(clampedText), true);
  });
});
