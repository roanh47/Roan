/**
 * Version negotiation for the opening `hello` frame.
 *
 * A peer tells us which protocol version it speaks; this module decides whether
 * the two builds can talk and, when they cannot, says so in one line that names
 * both sides. It is deliberately the only place that turns "our version" and
 * "their version" into a decision, so the daemon never has to re-implement the
 * rule and never has to invent a half-readable error at the edge of a socket.
 *
 * The rule is the one `version.ts` already documents: the major parts must be
 * equal, because a major bump means the wire format changed, and the remote
 * minor must not be newer than the local one, because a newer peer may rely on
 * something this build does not send. An older minor is fine — minor bumps only
 * add to the format.
 *
 * `remote` is typed `unknown` on purpose: it arrives as parsed JSON, so it can
 * be anything at all, and a handshake must reject garbage rather than trust a
 * cast. Both versions are named in every failure message, including when the
 * unreadable one is our own.
 */

import {
  MAX_PART,
  formatVersion,
  isCompatible,
  type ProtocolVersion,
} from "./version.js";

/** A version-shaped value: both parts integers in `0..MAX_PART`. */
function isReadable(value: unknown): value is ProtocolVersion {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { major, minor } = value as { major?: unknown; minor?: unknown };
  return (
    typeof major === "number" &&
    typeof minor === "number" &&
    Number.isInteger(major) &&
    Number.isInteger(minor) &&
    major >= 0 &&
    major <= MAX_PART &&
    minor >= 0 &&
    minor <= MAX_PART
  );
}

/**
 * Renders a version for an error message. Readable versions use the canonical
 * `major.minor` spelling; anything else is shown as a short preview so the
 * message never grows with the input and cannot throw while formatting (a
 * non-finite number that would otherwise become JSON `null` stays visible).
 */
function show(value: unknown): string {
  if (isReadable(value)) {
    return `v${formatVersion(value)}`;
  }
  let preview: string;
  try {
    preview = typeof value === "object" && value !== null
      ? JSON.stringify(value, (_key, inner: unknown) =>
          typeof inner === "number" && !Number.isFinite(inner) ? String(inner) : inner)
      : String(value);
  } catch {
    preview = "<unprintable>";
  }
  if (preview === undefined) {
    preview = String(value);
  }
  return preview.length > 60 ? `${preview.slice(0, 57)}...` : preview;
}

/** The one error shape this module throws; it always names both versions. */
function fail(local: unknown, remote: unknown, reason: string): Error {
  return new Error(
    `Protocol negotiation failed: ${reason} (local ${show(local)}, remote ${show(remote)})`,
  );
}

/**
 * Accepts `remote` when it can talk to `local`, and returns the version the
 * pair will speak.
 *
 * Accepted: the same major with a remote minor at or below the local minor.
 * Refused: a different major, a newer remote minor, and any value that is not
 * a readable `{ major, minor }` pair — including `null`, a string, a missing
 * part, a non-integer and a part outside `0..999`. Every refusal mentions both
 * versions, so a log line is enough to tell which builds met.
 *
 * @throws Error when the versions are incompatible or either is unreadable.
 */
export function negotiate(
  local: ProtocolVersion,
  remote: unknown,
): ProtocolVersion {
  if (!isReadable(local)) {
    throw fail(local, remote, "local version is unreadable");
  }
  if (!isReadable(remote)) {
    throw fail(local, remote, "remote version is unreadable");
  }
  if (!isCompatible(remote, local)) {
    if (remote.major !== local.major) {
      throw fail(
        local,
        remote,
        `remote major ${remote.major} does not match local major ${local.major}`,
      );
    }
    throw fail(
      local,
      remote,
      `remote minor ${remote.minor} is newer than local minor ${local.minor}`,
    );
  }
  return remote;
}
