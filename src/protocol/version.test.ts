import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LATEST,
  MAX_PART,
  describeVersion,
  formatVersion,
  isCompatible,
  parseVersion,
} from "./version.js";

/** Asserts `text` is rejected and that the message names it. */
function assertRejects(text: string): void {
  assert.throws(
    () => parseVersion(text),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes("Invalid protocol version"), error.message);
      assert.ok(error.message.includes(text), error.message);
      return true;
    },
  );
}

describe("parseVersion", () => {
  it("reads two numbers around a dot", () => {
    assert.deepEqual(parseVersion("1.0"), { major: 1, minor: 0 });
    assert.deepEqual(parseVersion("0.0"), { major: 0, minor: 0 });
    assert.deepEqual(parseVersion("12.34"), { major: 12, minor: 34 });
  });

  it("accepts the boundary value 999", () => {
    assert.deepEqual(parseVersion("999.999"), { major: 999, minor: 999 });
    assert.equal(MAX_PART, 999);
  });

  it("refuses text that has no two parts", () => {
    for (const bad of ["", "1", ".1", "1.", "1.2.3", "1..2", "1.2.", "..", "."]) {
      assertRejects(bad);
    }
  });

  it("refuses a character before the first part", () => {
    for (const bad of ["+1.2", "-1.2", "v1.2", "=1.2", " 1.2", "1.2 ", "1 .2", "1. 2"]) {
      assertRejects(bad);
    }
  });

  it("refuses text that is not digits", () => {
    for (const bad of ["a.b", "1.x", "x.2", "1.2beta", "1,2", "1.2\r\n"]) {
      assertRejects(bad);
    }
  });

  it("refuses a value above 999", () => {
    for (const bad of ["1000.0", "0.1000", "1000.1000", "12345.6"]) {
      assertRejects(bad);
    }
  });

  it("refuses leading zeros", () => {
    for (const bad of ["01.2", "1.02", "00.0"]) {
      assertRejects(bad);
    }
  });

  it("names the faulty text in the message", () => {
    assert.throws(
      () => parseVersion("1.2.3"),
      /Invalid protocol version "1\.2\.3"/,
    );
  });
});

describe("formatVersion", () => {
  it("turns a version back into text", () => {
    assert.equal(formatVersion({ major: 1, minor: 0 }), "1.0");
    assert.equal(formatVersion({ major: 0, minor: 7 }), "0.7");
    assert.equal(formatVersion({ major: 999, minor: 999 }), "999.999");
  });

  it("round-trips text", () => {
    for (const text of ["0.0", "1.0", "1.4", "12.34", "999.999"]) {
      assert.equal(formatVersion(parseVersion(text)), text);
    }
  });

  it("refuses an invalid part", () => {
    for (const bad of [
      { major: -1, minor: 0 },
      { major: 0, minor: -1 },
      { major: 1.5, minor: 0 },
      { major: 0, minor: 1.5 },
      { major: 1000, minor: 0 },
      { major: 0, minor: 1000 },
      { major: Number.NaN, minor: 0 },
    ]) {
      assert.throws(
        () => formatVersion(bad),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.ok(error.message.includes(String(bad.major)), error.message);
          assert.ok(error.message.includes(String(bad.minor)), error.message);
          return true;
        },
      );
    }
  });
});

describe("isCompatible", () => {
  const local = { major: 1, minor: 4 };

  it("accepts an equal version", () => {
    assert.equal(isCompatible({ major: 1, minor: 4 }, local), true);
  });

  it("accepts an older minor", () => {
    assert.equal(isCompatible({ major: 1, minor: 0 }, local), true);
    assert.equal(isCompatible({ major: 1, minor: 3 }, local), true);
  });

  it("refuses a newer minor", () => {
    assert.equal(isCompatible({ major: 1, minor: 5 }, local), false);
    assert.equal(isCompatible({ major: 1, minor: 999 }, local), false);
  });

  it("refuses a different major", () => {
    assert.equal(isCompatible({ major: 0, minor: 0 }, local), false);
    assert.equal(isCompatible({ major: 2, minor: 0 }, local), false);
    assert.equal(isCompatible({ major: 2, minor: 0 }, { major: 1, minor: 0 }), false);
  });

  it("is not symmetric between old and new", () => {
    const older = { major: 1, minor: 1 };
    assert.equal(isCompatible(older, local), true);
    assert.equal(isCompatible(local, older), false);
  });
});

describe("describeVersion", () => {
  it("returns one line with the version", () => {
    assert.equal(describeVersion({ major: 1, minor: 0 }), "protocol v1.0");
    assert.equal(describeVersion({ major: 1, minor: 4 }), "protocol v1.4");
  });

  it("falls back to LATEST", () => {
    assert.equal(describeVersion(), `protocol v${formatVersion(LATEST)}`);
    assert.ok(!describeVersion().includes("\n"));
  });
});

describe("LATEST", () => {
  it("is itself a valid version", () => {
    assert.equal(formatVersion(parseVersion(formatVersion(LATEST))), formatVersion(LATEST));
    assert.equal(isCompatible(LATEST, LATEST), true);
  });
});
