/**
 * Minimal strict semantic versions: parse, bump and format.
 *
 * Only the shape this project actually ships is accepted: exactly three
 * numeric parts (`major.minor.patch`) plus an optional prerelease suffix after
 * a single `-`. Build metadata (`+...`) is not supported, and neither are the
 * looser forms (`v1.2`, `1.2.3.4`, `=1.2.3`) that package managers like to
 * tolerate. Anything else is rejected instead of being guessed at, because a
 * silent guess here ends up in a published version string.
 *
 * Hand-written on purpose: no dependency, and no `semver` package in the tree.
 */

/** A parsed version. `prerelease` is the suffix without the leading `-`. */
export interface SemVer {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease?: string;
}

/** Which numeric part a bump moves. */
export type ReleasePart = "major" | "minor" | "patch";

/**
 * Three numeric parts, optionally followed by `-<suffix>`. The suffix is
 * captured as one opaque tail so a suffix that itself contains `-` or `.`
 * (e.g. `beta.1-x`) survives untouched.
 */
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/;

/** Prerelease characters, per the spec: `[0-9A-Za-z.-]+`. */
const PRERELEASE_PATTERN = /^[0-9A-Za-z.-]+$/;

/** Throws the one error shape this module has, always naming the input. */
function invalidVersion(input: string, reason: string): Error {
  return new Error(`Invalid version "${input}": ${reason}`);
}

/**
 * Numeric part: digits only (guaranteed by the caller's regex), no leading
 * zeros unless the part is literally `0`, and small enough to stay an exact
 * integer. `03` is rejected rather than read as `3` so `1.03.0` and `1.3.0`
 * cannot both parse to the same version.
 */
function parseNumericPart(text: string, input: string, name: string): number {
  if (text.length > 1 && text.startsWith("0")) {
    throw invalidVersion(input, `${name} has a leading zero`);
  }
  const value = Number(text);
  if (!Number.isSafeInteger(value)) {
    throw invalidVersion(input, `${name} is too large to represent exactly`);
  }
  return value;
}

/**
 * Parses a strict `major.minor.patch` version, keeping any `-prerelease`
 * suffix intact.
 *
 * @throws Error when the input is not a strict version; the message always
 *   contains the offending string.
 */
export function parseVersion(input: string): SemVer {
  if (typeof input !== "string") {
    // Reachable from plain JS callers; the signature says string.
    throw invalidVersion(String(input), "expected a string");
  }

  const match = VERSION_PATTERN.exec(input);
  if (match === null) {
    throw invalidVersion(input, "expected <major>.<minor>.<patch>[-<prerelease>]");
  }

  const majorText = match[1];
  const minorText = match[2];
  const patchText = match[3];
  const prereleaseText = match[4];
  if (majorText === undefined || minorText === undefined || patchText === undefined) {
    throw invalidVersion(input, "expected three numeric parts");
  }

  const major = parseNumericPart(majorText, input, "major");
  const minor = parseNumericPart(minorText, input, "minor");
  const patch = parseNumericPart(patchText, input, "patch");

  if (prereleaseText === undefined) {
    return { major, minor, patch };
  }
  if (!PRERELEASE_PATTERN.test(prereleaseText)) {
    throw invalidVersion(input, "prerelease may only contain [0-9A-Za-z.-]");
  }
  return { major, minor, patch, prerelease: prereleaseText };
}

/**
 * The canonical string for a parsed version.
 *
 * `prerelease` is appended verbatim when present, so `parseVersion` and
 * `formatVersion` round-trip every accepted input.
 */
export function formatVersion(v: SemVer): string {
  const base = `${v.major}.${v.minor}.${v.patch}`;
  return v.prerelease === undefined ? base : `${base}-${v.prerelease}`;
}

/**
 * Bumps one part and zeroes everything below it: `major` clears minor and
 * patch, `minor` clears patch, `patch` only advances patch.
 *
 * The prerelease suffix is preserved as-is, so `1.2.3-beta.1` bumped at
 * `patch` becomes `1.2.4-beta.1` rather than dropping to a release or
 * renumbering the beta counter. Deciding when a prerelease is "done" belongs
 * to the caller, not to this helper.
 *
 * @throws Error when `version` is not a strict version (see `parseVersion`).
 */
export function bumpVersion(version: string, part: ReleasePart): string {
  const parsed = parseVersion(version);
  const { major, minor, patch, prerelease } = parsed;

  let bumped: SemVer;
  switch (part) {
    case "major":
      bumped = { major: major + 1, minor: 0, patch: 0 };
      break;
    case "minor":
      bumped = { major, minor: minor + 1, patch: 0 };
      break;
    case "patch":
      bumped = { major, minor, patch: patch + 1 };
      break;
    default: {
      // Exhaustive for the union; reachable only from untyped JS callers.
      const unknown: never = part;
      throw new Error(`Invalid release part "${String(unknown)}" for "${version}"`);
    }
  }

  return formatVersion(prerelease === undefined ? bumped : { ...bumped, prerelease });
}
