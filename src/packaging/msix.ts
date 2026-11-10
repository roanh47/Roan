/**
 * Build and render an Appx/MSIX manifest fragment.
 *
 * The manifest is a typed object plus a renderer, never a file: `buildMsixManifest`
 * validates the caller's description, `renderMsixManifest` turns the result into
 * the XML fragment text. Nothing here touches the filesystem, so the caller
 * decides where the fragment goes (a real `AppxManifest.xml`, a test fixture, a
 * build log).
 *
 * Validation is strict and fails loudly: the packaging toolchain rejects a bad
 * identity name, a non-numeric version or an unknown architecture at pack time,
 * which is far more expensive than an `Error` here. Every failure names the
 * offending field and echoes the bad value.
 *
 * See https://learn.microsoft.com/en-us/uwp/schemas/appxpackage/uapmanifestschema/root-package.
 */

/** The processor architectures MSIX packages are built for. */
export type MsixArchitecture = "x64" | "x86" | "arm64";

/** Everything the manifest builder needs, as the rest of the tool sees it. */
export interface MsixInfo {
  /** Package identity name, e.g. `Roan.Heemstra.App`. */
  readonly identityName: string;
  /** Publisher distinguished name, e.g. `CN=Roan Heemstra, O=Roan, C=NL`. */
  readonly publisher: string;
  /** Four numeric parts, e.g. `1.4.2.0`. */
  readonly version: string;
  /** Target architecture; one of {@link MsixArchitecture}. */
  readonly architecture: MsixArchitecture;
  /** Capability names such as `runFullTrust` or `internetClient`. May be empty. */
  readonly capabilities: readonly string[];
}

/** The `<Identity>` element's attributes, already validated. */
export interface MsixIdentity {
  /** `Name=` attribute. */
  readonly name: string;
  /** `Publisher=` attribute; a distinguished name, not just a brand. */
  readonly publisher: string;
  /** `Version=` attribute, always four numeric parts. */
  readonly version: string;
  /** `ProcessorArchitecture=` attribute. */
  readonly architecture: MsixArchitecture;
}

/** The subset of an Appx/MSIX manifest this tool emits. */
export interface MsixManifest {
  readonly identity: MsixIdentity;
  /** `Name=` values of the `<Capability>` children, in order. */
  readonly capabilities: readonly string[];
}

/** Package identity names are between 3 and 50 characters. */
const MIN_IDENTITY_LENGTH = 3;
const MAX_IDENTITY_LENGTH = 50;

/** Letters, digits, dots and hyphens; the first and last must be alphanumeric. */
const IDENTITY_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;

/** A version part is one to five digits, so the range is 0-65535. */
const VERSION_PART_PATTERN = /^\d{1,5}$/;

/** MSIX refuses a version part above this. */
const MAX_VERSION_PART = 65535;

/** How many parts an MSIX version has. */
const VERSION_PART_COUNT = 4;

/** Capability names are one alphanumeric run, optionally dotted. */
const CAPABILITY_PATTERN = /^[A-Za-z][A-Za-z0-9.]*$/;

/** The architectures the schema accepts for desktop-bridge packages. */
const ARCHITECTURES: readonly MsixArchitecture[] = Object.freeze([
  "x64",
  "x86",
  "arm64",
]);

/** Attribute escapes, in the order they must be applied. */
const ATTRIBUTE_ESCAPES: Readonly<Record<string, string>> = Object.freeze({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
});

/** The namespaces the fragment declares, so it can stand alone as a document. */
const ROOT_OPEN =
  '<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10" ' +
  'xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10">';

/** Render an arbitrary value for an error message, bounded in length. */
function describe(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}

/** Read a value that must be a non-empty, trimmed string. */
function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string, got ${describe(value)}`);
  }
  if (value !== value.trim()) {
    throw new Error(
      `${field} must not start or end with whitespace, got ${describe(value)}`,
    );
  }
  return value;
}

/**
 * Escape one string for an XML attribute value.
 *
 * `&` is replaced first, because every other escape introduces an `&` that must
 * not be re-escaped. Whichever quote style the caller chooses, both are escaped
 * so the result is safe in either.
 */
export function escapeXmlAttribute(value: string): string {
  let out = "";
  for (const char of value) {
    const escaped = ATTRIBUTE_ESCAPES[char];
    out += escaped === undefined ? char : escaped;
  }
  return out;
}

/**
 * Validate a package identity name.
 *
 * Between 3 and 50 characters of letters, digits, dots and hyphens, starting
 * and ending alphanumeric; no doubled dot or hyphen is required to be rejected,
 * the schema is happy with them.
 */
function validateIdentityName(value: unknown): string {
  const name = requiredString(value, "identityName");
  if (name.length < MIN_IDENTITY_LENGTH || name.length > MAX_IDENTITY_LENGTH) {
    throw new Error(
      `identityName must be ${MIN_IDENTITY_LENGTH}-${MAX_IDENTITY_LENGTH} characters, got ${describe(name)}`,
    );
  }
  if (!IDENTITY_PATTERN.test(name)) {
    throw new Error(
      `identityName must be letters, digits, dots and hyphens, starting and ending alphanumeric, got ${describe(name)}`,
    );
  }
  return name;
}

/** Validate a version as exactly four numeric parts in the 0-65535 range. */
function validateVersion(value: unknown): string {
  const version = requiredString(value, "version");
  const parts = version.split(".");
  if (parts.length !== VERSION_PART_COUNT) {
    throw new Error(
      `version must have exactly ${VERSION_PART_COUNT} numeric parts, got ${describe(version)}`,
    );
  }
  for (const part of parts) {
    if (!VERSION_PART_PATTERN.test(part)) {
      throw new Error(
        `version must have exactly ${VERSION_PART_COUNT} numeric parts, got ${describe(version)}`,
      );
    }
    if (Number(part) > MAX_VERSION_PART) {
      throw new Error(
        `version part must be at most ${MAX_VERSION_PART}, got ${describe(version)}`,
      );
    }
  }
  return version;
}

/** Validate the architecture against the three this tool supports. */
function validateArchitecture(value: unknown): MsixArchitecture {
  if (typeof value !== "string" || !ARCHITECTURES.includes(value as MsixArchitecture)) {
    throw new Error(
      `architecture must be one of ${ARCHITECTURES.join(", ")}, got ${describe(value)}`,
    );
  }
  return value as MsixArchitecture;
}

/** Read the capability list: strings, non-empty, free of whitespace and XML syntax. */
function validateCapabilities(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`capabilities must be an array of names, got ${describe(value)}`);
  }
  const items: unknown[] = value;
  const capabilities: string[] = [];
  for (const item of items) {
    if (typeof item !== "string") {
      throw new Error(`each capability must be a string, got ${describe(item)}`);
    }
    if (!CAPABILITY_PATTERN.test(item)) {
      throw new Error(
        `each capability must be one name made of letters, digits and dots, got ${describe(item)}`,
      );
    }
    capabilities.push(item);
  }
  return capabilities;
}

/** Validate a publisher distinguished name; escaping happens at render time. */
function validatePublisher(value: unknown): string {
  const publisher = requiredString(value, "publisher");
  if (!publisher.includes("=")) {
    throw new Error(
      `publisher must be a distinguished name such as CN=Name, got ${describe(publisher)}`,
    );
  }
  return publisher;
}

/**
 * Build a manifest from `info`.
 *
 * Throws `Error` naming the field and echoing the bad value when the identity
 * name is the wrong length or holds a character the package-name set does not
 * allow, the version is not four numeric parts, the architecture is not one of
 * `x64`, `x86` or `arm64`, the publisher is not a distinguished name, or a
 * capability is not a plain name.
 */
export function buildMsixManifest(info: MsixInfo): MsixManifest {
  const identity: MsixIdentity = {
    name: validateIdentityName(info.identityName),
    publisher: validatePublisher(info.publisher),
    version: validateVersion(info.version),
    architecture: validateArchitecture(info.architecture),
  };
  return {
    identity,
    capabilities: validateCapabilities(info.capabilities),
  };
}

/**
 * Render a manifest as an XML fragment, ending in a single newline.
 *
 * The same checks run again, so a hand-built or JSON-parsed object cannot slip
 * an unescaped attribute past the renderer. Every attribute value is escaped
 * with {@link escapeXmlAttribute}, which is what keeps a `"` or `&` in the
 * publisher from ending the attribute early.
 */
export function renderMsixManifest(manifest: MsixManifest): string {
  const identity = manifest.identity;
  const name = validateIdentityName(identity.name);
  const publisher = validatePublisher(identity.publisher);
  const version = validateVersion(identity.version);
  const architecture = validateArchitecture(identity.architecture);
  const capabilities = validateCapabilities(manifest.capabilities);

  const lines: string[] = [
    ROOT_OPEN,
    "  <Identity",
    `    Name="${escapeXmlAttribute(name)}"`,
    `    Publisher="${escapeXmlAttribute(publisher)}"`,
    `    Version="${escapeXmlAttribute(version)}"`,
    `    ProcessorArchitecture="${escapeXmlAttribute(architecture)}" />`,
  ];

  if (capabilities.length === 0) {
    lines.push("  <Capabilities />");
  } else {
    lines.push("  <Capabilities>");
    for (const capability of capabilities) {
      lines.push(`    <Capability Name="${escapeXmlAttribute(capability)}" />`);
    }
    lines.push("  </Capabilities>");
  }

  lines.push("</Package>");
  return lines.join("\n") + "\n";
}
