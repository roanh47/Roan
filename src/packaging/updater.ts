/**
 * Update-feed entries: the typed record an updater reads to decide whether a
 * newer build exists, where to download it and what to expect.
 *
 * Two directions, one validator: `buildFeedEntry` turns packaging input into
 * the record we publish, `parseFeedEntry` turns bytes we received back into
 * the same record. Both run the identical checks, so a feed written by this
 * module is always readable by it, and a hand-edited feed cannot smuggle in a
 * field the updater does not understand.
 *
 * Versions go through `semver.ts` rather than a local regex: the one strict
 * parser in the tree is the one authority on what a version may look like.
 * Every failure throws an `Error` that names the field and quotes the
 * offending value; the quote is bounded so a 2 kB note cannot fill a log line.
 */

import { parseVersion } from "./semver.js";

/** What a packaging step supplies to build an entry. */
export interface FeedEntryInput {
  /** Strict `major.minor.patch[-prerelease]`, validated by `parseVersion`. */
  readonly version: string;
  /** Absolute `https:` download URL. */
  readonly url: string;
  /** Lower-case hex SHA-256 of the artifact, exactly 64 characters. */
  readonly sha256: string;
  /** Release notes; trimmed, defaults to the empty string. */
  readonly notes?: string;
  /** Defaults to `false` so a feed entry can never accidentally force an update. */
  readonly mandatory?: boolean;
}

/** What the updater reads: every field present, nothing optional left over. */
export interface FeedEntry {
  readonly version: string;
  readonly url: string;
  readonly sha256: string;
  readonly notes: string;
  readonly mandatory: boolean;
}

/** Longest note we publish; longer notes belong in the changelog, not the feed. */
const MAX_NOTES_LENGTH = 2000;

/** How much of a rejected value an error message quotes before eliding. */
const MAX_DESCRIBED_CHARS = 80;

/** Lower-case hex SHA-256 only: the feed is compared byte-for-byte, no case folding. */
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** The only fields a feed entry may carry, in emission order. */
const FIELD_NAMES: readonly string[] = ["version", "url", "sha256", "notes", "mandatory"];

/** Fields that must be present; `notes` and `mandatory` have defaults. */
const REQUIRED_FIELDS: readonly string[] = ["version", "url", "sha256"];

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

/** Narrow an unknown to a plain record, naming `what` when it is not one. */
function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${what} must be an object, got ${describe(value)}`);
  }
  return value as Record<string, unknown>;
}

/** Validate a strict version through the shared parser. */
function validateVersionField(value: unknown): string {
  if (typeof value !== "string" || value === "") {
    throw new Error(`version must be a non-empty string, got ${describe(value)}`);
  }
  try {
    parseVersion(value);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `version must be a strict semantic version, got ${describe(value)} (${reason})`,
    );
  }
  return value;
}

/** Require an absolute `https:` URL with a host. */
function validateUrlField(value: unknown): string {
  if (typeof value !== "string" || value === "") {
    throw new Error(`url must be a non-empty string, got ${describe(value)}`);
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`url must be an absolute https URL, got ${describe(value)}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`url must use https, got ${describe(value)}`);
  }
  if (parsed.hostname === "") {
    throw new Error(`url must name a host, got ${describe(value)}`);
  }
  return value;
}

/** Require exactly 64 lower-case hex characters; no trimming, no case folding. */
function validateSha256Field(value: unknown): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new Error(
      `sha256 must be exactly 64 lower-case hex characters, got ${describe(value)}`,
    );
  }
  return value;
}

/** Trim notes, default to empty, and refuse anything past the cap. */
function validateNotesField(value: unknown): string {
  if (value === undefined) {
    return "";
  }
  if (typeof value !== "string") {
    throw new Error(`notes must be a string, got ${describe(value)}`);
  }

  const trimmed = value.trim();
  if (trimmed.length > MAX_NOTES_LENGTH) {
    throw new Error(
      `notes must be at most ${MAX_NOTES_LENGTH} characters after trimming, got ${trimmed.length}: ${describe(trimmed)}`,
    );
  }
  return trimmed;
}

/** Default to `false`; a non-boolean is a feed error, not a truthy value. */
function validateMandatoryField(value: unknown): boolean {
  if (value === undefined) {
    return false;
  }
  if (typeof value !== "boolean") {
    throw new Error(`mandatory must be a boolean, got ${describe(value)}`);
  }
  return value;
}

/** The single validation path shared by build and parse. */
function toFeedEntry(source: Record<string, unknown>): FeedEntry {
  return {
    version: validateVersionField(source["version"]),
    url: validateUrlField(source["url"]),
    sha256: validateSha256Field(source["sha256"]),
    notes: validateNotesField(source["notes"]),
    mandatory: validateMandatoryField(source["mandatory"]),
  };
}

/**
 * Build a feed entry from packaging input.
 *
 * The result always carries all five fields: `notes` is trimmed (and may be
 * empty), `mandatory` is `false` when omitted.
 *
 * @throws Error when the version is not strict semver, the URL is not
 *   absolute `https`, the digest is not 64 lower-case hex characters, the
 *   notes exceed 2000 characters after trimming, or `mandatory` is not a
 *   boolean. Every message names the field and quotes the value.
 */
export function buildFeedEntry(info: FeedEntryInput): FeedEntry {
  return toFeedEntry(asRecord(info, "feed entry info"));
}

/**
 * Parse a feed entry received from outside, validating the same rules as
 * `buildFeedEntry`.
 *
 * `notes` and `mandatory` may be omitted (they get the same defaults);
 * `version`, `url` and `sha256` must be present. Any field this module does
 * not know is an error rather than something silently ignored, because an
 * unknown field usually means a feed from a newer, incompatible writer.
 *
 * @throws Error naming the offending field when the value is not an object,
 *   carries an unknown field, is missing a required field, or fails any of
 *   the value checks above.
 */
export function parseFeedEntry(input: unknown): FeedEntry {
  const record = asRecord(input, "feed entry");

  for (const key of Object.keys(record)) {
    if (!FIELD_NAMES.includes(key)) {
      throw new Error(`feed entry has unknown field ${describe(key)}`);
    }
  }
  for (const field of REQUIRED_FIELDS) {
    if (record[field] === undefined) {
      throw new Error(`feed entry is missing required field ${describe(field)}`);
    }
  }

  return toFeedEntry(record);
}
