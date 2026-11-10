import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFeedEntry, parseFeedEntry } from "./updater.js";
import type { FeedEntry, FeedEntryInput } from "./updater.js";

/**
 * These tests live next to the source (and not in tests/) because tsconfig
 * only includes "src" and the test run executes compiled dist/**\/*.test.js.
 */

const GOOD_SHA256 = "9f2c4b1d8e7a6f5c4b3a2d1e0f9c8b7a6d5e4f3c2b1a0f9e8d7c6b5a4f3e2d10";

const GOOD_INPUT = {
  version: "1.4.2",
  url: "https://downloads.example.com/app/1.4.2/app-1.4.2.exe",
  sha256: GOOD_SHA256,
  notes: "  Fixed the updater.\n",
  mandatory: true,
} as const;

/** Assert the thrown error is an Error naming `field` and quoting `value`. */
function assertFieldError(fn: () => unknown, field: string, value: string): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof Error, `expected an Error, got ${String(error)}`);
    assert.ok(
      error.message.includes(field),
      `expected the message to name "${field}", got: ${error.message}`,
    );
    if (value !== "") {
      assert.ok(
        error.message.includes(value),
        `expected the message to quote the value, got: ${error.message}`,
      );
    }
    return true;
  });
}

describe("buildFeedEntry", () => {
  it("builds a complete entry and trims the notes", () => {
    const entry = buildFeedEntry(GOOD_INPUT);

    assert.deepEqual(entry, {
      version: "1.4.2",
      url: GOOD_INPUT.url,
      sha256: GOOD_SHA256,
      notes: "Fixed the updater.",
      mandatory: true,
    });
  });

  it("defaults notes to an empty string and mandatory to false", () => {
    const entry = buildFeedEntry({
      version: "2.0.0-beta.1",
      url: "https://downloads.example.com/app-2.0.0-beta.1.msi",
      sha256: GOOD_SHA256,
    });

    assert.equal(entry.notes, "");
    assert.equal(entry.mandatory, false);
    assert.equal(entry.version, "2.0.0-beta.1");
  });

  it("rejects a version the strict parser refuses, naming the field and value", () => {
    assertFieldError(
      () => buildFeedEntry({ ...GOOD_INPUT, version: "v1.4.2" }),
      "version",
      "v1.4.2",
    );
    assertFieldError(
      () => buildFeedEntry({ ...GOOD_INPUT, version: "1.4" }),
      "version",
      "1.4",
    );
    assertFieldError(
      () => buildFeedEntry({ ...GOOD_INPUT, version: "" }),
      "version",
      "",
    );
  });

  it("rejects a non-https url", () => {
    assertFieldError(
      () => buildFeedEntry({ ...GOOD_INPUT, url: "http://downloads.example.com/app.exe" }),
      "url",
      "http://downloads.example.com/app.exe",
    );
  });

  it("rejects a relative url", () => {
    assertFieldError(
      () => buildFeedEntry({ ...GOOD_INPUT, url: "/app-1.4.2.exe" }),
      "url",
      "/app-1.4.2.exe",
    );
  });

  it("rejects a sha256 that is not 64 lower-case hex characters", () => {
    assertFieldError(
      () => buildFeedEntry({ ...GOOD_INPUT, sha256: GOOD_SHA256.slice(1) }),
      "sha256",
      GOOD_SHA256.slice(1),
    );
    assertFieldError(
      () => buildFeedEntry({ ...GOOD_INPUT, sha256: GOOD_SHA256.toUpperCase() }),
      "sha256",
      GOOD_SHA256.toUpperCase(),
    );
    assertFieldError(
      () => buildFeedEntry({ ...GOOD_INPUT, sha256: "z".repeat(64) }),
      "sha256",
      "z".repeat(64),
    );
  });

  it("accepts 2000 note characters and rejects 2001", () => {
    const atCap = buildFeedEntry({ ...GOOD_INPUT, notes: "a".repeat(2000) });
    assert.equal(atCap.notes.length, 2000);

    assertFieldError(
      () => buildFeedEntry({ ...GOOD_INPUT, notes: "a".repeat(2001) }),
      "notes",
      "a".repeat(80),
    );
  });

  it("rejects a non-boolean mandatory", () => {
    // Reachable from untyped JS callers; the signature says boolean.
    const bad = {
      version: GOOD_INPUT.version,
      url: GOOD_INPUT.url,
      sha256: GOOD_INPUT.sha256,
      mandatory: "yes",
    } as unknown as FeedEntryInput;

    assertFieldError(() => buildFeedEntry(bad), "mandatory", "yes");
  });
});

describe("parseFeedEntry", () => {
  it("returns a built entry unchanged", () => {
    const built = buildFeedEntry(GOOD_INPUT);

    assert.deepEqual(parseFeedEntry(built), built);
  });

  it("round-trips through JSON without losing a field", () => {
    const built = buildFeedEntry(GOOD_INPUT);
    const received: unknown = JSON.parse(JSON.stringify(built));

    assert.deepEqual(parseFeedEntry(received), built);
  });

  it("accepts an entry that omits notes and mandatory", () => {
    const entry = parseFeedEntry({
      version: "1.0.0",
      url: "https://downloads.example.com/app-1.0.0.exe",
      sha256: GOOD_SHA256,
    });

    assert.equal(entry.notes, "");
    assert.equal(entry.mandatory, false);
  });

  it("rejects a value that is not an object", () => {
    assertFieldError(() => parseFeedEntry("1.4.2"), "feed entry", "");
    assertFieldError(() => parseFeedEntry(null), "feed entry", "");
    assertFieldError(() => parseFeedEntry([GOOD_INPUT]), "feed entry", "");
  });

  it("rejects an unknown field by name", () => {
    assertFieldError(() => parseFeedEntry({ ...GOOD_INPUT, channel: "beta" }), "channel", "channel");
  });

  it("rejects a missing required field by name", () => {
    const { sha256: _sha256, ...withoutSha256 } = GOOD_INPUT;
    assertFieldError(() => parseFeedEntry(withoutSha256), "sha256", "sha256");

    const { url: _url, ...withoutUrl } = GOOD_INPUT;
    assertFieldError(() => parseFeedEntry(withoutUrl), "url", "url");

    const { version: _version, ...withoutVersion } = GOOD_INPUT;
    assertFieldError(() => parseFeedEntry(withoutVersion), "version", "version");
  });

  it("applies the same value checks as the builder", () => {
    assertFieldError(
      () => parseFeedEntry({ ...GOOD_INPUT, url: "ftp://downloads.example.com/app.exe" }),
      "url",
      "ftp://downloads.example.com/app.exe",
    );
    assertFieldError(
      () => parseFeedEntry({ ...GOOD_INPUT, version: "1.4.2.1" }),
      "version",
      "1.4.2.1",
    );
  });
});
