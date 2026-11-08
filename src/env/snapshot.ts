/**
 * Validation of a snapshot that came over the wire.
 *
 * A snapshot is untrusted input: it may be old, corrupted, or edited by hand.
 * Everything is checked here — version, paths inside the env, per-entry hashes,
 * nesting — before `applyEnvSnapshot` touches a single local file.
 */

import {
  ENV_SNAPSHOT_VERSION,
  MAX_ENV_ENTRY_BYTES,
  assertManagedEnvPath,
  isKindAllowed,
  type EnvEntry,
  type EnvSnapshot,
} from "./types.js";
import { EMPTY_SHA256, hashEnvEntries, sha256Hex } from "./pack.js";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export interface ParseOptions {
  /** Recompute the snapshot hash and refuse a mismatch. Default true. */
  verifyHash?: boolean;
  maxEntryBytes?: number;
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${what} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asString(record: Record<string, unknown>, key: string, what: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new Error(`${what}.${key} must be a string`);
  return value;
}

function asInteger(record: Record<string, unknown>, key: string, what: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${what}.${key} must be a non-negative integer`);
  }
  return value;
}

export function decodeEnvEntry(entry: EnvEntry): Buffer {
  return entry.encoding === "base64"
    ? Buffer.from(entry.content, "base64")
    : Buffer.from(entry.content, "utf8");
}

function parseEntry(value: unknown, index: number, maxEntryBytes: number): EnvEntry {
  const what = `snapshot.entries[${index}]`;
  const raw = asRecord(value, what);

  const declaredPath = asString(raw, "path", what);
  const normalised = assertManagedEnvPath(declaredPath);
  if (normalised !== declaredPath) {
    throw new Error(`${what}.path is not canonical: ${declaredPath}`);
  }

  const kind = asString(raw, "kind", what);
  if (kind !== "file" && kind !== "dir") throw new Error(`${what}.kind must be "file" or "dir"`);
  if (!isKindAllowed(normalised, kind)) {
    throw new Error(`${what}.path is not allowed to be a ${kind}: ${normalised}`);
  }

  const sha256 = asString(raw, "sha256", what);
  if (!SHA256_PATTERN.test(sha256)) throw new Error(`${what}.sha256 is not a sha256 hex digest`);

  const encoding = asString(raw, "encoding", what);
  if (encoding !== "utf8" && encoding !== "base64") {
    throw new Error(`${what}.encoding must be "utf8" or "base64"`);
  }

  const size = asInteger(raw, "size", what);
  const content = asString(raw, "content", what);

  if (kind === "dir") {
    if (size !== 0 || content !== "" || encoding !== "utf8" || sha256 !== EMPTY_SHA256) {
      throw new Error(`${what} is a directory but carries content`);
    }
    return { path: normalised, kind, sha256, size: 0, encoding, content: "" };
  }

  if (size > maxEntryBytes) {
    throw new Error(
      `${what} is too large: ${size} bytes (limit ${maxEntryBytes}); ` +
        "large assets belong in synced-workspace/, not in the chain",
    );
  }
  const entry: EnvEntry = { path: normalised, kind, sha256, size, encoding, content };
  const bytes = decodeEnvEntry(entry);
  if (bytes.byteLength !== size) {
    throw new Error(`${what}.size says ${size} bytes but the content is ${bytes.byteLength}`);
  }
  if (sha256Hex(bytes) !== sha256) {
    throw new Error(`${what}.sha256 does not match its content (${normalised})`);
  }

  return entry;
}

/**
 * Validate and normalise a snapshot. Throws on anything that is not exactly an
 * env snapshot for the managed paths; never falls back to a partial apply.
 */
export function parseEnvSnapshot(value: unknown, options: ParseOptions = {}): EnvSnapshot {
  // A chain event may hand us the snapshot as JSON text; accept both that and
  // an already-decoded object.
  let payload = value;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload) as unknown;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`env snapshot is not valid JSON: ${message}`);
    }
  }

  const root = asRecord(payload, "snapshot");
  const version = root["version"];
  if (version !== ENV_SNAPSHOT_VERSION) {
    throw new Error(`unsupported env snapshot version: ${String(version)}`);
  }

  const chainId = asString(root, "chainId", "snapshot");
  const nodeId = asString(root, "nodeId", "snapshot");
  const createdAt = asString(root, "createdAt", "snapshot");
  if (Number.isNaN(Date.parse(createdAt))) {
    throw new Error(`snapshot.createdAt is not an ISO timestamp: ${createdAt}`);
  }

  const hash = asString(root, "hash", "snapshot");
  if (!SHA256_PATTERN.test(hash)) throw new Error("snapshot.hash is not a sha256 hex digest");

  const rawEntries = root["entries"];
  if (!Array.isArray(rawEntries)) throw new Error("snapshot.entries must be an array");

  const maxEntryBytes = options.maxEntryBytes ?? MAX_ENV_ENTRY_BYTES;
  const entries = rawEntries.map((entry, index) => parseEntry(entry, index, maxEntryBytes));

  const byPath = new Map<string, EnvEntry>();
  for (const entry of entries) {
    if (byPath.has(entry.path)) throw new Error(`snapshot has a duplicate entry: ${entry.path}`);
    byPath.set(entry.path, entry);
  }

  // A path may not be both a file and the parent of another entry.
  for (const entry of entries) {
    const segments = entry.path.split("/");
    for (let i = 1; i < segments.length; i++) {
      const ancestor = byPath.get(segments.slice(0, i).join("/"));
      if (ancestor !== undefined && ancestor.kind !== "dir") {
        throw new Error(`snapshot nests ${entry.path} under the file ${ancestor.path}`);
      }
    }
  }

  const computed = hashEnvEntries(entries);
  if ((options.verifyHash ?? true) && computed !== hash) {
    throw new Error(`snapshot hash mismatch: declared ${hash}, computed ${computed}`);
  }

  return {
    version: ENV_SNAPSHOT_VERSION,
    chainId,
    nodeId,
    createdAt,
    hash: computed,
    entries: entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  };
}
