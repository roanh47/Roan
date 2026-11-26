import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareVersions, isNewerVersion, parseVersion } from "./semver.js";

/**
 * The updater's whole decision rests on this ordering. The cases below are the
 * semantic-versioning precedence rules as written, plus the ones this project
 * actually publishes (a `-test` bundle against a release, `0.0.24` against
 * `0.0.23`), so a regression cannot quietly turn "older" into "update".
 */

describe("compareVersions", () => {
  it("orders numeric parts left to right", () => {
    assert.equal(compareVersions("0.0.24", "0.0.23"), 1);
    assert.equal(compareVersions("0.0.23", "0.0.24"), -1);
    assert.equal(compareVersions("1.10.0", "1.9.0"), 1);
    assert.equal(compareVersions("2.0.0", "1.99.99"), 1);
    assert.equal(compareVersions("0.1.0", "1.0.0"), -1);
  });

  it("treats identical versions as equal", () => {
    assert.equal(compareVersions("0.0.23", "0.0.23"), 0);
    assert.equal(compareVersions("1.2.3-beta.1", "1.2.3-beta.1"), 0);
  });

  it("places a release after every prerelease of the same version", () => {
    assert.equal(compareVersions("1.0.0", "1.0.0-rc.1"), 1);
    assert.equal(compareVersions("1.0.0-rc.1", "1.0.0"), -1);
    assert.equal(compareVersions("1.0.0-alpha", "1.0.0"), -1);
  });

  it("follows the spec's prerelease chain", () => {
    const chain = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
    ];

    for (let index = 0; index < chain.length - 1; index += 1) {
      const left = chain[index];
      const right = chain[index + 1];
      assert.ok(left !== undefined && right !== undefined);
      assert.equal(compareVersions(left, right), -1, `${left} should precede ${right}`);
      assert.equal(compareVersions(right, left), 1, `${right} should follow ${left}`);
    }
  });

  it("compares numeric prerelease identifiers by value, not text", () => {
    assert.equal(compareVersions("1.0.0-beta.2", "1.0.0-beta.11"), -1);
    assert.equal(compareVersions("1.0.0-beta.11", "1.0.0-beta.2"), 1);
    // Arbitrarily long numeric identifiers must not fall back to text order.
    assert.equal(compareVersions("1.0.0-99999999999999999999", "1.0.0-100000000000000000000"), -1);
  });

  it("puts numeric identifiers below alphanumeric ones", () => {
    assert.equal(compareVersions("1.0.0-1", "1.0.0-alpha"), -1);
    assert.equal(compareVersions("1.0.0-alpha", "1.0.0-1"), 1);
    assert.equal(compareVersions("1.0.0-1", "1.0.0-2"), -1);
  });

  it("puts a shorter prerelease list before its own extension", () => {
    assert.equal(compareVersions("1.0.0-alpha", "1.0.0-alpha.1"), -1);
    assert.equal(compareVersions("1.0.0-alpha.1", "1.0.0-alpha"), 1);
  });

  it("rejects a version the strict parser refuses", () => {
    for (const bad of ["v1.0.0", "1.0", "1.0.0.0", ""]) {
      assert.throws(
        () => compareVersions(bad, "1.0.0"),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.ok(error.message.includes(bad), `expected ${bad} in: ${error.message}`);
          return true;
        },
      );
    }
  });
});

describe("isNewerVersion", () => {
  it("is true only for a strictly newer candidate", () => {
    assert.equal(isNewerVersion("0.0.24", "0.0.23"), true);
    assert.equal(isNewerVersion("0.0.24-test", "0.0.23"), true);
    assert.equal(isNewerVersion("0.0.23", "0.0.23"), false);
    assert.equal(isNewerVersion("0.0.22", "0.0.23"), false);
    assert.equal(isNewerVersion("0.0.23-rc.1", "0.0.23"), false);
    assert.equal(isNewerVersion("0.0.23", "0.0.23-rc.1"), true);
  });

  it("round-trips through the strict parser", () => {
    assert.deepEqual(parseVersion("0.0.24-test"), { major: 0, minor: 0, patch: 24, prerelease: "test" });
  });
});
