import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseChangelog } from "./changelog.js";

/**
 * These tests live next to the source (and not in tests/) because tsconfig
 * only includes "src" and the test run executes compiled dist/**\/*.test.js.
 */

const TWO_RELEASES = `# Changelog

## [1.2.0] - 2026-02-14

### Added
- changelog parser
- release notes export

### Fixed
- a broken link

## [1.1.0] - 2026-01-31

### Changed
- speedier startup
`;

describe("parseChangelog", () => {
  it("parses two releases in document order", () => {
    const releases = parseChangelog(TWO_RELEASES);

    assert.equal(releases.length, 2);
    assert.deepEqual(
      releases.map((release) => [release.version, release.date]),
      [
        ["1.2.0", "2026-02-14"],
        ["1.1.0", "2026-01-31"],
      ],
    );

    const newest = releases[0];
    assert.ok(newest !== undefined);
    assert.deepEqual(newest.sections, [
      { kind: "added", entries: ["changelog parser", "release notes export"] },
      { kind: "fixed", entries: ["a broken link"] },
    ]);

    const older = releases[1];
    assert.ok(older !== undefined);
    assert.deepEqual(older.sections, [{ kind: "changed", entries: ["speedier startup"] }]);
  });

  it("ignores text before the first release heading", () => {
    const releases = parseChangelog(`# Changelog

All notable changes to this project are documented here.
The format is based on Keep a Changelog.

- this loose bullet is preamble, not an entry

## [Unreleased] - 2026-03-01

### Security
- rotated signing keys
`);

    assert.equal(releases.length, 1);
    const release = releases[0];
    assert.ok(release !== undefined);
    assert.equal(release.version, "Unreleased");
    assert.equal(release.date, "2026-03-01");
    assert.deepEqual(release.sections, [{ kind: "security", entries: ["rotated signing keys"] }]);
  });

  it('maps an unknown section heading to kind "other"', () => {
    const releases = parseChangelog(`## [2.0.0] - 2026-04-02

### Added
- typed sections

### Internal
- bumped the toolchain
`);

    const release = releases[0];
    assert.ok(release !== undefined);
    assert.deepEqual(release.sections, [
      { kind: "added", entries: ["typed sections"] },
      { kind: "other", entries: ["bumped the toolchain"] },
    ]);
  });

  it("rejects a malformed release heading and quotes the line", () => {
    const heading = "## 1.2.3 - 2026-05-03";

    assert.throws(
      () =>
        parseChangelog(`# Changelog

${heading}

### Added
- something
`),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(
          error.message.includes(heading),
          `expected the message to quote "${heading}", got: ${error.message}`,
        );
        return true;
      },
    );
  });
});
