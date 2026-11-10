/**
 * SHA-256 checksums for a list of files on disk.
 *
 * Hashing is all-or-report: a path that cannot be read never aborts the batch
 * and never throws. It comes back in `missing` with a reason, next to the
 * checksums that did succeed, so the caller can decide whether a package may
 * ship. Nothing is read at import time; only `checksumFiles` touches the disk.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export interface Checksum {
  path: string;
  /** Lower-case hex SHA-256 digest of the file's bytes. */
  sha256: string;
  bytes: number;
}

export interface MissingFile {
  path: string;
  reason: string;
}

export interface ChecksumResult {
  ok: Checksum[];
  missing: MissingFile[];
}

/** Node's errno view of a read failure; anything else falls back to `String`. */
interface ReadFailure {
  code?: string;
  message?: string;
}

/** Turns a read error into one short, human-readable reason. */
function describeReadFailure(err: unknown): string {
  const e = (typeof err === "object" && err !== null ? err : {}) as ReadFailure;
  switch (e.code) {
    case "ENOENT":
      return "bestand bestaat niet";
    case "EACCES":
    case "EPERM":
      return "geen leesrechten";
    case "EISDIR":
      return "pad is een map, geen bestand";
    case "ELOOP":
      return "te veel symbolische koppelingen";
    case "ENAMETOOLONG":
      return "padnaam is te lang";
    case "ENOTDIR":
      return "een deel van het pad is geen map";
    default:
      return e.message ?? String(err);
  }
}

/** One path, one digest; a failure is returned rather than thrown. */
async function checksumOne(
  path: string,
): Promise<{ ok: Checksum } | { failed: MissingFile }> {
  if (typeof path !== "string" || path.length === 0) {
    return { failed: { path: String(path), reason: "leeg of ongeldig pad" } };
  }

  let data: Buffer;
  try {
    data = await readFile(path);
  } catch (err) {
    return { failed: { path, reason: describeReadFailure(err) } };
  }

  const sha256 = createHash("sha256").update(data).digest("hex");
  return { ok: { path, sha256, bytes: data.byteLength } };
}

/**
 * Hashes every path in `paths` with SHA-256, in the order given.
 *
 * A path that is empty, missing, a directory or unreadable ends up in `missing`
 * with a reason. The returned promise resolves for any input; it does not
 * reject on filesystem errors.
 */
export async function checksumFiles(paths: readonly string[]): Promise<ChecksumResult> {
  const ok: Checksum[] = [];
  const missing: MissingFile[] = [];

  // Sequential on purpose: a packaging run hashes tens of files, and serial
  // reads keep memory flat and the reported order identical to the input.
  for (const path of paths) {
    const result = await checksumOne(path);
    if ("ok" in result) {
      ok.push(result.ok);
    } else {
      missing.push(result.failed);
    }
  }

  return { ok, missing };
}

/**
 * `sha256sum`-compatible output: `<hex>  <path>` per line, two spaces between
 * digest and path, sorted by path ascending, always newline-terminated.
 * An empty list yields the empty string.
 */
export function formatSha256sum(ok: readonly Checksum[]): string {
  if (ok.length === 0) {
    return "";
  }

  const lines = ok
    .map((entry) => ({ path: entry.path, line: `${entry.sha256}  ${entry.path}` }))
    // Code-unit order, not locale order: the same list must sort the same way
    // on every machine that builds a package.
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((entry) => entry.line);

  return `${lines.join("\n")}\n`;
}
