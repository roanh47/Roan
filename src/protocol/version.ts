/**
 * Protocol versions: the `major.minor` pair peers exchange in a handshake.
 *
 * A protocol version is deliberately smaller than a package version. There is
 * no patch level, because a peer cannot tell the difference between two patch
 * releases from the wire, and no prerelease suffix, because a handshake is the
 * wrong place to discover that the other side is a beta.
 *
 * The rules are strict on purpose: `parseVersion` accepts exactly two
 * dot-separated runs of digits, rejects anything else, and always names the
 * offending text. Leading zeros are rejected as well, so every accepted text
 * has exactly one spelling and `formatVersion(parseVersion(text))` returns
 * `text` unchanged.
 */

/** A protocol version. Both parts are integers in the range 0..999. */
export interface ProtocolVersion {
  readonly major: number;
  readonly minor: number;
}

/**
 * Highest value a single part may take.
 *
 * Three digits each keep a version readable in a URL, a log line and a
 * handshake frame, and leave no room for a number that JavaScript cannot
 * represent exactly.
 */
export const MAX_PART = 999;

/** The version this build speaks. Bump it when the wire format changes. */
export const LATEST: ProtocolVersion = { major: 1, minor: 0 };

/** Exactly two numeric parts, nothing before, nothing after. */
const VERSION_PATTERN = /^(\d+)\.(\d+)$/;

/** Throws the one error shape this module has, always naming the input. */
function invalidVersion(input: string, reason: string): Error {
  return new Error(`Invalid protocol version "${input}": ${reason}`);
}

/**
 * Numeric part: digits only (guaranteed by the caller's regex), no leading
 * zeros unless the part is literally `0`, and at most `MAX_PART`.
 *
 * `01.2` is rejected rather than read as `1.2` so one version has one
 * spelling; `1.02` and `1.2` must not both parse to the same pair.
 */
function parsePart(text: string, input: string, name: string): number {
  if (text.length > 1 && text.startsWith("0")) {
    throw invalidVersion(input, `${name} has a leading zero`);
  }
  const value = Number(text);
  if (value > MAX_PART) {
    throw invalidVersion(input, `${name} must be at most ${MAX_PART}`);
  }
  return value;
}

/**
 * Parses a strict `major.minor` protocol version.
 *
 * Rejected: anything that is not two dot-separated runs of digits — empty
 * input, empty parts (`1.`, `.1`, `1..2`), three parts, a leading `+` or `-`,
 * surrounding or embedded whitespace, and any part above `MAX_PART`.
 *
 * @throws Error when the input is not a valid protocol version; the message
 *   always contains the offending string.
 */
export function parseVersion(text: string): ProtocolVersion {
  if (typeof text !== "string") {
    // Reachable from plain JS callers; the signature says string.
    throw invalidVersion(String(text), "expected a string");
  }

  const match = VERSION_PATTERN.exec(text);
  if (match === null) {
    throw invalidVersion(text, "expected <major>.<minor> as two integers");
  }

  const majorText = match[1];
  const minorText = match[2];
  if (majorText === undefined || minorText === undefined) {
    throw invalidVersion(text, "expected two numeric parts");
  }

  return {
    major: parsePart(majorText, text, "major"),
    minor: parsePart(minorText, text, "minor"),
  };
}

/**
 * The canonical string for a version: `${major}.${minor}`.
 *
 * @throws Error when a part is not an integer inside `0..MAX_PART`; the
 *   message names the part and the offending value.
 */
export function formatVersion(v: ProtocolVersion): string {
  for (const [name, value] of [
    ["major", v.major],
    ["minor", v.minor],
  ] as const) {
    if (!Number.isInteger(value) || value < 0 || value > MAX_PART) {
      throw new Error(
        `formatVersion: ${name} must be an integer in 0..${MAX_PART}, got ${String(value)}`,
      );
    }
  }
  return `${v.major}.${v.minor}`;
}

/**
 * True when a peer speaking `peer` can talk to a local build speaking `local`.
 *
 * The major part must match exactly: a major bump means the wire format
 * changed. The peer's minor part may be anything up to and including the local
 * one, because minor bumps only add to the format. A peer that is newer than
 * the local build is therefore not compatible — it may rely on something this
 * side does not send.
 */
export function isCompatible(peer: ProtocolVersion, local: ProtocolVersion): boolean {
  return peer.major === local.major && peer.minor <= local.minor;
}

/**
 * One-line human summary, for a log line or a banner: `protocol v1.4`.
 *
 * Defaults to `LATEST` so a caller can describe the build it is running.
 */
export function describeVersion(v: ProtocolVersion = LATEST): string {
  return `protocol v${formatVersion(v)}`;
}
