/**
 * Release manifest: the typed list of downloadable files for one build.
 *
 * A manifest is deliberately boring. It names, per platform and architecture,
 * the artefact a user should fetch, how many bytes it is, what its SHA-256
 * digest is and where it lives. Everything else — notes, channels, signing —
 * belongs to the feed entry in `updater.ts`.
 *
 * One validator serves both directions: `buildReleaseManifest` accepts what
 * the packaging run produced, `toMarkdown` accepts the same records for the
 * release notes, and both go through the identical checks and the identical
 * sort. Versions are parsed by `semver.ts` rather than a local regex, so there
 * is still exactly one authority on what a version may look like.
 *
 * Sorting is by platform, then architecture, both in code-unit order: the same
 * input must produce byte-identical output on every machine that builds a
 * package. A duplicate platform+architecture pair is an error, never a silent
 * overwrite, because two artefacts for the same target is a packaging bug and
 * not something a downloader should resolve by guessing.
 */

import { parseVersion } from "./semver.js";

/** One downloadable artefact in a release manifest. */
export interface ReleaseManifestEntry {
  /** Strict `major.minor.patch[-prerelease]`, validated by `parseVersion`. */
  readonly version: string;
  /** Target platform, e.g. `linux`, `win32`, `darwin`. */
  readonly platform: string;
  /** Target architecture, e.g. `x64`, `arm64`. */
  readonly arch: string;
  /** Plain file name as published, without any directory part. */
  readonly file: string;
  /** Size in bytes, a positive whole number. */
  readonly bytes: number;
  /** Lower-case hex SHA-256 of `file`, exactly 64 characters. */
  readonly sha256: string;
  /** Absolute `https:` download URL for exactly this file. */
  readonly url: string;
}

/** The only fields an entry may carry; anything else is a writer/reader mismatch. */
const FIELD_NAMES: readonly string[] = [
  "version",
  "platform",
  "arch",
  "file",
  "bytes",
  "sha256",
  "url",
];

/** How much of a rejected value an error message quotes before eliding. */
const MAX_DESCRIBED_CHARS = 80;

/** Lower-case hex SHA-256 only: a digest is compared byte-for-byte, no case folding. */
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Platform and architecture labels. Restricted on purpose: these strings end up
 * as map keys, in error messages and inside Markdown, so punctuation beyond the
 * usual `+._-` set buys nothing and would need escaping everywhere.
 */
const LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;

/** Path separators and control characters; none of them belong in a published name. */
const UNSAFE_FILE_PATTERN = /[\\/\u0000-\u001f\u007f]/;

/** Characters a URL may not carry: the markdown link would break or lie. */
const UNSAFE_URL_PATTERN = /[\s<>]/;

/** Size units, ascending. `B` is handled separately so it is printed without a decimal. */
const SIZE_UNITS: readonly string[] = ["kB", "MB", "GB", "TB"];

/** Render an arbitrary value for an error message, bounded in length. */
function describe(value: unknown): string {
  if (typeof value === "string") {
    const quoted =
      value.length > MAX_DESCRIBED_CHARS
        ? `${value.slice(0, MAX_DESCRIBED_CHARS)}…(${value.length} chars)`
        : value;
    return JSON.stringify(quoted);
  }
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}

/** The one error shape this module has: names the entry, the field and the value. */
function fieldError(entry: string, field: string, problem: string, value: unknown): Error {
  return new Error(`release manifest ${entry}: field "${field}" ${problem}, got ${describe(value)}`);
}

/** Narrow an unknown to a plain record, naming `what` when it is not one. */
function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${what} must be an object, got ${describe(value)}`);
  }
  return value as Record<string, unknown>;
}

/** Require a platform or architecture label from the restricted alphabet. */
function validateLabel(entry: string, field: string, value: unknown): string {
  if (typeof value !== "string" || !LABEL_PATTERN.test(value)) {
    throw fieldError(entry, field, "must be a non-empty label of [A-Za-z0-9._+-]", value);
  }
  return value;
}

/** Validate a strict version through the shared parser. */
function validateVersion(entry: string, value: unknown): string {
  if (typeof value !== "string" || value === "") {
    throw fieldError(entry, "version", "must be a non-empty string", value);
  }
  try {
    parseVersion(value);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw fieldError(entry, "version", `must be a strict semantic version (${reason})`, value);
  }
  return value;
}

/** Require an absolute `https:` URL with a host and no whitespace or angle brackets. */
function validateUrl(entry: string, value: unknown): string {
  if (typeof value !== "string" || value === "") {
    throw fieldError(entry, "url", "must be a non-empty string", value);
  }
  if (UNSAFE_URL_PATTERN.test(value)) {
    throw fieldError(entry, "url", "must not contain whitespace or angle brackets", value);
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw fieldError(entry, "url", "must be an absolute https URL", value);
  }
  if (parsed.protocol !== "https:") {
    throw fieldError(entry, "url", "must use https", value);
  }
  if (parsed.hostname === "") {
    throw fieldError(entry, "url", "must name a host", value);
  }
  return value;
}

/** Require exactly 64 lower-case hex characters; no trimming, no case folding. */
function validateSha256(entry: string, value: unknown): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw fieldError(entry, "sha256", "must be exactly 64 lower-case hex characters", value);
  }
  return value;
}

/** Require a positive, exactly-representable whole number of bytes. */
function validateBytes(entry: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw fieldError(entry, "bytes", "must be a positive whole number of bytes", value);
  }
  return value;
}

/** Require a plain file name: no directory part, no control characters. */
function validateFile(entry: string, value: unknown): string {
  if (typeof value !== "string" || value === "") {
    throw fieldError(entry, "file", "must be a non-empty string", value);
  }
  if (UNSAFE_FILE_PATTERN.test(value)) {
    throw fieldError(entry, "file", "must be a plain file name without separators or control characters", value);
  }
  return value;
}

/**
 * Validate one entry. `index` is 0-based in the caller's list and reported as
 * 1-based, because that is how a human counts a diff in the manifest file.
 */
function toEntry(source: unknown, index: number): ReleaseManifestEntry {
  const position = `entry ${index + 1}`;
  const record = asRecord(source, `release manifest ${position}`);

  for (const key of Object.keys(record)) {
    if (!FIELD_NAMES.includes(key)) {
      throw new Error(`release manifest ${position} has unknown field ${describe(key)}`);
    }
  }

  // Platform and architecture come first so every later message can name the
  // target, not just a row number.
  const platform = validateLabel(position, "platform", record["platform"]);
  const arch = validateLabel(position, "arch", record["arch"]);
  const entry = `${position} (${platform}/${arch})`;

  return {
    version: validateVersion(entry, record["version"]),
    platform,
    arch,
    file: validateFile(entry, record["file"]),
    bytes: validateBytes(entry, record["bytes"]),
    sha256: validateSha256(entry, record["sha256"]),
    url: validateUrl(entry, record["url"]),
  };
}

/** Code-unit comparison: the same list must sort the same way on every machine. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Platform, then architecture; the pair is unique, so this is a total order. */
function compareEntries(a: ReleaseManifestEntry, b: ReleaseManifestEntry): number {
  return compareText(a.platform, b.platform) || compareText(a.arch, b.arch);
}

/** The key two entries must not share, kept out of band from the display label. */
function targetKey(entry: ReleaseManifestEntry): string {
  return `${entry.platform}\u0000${entry.arch}`;
}

/**
 * Build and validate a release manifest, sorted by platform then architecture.
 *
 * @throws Error naming the offending entry (by 1-based index plus
 *   `platform/arch` once known) and the field when the input is not an array,
 *   an entry is not an object, an entry carries an unknown field, a value fails
 *   its check (strict semver, absolute `https` URL, 64 lower-case hex SHA-256,
 *   positive byte count, plain file name, platform/arch label), or two entries
 *   describe the same platform+architecture pair.
 */
export function buildReleaseManifest(input: unknown): ReleaseManifestEntry[] {
  if (!Array.isArray(input)) {
    throw new Error(`release manifest must be an array of entries, got ${describe(input)}`);
  }

  const entries = input.map((source, index) => toEntry(source, index));

  // Duplicates are reported against the caller's order: the first occurrence
  // keeps its row, and the second names both so the diff is easy to find.
  const seen = new Map<string, number>();
  entries.forEach((entry, index) => {
    const key = targetKey(entry);
    const firstIndex = seen.get(key);
    if (firstIndex !== undefined) {
      throw new Error(
        `release manifest entry ${index + 1} (${entry.platform}/${entry.arch}): ` +
          `duplicate platform+arch pair, already used by entry ${firstIndex + 1}`,
      );
    }
    seen.set(key, index);
  });

  return entries.sort(compareEntries);
}

/**
 * A short Markdown list for the release notes: one bullet per artefact, sorted
 * like the manifest, with the file name as the link text and a human-readable
 * size. Digests are left to the manifest itself so the notes stay readable.
 *
 * The same validation runs as in `buildReleaseManifest`, so notes cannot
 * advertise an entry the manifest would refuse. An empty manifest yields the
 * empty string (nothing to list is not an error).
 *
 * @throws Error under the same rules as `buildReleaseManifest`.
 */
export function toMarkdown(entries: readonly ReleaseManifestEntry[]): string {
  const sorted = buildReleaseManifest(entries);
  if (sorted.length === 0) {
    return "";
  }

  const lines = sorted.map((entry) => {
    const label = `${entry.platform} (${entry.arch})`;
    return `- **${label}** — [${codeSpan(entry.file)}](<${entry.url}>) · ${formatBytes(entry.bytes)}`;
  });

  return `${lines.join("\n")}\n`;
}

/**
 * Wrap `text` in the shortest backtick code span that survives it, padding
 * with spaces when the text itself begins or ends with a backtick.
 */
function codeSpan(text: string): string {
  if (!text.includes("`")) {
    return `\`${text}\``;
  }
  return `\`\` ${text} \`\``;
}

/** Decimal units with one decimal; whole bytes stay whole. Locale-free on purpose. */
function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = "";
  for (const next of SIZE_UNITS) {
    if (value < 1000) {
      break;
    }
    value = value / 1000;
    unit = next;
  }
  return unit === "" ? `${bytes} B` : `${value.toFixed(1)} ${unit}`;
}
