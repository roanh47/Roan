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
  it("leest twee getallen rond een punt", () => {
    assert.deepEqual(parseVersion("1.0"), { major: 1, minor: 0 });
    assert.deepEqual(parseVersion("0.0"), { major: 0, minor: 0 });
    assert.deepEqual(parseVersion("12.34"), { major: 12, minor: 34 });
  });

  it("accepteert de grenswaarde 999", () => {
    assert.deepEqual(parseVersion("999.999"), { major: 999, minor: 999 });
    assert.equal(MAX_PART, 999);
  });

  it("weigert tekst die geen twee delen heeft", () => {
    for (const bad of ["", "1", ".1", "1.", "1.2.3", "1..2", "1.2.", "..", "."]) {
      assertRejects(bad);
    }
  });

  it("weigert een teken voor het eerste deel", () => {
    for (const bad of ["+1.2", "-1.2", "v1.2", "=1.2", " 1.2", "1.2 ", "1 .2", "1. 2"]) {
      assertRejects(bad);
    }
  });

  it("weigert tekst die geen cijfers zijn", () => {
    for (const bad of ["a.b", "1.x", "x.2", "1.2beta", "1,2", "1.2\r\n"]) {
      assertRejects(bad);
    }
  });

  it("weigert een waarde boven 999", () => {
    for (const bad of ["1000.0", "0.1000", "1000.1000", "12345.6"]) {
      assertRejects(bad);
    }
  });

  it("weigert voorloopnullen", () => {
    for (const bad of ["01.2", "1.02", "00.0"]) {
      assertRejects(bad);
    }
  });

  it("noemt de foutieve tekst in de melding", () => {
    assert.throws(
      () => parseVersion("1.2.3"),
      /Invalid protocol version "1\.2\.3"/,
    );
  });
});

describe("formatVersion", () => {
  it("zet een versie terug naar tekst", () => {
    assert.equal(formatVersion({ major: 1, minor: 0 }), "1.0");
    assert.equal(formatVersion({ major: 0, minor: 7 }), "0.7");
    assert.equal(formatVersion({ major: 999, minor: 999 }), "999.999");
  });

  it("rondt tekst heen en weer af", () => {
    for (const text of ["0.0", "1.0", "1.4", "12.34", "999.999"]) {
      assert.equal(formatVersion(parseVersion(text)), text);
    }
  });

  it("weigert een ongeldig deel", () => {
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

  it("accepteert een gelijke versie", () => {
    assert.equal(isCompatible({ major: 1, minor: 4 }, local), true);
  });

  it("accepteert een oudere minor", () => {
    assert.equal(isCompatible({ major: 1, minor: 0 }, local), true);
    assert.equal(isCompatible({ major: 1, minor: 3 }, local), true);
  });

  it("weigert een nieuwere minor", () => {
    assert.equal(isCompatible({ major: 1, minor: 5 }, local), false);
    assert.equal(isCompatible({ major: 1, minor: 999 }, local), false);
  });

  it("weigert een ander major", () => {
    assert.equal(isCompatible({ major: 0, minor: 0 }, local), false);
    assert.equal(isCompatible({ major: 2, minor: 0 }, local), false);
    assert.equal(isCompatible({ major: 2, minor: 0 }, { major: 1, minor: 0 }), false);
  });

  it("is niet symmetrisch tussen oud en nieuw", () => {
    const older = { major: 1, minor: 1 };
    assert.equal(isCompatible(older, local), true);
    assert.equal(isCompatible(local, older), false);
  });
});

describe("describeVersion", () => {
  it("geeft een regel met de versie", () => {
    assert.equal(describeVersion({ major: 1, minor: 0 }), "protocol v1.0");
    assert.equal(describeVersion({ major: 1, minor: 4 }), "protocol v1.4");
  });

  it("valt terug op LATEST", () => {
    assert.equal(describeVersion(), `protocol v${formatVersion(LATEST)}`);
    assert.ok(!describeVersion().includes("\n"));
  });
});

describe("LATEST", () => {
  it("is zelf een geldige versie", () => {
    assert.equal(formatVersion(parseVersion(formatVersion(LATEST))), formatVersion(LATEST));
    assert.equal(isCompatible(LATEST, LATEST), true);
  });
});
