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
  it("builds a complete manifest from good input", () => {
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

  it("accepts an empty capability list", () => {
    const manifest = buildMsixManifest({ ...GOOD_INFO, capabilities: [] });

    assert.deepEqual(manifest.capabilities, []);
  });

  it("rejects a package name with an invalid character, naming the field", () => {
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

  it("rejects a package name that does not start or end alphanumerically", () => {
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

  it("rejects a package name that is too short or too long", () => {
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
    // 3 and 50 characters are the boundaries and must be allowed.
    assert.equal(buildMsixManifest({ ...GOOD_INFO, identityName: "R.R" }).identity.name, "R.R");
    assert.equal(
      buildMsixManifest({ ...GOOD_INFO, identityName: "R".repeat(50) }).identity.name,
      "R".repeat(50),
    );
  });

  it("rejects a version with three parts", () => {
    assertFieldError(
      () => buildMsixManifest({ ...GOOD_INFO, version: "1.2.3" }),
      "version",
      "1.2.3",
    );
  });

  it("rejects a version with a non-numeric part or parts that are too large", () => {
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

  it("rejects an unknown architecture", () => {
    const bad = {
      ...GOOD_INFO,
      architecture: "arm",
    } as unknown as MsixInfo;

    assertFieldError(() => buildMsixManifest(bad), "architecture", "arm");
    assert.throws(() => buildMsixManifest(bad), /x64, x86, arm64/);
  });

  it("rejects a publisher that is not a distinguished name", () => {
    assertFieldError(
      () => buildMsixManifest({ ...GOOD_INFO, publisher: "Roan Heemstra" }),
      "publisher",
      "Roan Heemstra",
    );
  });

  it("rejects a capability with spaces or strange characters", () => {
    assertFieldError(
      () => buildMsixManifest({ ...GOOD_INFO, capabilities: ["runFullTrust", "bad name"] }),
      "capability",
      "bad name",
    );
  });
});

describe("renderMsixManifest", () => {
  it("renders the identity and the capabilities as an XML fragment", () => {
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

  it("renders an empty Capabilities element without capabilities", () => {
    const xml = renderMsixManifest(buildMsixManifest({ ...GOOD_INFO, capabilities: [] }));

    assert.ok(xml.includes("  <Capabilities />"), xml);
    assert.ok(!xml.includes("<Capability "), xml);
  });

  it("escapes a quote and an ampersand in the publisher", () => {
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
    // The raw value must no longer appear anywhere in the attribute value.
    assert.ok(!xml.includes('"Zonen"'), xml);
    assert.ok(!xml.includes("Roan & "), xml);
  });

  it("escapes all five XML attribute characters in a loose value", () => {
    assert.equal(escapeXmlAttribute(`<a href="x">&'</a>`), "&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;");
    assert.equal(escapeXmlAttribute("gewoon tekst"), "gewoon tekst");
  });

  it("also warns on a hand-built manifest with a bad version", () => {
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
