import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildReleaseManifest, toMarkdown } from "./release-manifest.js";
import type { ReleaseManifestEntry } from "./release-manifest.js";

/**
 * These tests live next to the source (and not in tests/) because tsconfig
 * only includes "src" and the test run executes compiled dist/**\/*.test.js.
 */

const GOOD_SHA256 = "9f2c4b1d8e7a6f5c4b3a2d1e0f9c8b7a6d5e4f3c2b1a0f9e8d7c6b5a4f3e2d10";

/** Een geldige regel; tests overschrijven één veld om precies dat veld te testen. */
function entry(overrides: Partial<ReleaseManifestEntry> = {}): ReleaseManifestEntry {
  return {
    version: "1.4.2",
    platform: "linux",
    arch: "x64",
    file: "app-1.4.2-linux-x64.tar.gz",
    bytes: 12_345_678,
    sha256: GOOD_SHA256,
    url: "https://downloads.example.com/app/1.4.2/app-1.4.2-linux-x64.tar.gz",
    ...overrides,
  };
}

/** Controleer dat de fout een Error is die de regel en het veld noemt. */
function assertEntryError(fn: () => unknown, entryLabel: string, field: string): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof Error, `verwachtte een Error, kreeg ${String(error)}`);
    assert.ok(
      error.message.includes(entryLabel),
      `verwachtte dat de melding "${entryLabel}" noemt, kreeg: ${error.message}`,
    );
    assert.ok(
      error.message.includes(field),
      `verwachtte dat de melding het veld "${field}" noemt, kreeg: ${error.message}`,
    );
    return true;
  });
}

describe("buildReleaseManifest", () => {
  it("sorteert een geldige manifest op platform en dan arch", () => {
    const manifest = buildReleaseManifest([
      entry({ platform: "win32", arch: "x64", file: "app-win32-x64.exe" }),
      entry({ platform: "linux", arch: "arm64", file: "app-linux-arm64.tar.gz" }),
      entry({ platform: "linux", arch: "x64", file: "app-linux-x64.tar.gz" }),
      entry({ platform: "darwin", arch: "arm64", file: "app-darwin-arm64.dmg" }),
      entry({ platform: "linux", arch: "ia32", file: "app-linux-ia32.tar.gz" }),
    ]);

    assert.deepEqual(
      manifest.map((e) => `${e.platform}/${e.arch}`),
      ["darwin/arm64", "linux/arm64", "linux/ia32", "linux/x64", "win32/x64"],
    );
    assert.equal(manifest.length, 5);
  });

  it("houdt alle velden intact en wijzigt de invoer niet", () => {
    const input = [
      entry({ platform: "win32", arch: "arm64", file: "app-arm64.exe" }),
      entry({ platform: "linux", arch: "x64" }),
    ];
    const before = input.map((e) => e.file);

    const manifest = buildReleaseManifest(input);

    assert.deepEqual(manifest, [input[1], input[0]]);
    assert.deepEqual(
      input.map((e) => e.file),
      before,
      "de aangeroepen lijst mag niet opnieuw gesorteerd worden",
    );
    assert.deepEqual(manifest[1], input[0]);
  });

  it("accepteert een lege manifest", () => {
    assert.deepEqual(buildReleaseManifest([]), []);
  });

  it("weigert een url die geen https is", () => {
    assertEntryError(
      () => buildReleaseManifest([entry({ url: "http://downloads.example.com/app.tar.gz" })]),
      "entry 1 (linux/x64)",
      "url",
    );
    assertEntryError(
      () => buildReleaseManifest([entry({ url: "ftp://downloads.example.com/app.tar.gz" })]),
      "entry 1 (linux/x64)",
      "url",
    );
    assertEntryError(
      () => buildReleaseManifest([entry({ url: "/app-1.4.2.tar.gz" })]),
      "entry 1 (linux/x64)",
      "url",
    );
  });

  it("weigert een sha256 met hoofdletters", () => {
    assertEntryError(
      () => buildReleaseManifest([entry({ sha256: GOOD_SHA256.toUpperCase() })]),
      "entry 1 (linux/x64)",
      "sha256",
    );
  });

  it("weigert een sha256 die niet 64 tekens lang is", () => {
    assertEntryError(
      () => buildReleaseManifest([entry({ sha256: GOOD_SHA256.slice(1) })]),
      "entry 1 (linux/x64)",
      "sha256",
    );
  });

  it("weigert nul bytes en negatieve of gebroken aantallen", () => {
    for (const bytes of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assertEntryError(
        () => buildReleaseManifest([entry({ bytes })]),
        "entry 1 (linux/x64)",
        "bytes",
      );
    }
  });

  it("weigert een dubbel platform+arch-paar en noemt beide regels", () => {
    assert.throws(
      () =>
        buildReleaseManifest([
          entry({ platform: "linux", arch: "x64" }),
          entry({ platform: "win32", arch: "x64", file: "app-win32-x64.exe" }),
          entry({ platform: "linux", arch: "x64", file: "app-linux-x64.zip" }),
        ]),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes("entry 3 (linux/x64)"), error.message);
        assert.ok(error.message.includes("duplicate"), error.message);
        assert.ok(error.message.includes("entry 1"), error.message);
        return true;
      },
    );
  });

  it("weigert een versie die de strikte parser afkeurt", () => {
    for (const version of ["v1.4.2", "1.4", "1.4.2.1", "01.4.2", "", "1.4.2+build"]) {
      assertEntryError(
        () => buildReleaseManifest([entry({ version })]),
        "entry 1 (linux/x64)",
        "version",
      );
    }
  });

  it("weigert een bestandsnaam met een pad of stuurteken", () => {
    for (const file of ["dist/app.tar.gz", "..\\app.exe", "app\n.tar.gz", ""]) {
      assertEntryError(
        () => buildReleaseManifest([entry({ file })]),
        "entry 1 (linux/x64)",
        "file",
      );
    }
  });

  it("weigert een onbekend veld in plaats van het te negeren", () => {
    const withExtra = { ...entry(), channel: "beta" } as unknown as ReleaseManifestEntry;

    assertEntryError(() => buildReleaseManifest([withExtra]), "entry 1", "channel");
  });

  it("weigert een invoer die geen lijst is", () => {
    assert.throws(
      () => buildReleaseManifest({ entries: [] }),
      /release manifest must be an array of entries/,
    );
    assert.throws(() => buildReleaseManifest("linux"), /release manifest must be an array/);
  });
});

describe("toMarkdown", () => {
  it("maakt een korte lijst in manifestvolgorde", () => {
    const markdown = toMarkdown([
      entry({ platform: "win32", arch: "x64", file: "app-win32-x64.exe", bytes: 24_000_000 }),
      entry({ platform: "linux", arch: "x64", bytes: 900 }),
    ]);

    assert.equal(
      markdown,
      "- **linux (x64)** — [`app-1.4.2-linux-x64.tar.gz`](<https://downloads.example.com/app/1.4.2/app-1.4.2-linux-x64.tar.gz>) · 900 B\n" +
        "- **win32 (x64)** — [`app-win32-x64.exe`](<https://downloads.example.com/app/1.4.2/app-1.4.2-linux-x64.tar.gz>) · 24.0 MB\n",
    );
  });

  it("geeft een lege string voor een lege manifest", () => {
    assert.equal(toMarkdown([]), "");
  });

  it("past dezelfde controles toe als de manifest", () => {
    assertEntryError(
      () => toMarkdown([entry({ sha256: "K".repeat(64) })]),
      "entry 1 (linux/x64)",
      "sha256",
    );
  });
});
