import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMsixManifest, escapeXmlAttribute, renderMsixManifest } from "./msix.js";
import type { MsixInfo } from "./msix.js";

/**
 * These tests live next to the source (and not in tests/) because tsconfig
 * only includes "src" and the test run executes compiled dist/**\/*.test.js.
 */

const GOOD_INFO = {
  identityName: "Roan.Heemstra.App",
  publisher: "CN=Roan Heemstra, O=Roan, C=NL",
  version: "1.4.2.0",
  architecture: "x64",
  capabilities: ["runFullTrust", "internetClient"],
} as const;

/** Assert the thrown error is an Error naming `field` and quoting `value`. */
function assertFieldError(fn: () => unknown, field: string, value: string): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof Error, `expected an Error, got ${String(error)}`);
    assert.ok(
      error.message.includes(field),
      `expected the message to name "${field}", got: ${error.message}`,
    );
    assert.ok(
      error.message.includes(value),
      `expected the message to quote "${value}", got: ${error.message}`,
    );
    return true;
  });
}

describe("buildMsixManifest", () => {
  it("bouwt een volledig manifest uit goede invoer", () => {
    const manifest = buildMsixManifest(GOOD_INFO);

    assert.deepEqual(manifest, {
      identity: {
        name: "Roan.Heemstra.App",
        publisher: "CN=Roan Heemstra, O=Roan, C=NL",
        version: "1.4.2.0",
        architecture: "x64",
      },
      capabilities: ["runFullTrust", "internetClient"],
    });
  });

  it("accepteert een lege capability-lijst", () => {
    const manifest = buildMsixManifest({ ...GOOD_INFO, capabilities: [] });

    assert.deepEqual(manifest.capabilities, []);
  });

  it("wijst een pakketnaam met een ongeldig teken af, met de veldnaam erbij", () => {
    assertFieldError(
      () => buildMsixManifest({ ...GOOD_INFO, identityName: "Roan.Heemstra App" }),
      "identityName",
      "Roan.Heemstra App",
    );
    assertFieldError(
      () => buildMsixManifest({ ...GOOD_INFO, identityName: "Roan_Heemstra.App" }),
      "identityName",
      "Roan_Heemstra.App",
    );
  });

  it("wijst een pakketnaam af die niet alfanumeriek begint of eindigt", () => {
    assertFieldError(
      () => buildMsixManifest({ ...GOOD_INFO, identityName: "-Roan.App" }),
      "identityName",
      "-Roan.App",
    );
    assertFieldError(
      () => buildMsixManifest({ ...GOOD_INFO, identityName: "Roan.App." }),
      "identityName",
      "Roan.App.",
    );
  });

  it("wijst een pakketnaam af die te kort of te lang is", () => {
    assertFieldError(
      () => buildMsixManifest({ ...GOOD_INFO, identityName: "Ro" }),
      "identityName",
      "Ro",
    );
    assertFieldError(
      () => buildMsixManifest({ ...GOOD_INFO, identityName: "R".repeat(51) }),
      "identityName",
      "R".repeat(51),
    );
    // 3 en 50 tekens zijn de randen en moeten wel mogen.
    assert.equal(buildMsixManifest({ ...GOOD_INFO, identityName: "R.R" }).identity.name, "R.R");
    assert.equal(
      buildMsixManifest({ ...GOOD_INFO, identityName: "R".repeat(50) }).identity.name,
      "R".repeat(50),
    );
  });

  it("wijst een versie met drie delen af", () => {
    assertFieldError(
      () => buildMsixManifest({ ...GOOD_INFO, version: "1.2.3" }),
      "version",
      "1.2.3",
    );
  });

  it("wijst een versie met een niet-numeriek deel of te grote delen af", () => {
    assertFieldError(
      () => buildMsixManifest({ ...GOOD_INFO, version: "1.2.3.x" }),
      "version",
      "1.2.3.x",
    );
    assertFieldError(
      () => buildMsixManifest({ ...GOOD_INFO, version: "1.2.3.4.5" }),
      "version",
      "1.2.3.4.5",
    );
    assertFieldError(
      () => buildMsixManifest({ ...GOOD_INFO, version: "1.2.3.65536" }),
      "version",
      "1.2.3.65536",
    );
    assert.equal(
      buildMsixManifest({ ...GOOD_INFO, version: "0.0.0.65535" }).identity.version,
      "0.0.0.65535",
    );
  });

  it("wijst een onbekende architectuur af", () => {
    const bad = {
      ...GOOD_INFO,
      architecture: "arm",
    } as unknown as MsixInfo;

    assertFieldError(() => buildMsixManifest(bad), "architecture", "arm");
    assert.throws(() => buildMsixManifest(bad), /x64, x86, arm64/);
  });

  it("wijst een publisher af die geen distinguished name is", () => {
    assertFieldError(
      () => buildMsixManifest({ ...GOOD_INFO, publisher: "Roan Heemstra" }),
      "publisher",
      "Roan Heemstra",
    );
  });

  it("wijst een capability met spaties of vreemde tekens af", () => {
    assertFieldError(
      () => buildMsixManifest({ ...GOOD_INFO, capabilities: ["runFullTrust", "bad name"] }),
      "capability",
      "bad name",
    );
  });
});

describe("renderMsixManifest", () => {
  it("rendert de identity en de capabilities als XML-fragment", () => {
    const xml = renderMsixManifest(buildMsixManifest(GOOD_INFO));

    assert.ok(xml.includes('<Identity\n    Name="Roan.Heemstra.App"'), xml);
    assert.ok(
      xml.includes('Publisher="CN=Roan Heemstra, O=Roan, C=NL"'),
      xml,
    );
    assert.ok(xml.includes('Version="1.4.2.0"'), xml);
    assert.ok(xml.includes('ProcessorArchitecture="x64" />'), xml);
    assert.ok(xml.includes('<Capability Name="runFullTrust" />'), xml);
    assert.ok(xml.includes('<Capability Name="internetClient" />'), xml);
    assert.ok(xml.startsWith('<Package xmlns="http://schemas.microsoft.com'), xml);
    assert.ok(xml.endsWith("</Package>\n"), xml);
  });

  it("rendert een leeg Capabilities-element zonder capabilities", () => {
    const xml = renderMsixManifest(buildMsixManifest({ ...GOOD_INFO, capabilities: [] }));

    assert.ok(xml.includes("  <Capabilities />"), xml);
    assert.ok(!xml.includes("<Capability "), xml);
  });

  it("escapet een quote en een ampersand in de publisher", () => {
    const xml = renderMsixManifest(
      buildMsixManifest({
        ...GOOD_INFO,
        publisher: 'CN=Roan & "Zonen", O=Roan',
      }),
    );

    assert.ok(
      xml.includes('Publisher="CN=Roan &amp; &quot;Zonen&quot;, O=Roan"'),
      xml,
    );
    // De ruwe waarde mag nergens meer in de attribuutwaarde staan.
    assert.ok(!xml.includes('"Zonen"'), xml);
    assert.ok(!xml.includes("Roan & "), xml);
  });

  it("escapet alle vijf de XML-attribuuttekens in een losse waarde", () => {
    assert.equal(escapeXmlAttribute(`<a href="x">&'</a>`), "&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;");
    assert.equal(escapeXmlAttribute("gewoon tekst"), "gewoon tekst");
  });

  it("waarschuwt ook bij een handmatig gebouwd manifest met een slechte versie", () => {
    const handBuilt = {
      identity: {
        name: "Roan.Heemstra.App",
        publisher: "CN=Roan",
        version: "1.2.3",
        architecture: "x64",
      },
      capabilities: [],
    } as const;

    assertFieldError(
      () => renderMsixManifest(handBuilt),
      "version",
      "1.2.3",
    );
  });
});
