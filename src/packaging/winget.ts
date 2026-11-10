/**
 * Build a winget manifest from a package description.
 *
 * The manifest is returned as a plain object rather than as YAML text, so the
 * caller can merge it into a multi-file manifest set or serialise it however
 * it likes. `toWingetYaml` is the one serialiser kept here: it emits
 * double-quoted scalars only, which is the one form that can represent every
 * string (single-quoted YAML cannot carry control characters).
 *
 * Validation is strict and fails loudly: winget rejects a bad
 * `PackageIdentifier` or `PackageVersion` at submission time, which is far
 * more expensive than an `Error` here. Every failure names the offending
 * field and echoes the bad value.
 */

/** Everything the manifest builder needs, as the rest of the tool sees it. */
export interface PackageInfo {
  /** Winget package identifier, e.g. `Roan.Heemstra.App`. */
  readonly id: string;
  /** Display name shown in `winget search`. */
  readonly name: string;
  /** Publisher name shown in the manifest, not necessarily the id's prefix. */
  readonly publisher: string;
  /** Version string, e.g. `1.4.2` or `2.0.0-beta.1`. */
  readonly version: string;
  /** Licence name, e.g. `MIT` or `Proprietary`. */
  readonly licence: string;
  /** Download URL of the installer; its extension picks the installer type. */
  readonly installerUrl: string;
  /** SHA-256 of the installer; hex, any case, stored upper-case. */
  readonly installerSha256: string;
}

/** The subset of a winget installer manifest this tool emits. */
export interface WingetManifest {
  readonly PackageIdentifier: string;
  readonly PackageVersion: string;
  readonly PackageName: string;
  readonly Publisher: string;
  readonly License: string;
  readonly InstallerType: "exe" | "msi";
  readonly InstallerUrl: string;
  /** Sixty-four upper-case hex digits. */
  readonly InstallerSha256: string;
}

/** Winget caps `PackageIdentifier` at 128 characters. */
const MAX_IDENTIFIER_LENGTH = 128;

/** Upper-case hex digest length of SHA-256. */
const SHA256_HEX_LENGTH = 64;

/**
 * A valid identifier is dot/hyphen separated alphanumeric runs: no leading,
 * trailing or doubled separator, and at least one dot to separate publisher
 * from package.
 */
const IDENTIFIER_PATTERN = /^[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*$/;

/** Numeric core (digits and dots, no empty segments) plus optional suffix. */
const VERSION_PATTERN = /^\d+(?:\.\d+)*(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;

const SHA256_PATTERN = /^[0-9A-Fa-f]{64}$/;

/** Control characters that YAML double-quoted scalars spell with a short escape. */
const SHORT_ESCAPES: Readonly<Record<string, string>> = Object.freeze({
  "\0": "\\0",
  "\t": "\\t",
  "\n": "\\n",
  "\r": "\\r",
});

/**
 * Escape one string for a YAML single-quoted scalar.
 *
 * The only character with meaning inside single quotes is the quote itself,
 * which is doubled. Callers get the content only; wrapping in `'` is theirs.
 */
export function escapeYamlSingle(value: string): string {
  return value.replaceAll("'", "''");
}

/**
 * Escape one string for a YAML double-quoted scalar.
 *
 * Backslash and the quote are escaped, and every control character becomes a
 * YAML escape sequence, because a double-quoted scalar may not contain a raw
 * one. Callers get the content only; wrapping in `"` is theirs.
 */
export function escapeYamlDouble(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    const short = SHORT_ESCAPES[char];
    if (short !== undefined) {
      out += short;
    } else if (char === "\\") {
      out += "\\\\";
    } else if (char === '"') {
      out += '\\"';
    } else if (code < 0x20 || code === 0x7f) {
      out += `\\x${code.toString(16).toUpperCase().padStart(2, "0")}`;
    } else {
      out += char;
    }
  }
  return out;
}

/** Read a value that must be a non-empty, trimmed string. */
function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string, got ${describe(value)}`);
  }
  return value.trim();
}

/** Read a value that must be a string (empty allowed; validated separately). */
function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string, got ${describe(value)}`);
  }
  return value;
}

/** Render an arbitrary value for an error message, bounded in length. */
function describe(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}

/** Validate a winget `PackageIdentifier`. */
function validateIdentifier(value: string): string {
  if (value.length > MAX_IDENTIFIER_LENGTH) {
    throw new Error(
      `id must be at most ${MAX_IDENTIFIER_LENGTH} characters, got ${describe(value)}`,
    );
  }
  if (!IDENTIFIER_PATTERN.test(value) || !value.includes(".")) {
    throw new Error(
      `id must look like Publisher.App (letters, digits, dots and hyphens, at least one dot), got ${describe(value)}`,
    );
  }
  return value;
}

/** Validate a winget `PackageVersion`: numeric core plus optional suffix. */
function validateVersion(value: string): string {
  if (!VERSION_PATTERN.test(value)) {
    throw new Error(
      `version must be digits and dots with an optional -prerelease suffix, got ${describe(value)}`,
    );
  }
  return value;
}

/** Validate the installer URL and return it plus the installer type. */
function validateInstallerUrl(value: string): { url: string; type: "exe" | "msi" } {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`installerUrl must be an absolute http(s) URL, got ${describe(value)}`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(
      `installerUrl must use http or https, got ${describe(value)}`,
    );
  }
  if (parsed.hostname === "") {
    throw new Error(`installerUrl must name a host, got ${describe(value)}`);
  }
  const path = parsed.pathname.toLowerCase();
  if (path.endsWith(".msi")) return { url: value, type: "msi" };
  if (path.endsWith(".exe")) return { url: value, type: "exe" };
  throw new Error(
    `installerUrl must end in .exe or .msi to pick InstallerType, got ${describe(value)}`,
  );
}

/** Validate the installer digest and normalise it to upper-case hex. */
function validateSha256(value: string): string {
  if (!SHA256_PATTERN.test(value)) {
    throw new Error(
      `installerSha256 must be 64 hex digits, got ${describe(value)}`,
    );
  }
  return value.toUpperCase();
}

/**
 * Build a winget manifest from `info`.
 *
 * Throws `Error` naming the field and echoing the bad value when the id is
 * not `Publisher.App` shaped, the version is not digits-and-dots (with an
 * optional `-suffix`), a text field is blank, the installer URL is not an
 * absolute http(s) URL ending in `.exe` or `.msi`, or the digest is not 64 hex
 * digits. The returned digest is always upper-case.
 */
export function buildWingetManifest(info: PackageInfo): WingetManifest {
  const id = validateIdentifier(requiredString(info.id, "id"));
  const name = requiredString(info.name, "name");
  const publisher = requiredString(info.publisher, "publisher");
  const version = validateVersion(requiredString(info.version, "version"));
  const licence = requiredString(info.licence, "licence");
  const installer = validateInstallerUrl(requiredString(info.installerUrl, "installerUrl"));
  const sha256 = validateSha256(stringValue(info.installerSha256, "installerSha256").trim());

  return {
    PackageIdentifier: id,
    PackageVersion: version,
    PackageName: name,
    Publisher: publisher,
    License: licence,
    InstallerType: installer.type,
    InstallerUrl: installer.url,
    InstallerSha256: sha256,
  };
}

/** Quote a scalar for YAML output. */
function quote(value: string): string {
  return `"${escapeYamlDouble(value)}"`;
}

/**
 * Serialise a manifest as a single-document winget installer YAML file.
 *
 * Keys are emitted in the order winget's templates use, one level deep only;
 * this is the 1.0 `Installer` manifest shape, not the multi-file set.
 */
export function toWingetYaml(manifest: WingetManifest): string {
  const lines: string[] = [
    "PackageIdentifier: " + quote(manifest.PackageIdentifier),
    "PackageVersion: " + quote(manifest.PackageVersion),
    "PackageName: " + quote(manifest.PackageName),
    "Publisher: " + quote(manifest.Publisher),
    "License: " + quote(manifest.License),
    "Installers:",
    "  - Architecture: x64",
    "    InstallerType: " + quote(manifest.InstallerType),
    "    InstallerUrl: " + quote(manifest.InstallerUrl),
    "    InstallerSha256: " + quote(manifest.InstallerSha256),
  ];
  return lines.join("\n") + "\n";
}
