/**
 * SHA-256 of one file on disk, read as a stream.
 *
 * The file is never buffered whole: a read stream hands over one chunk at a
 * time, each chunk is fed to the hash and then dropped, so peak memory stays at
 * one chunk no matter how large the file is. That is what lets this tool hash a
 * multi-gigabyte image or log without competing with the rest of the agent for
 * memory.
 *
 * Failures are thrown as `Error`, never returned as a success value: `run()`
 * callers in this repo surface the message to the model, and a digest that
 * silently stands for "unreadable" would be worse than no digest at all.
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

/** Options for {@link hashFile}; all fields are optional. */
export interface HashOptions {
  /**
   * Bytes handed to the hash per step (default 1 MiB). Clamped to at least one
   * byte and at most {@link MAX_CHUNK_BYTES}. Smaller chunks bound memory more
   * tightly; larger ones mean fewer read syscalls.
   */
  chunkBytes?: number;
  /** Cancels the read; the returned promise rejects. */
  signal?: AbortSignal;
}

/** Result of a successful {@link hashFile} call. */
export interface FileHash {
  /** The path exactly as it was passed in, not resolved. */
  path: string;
  /** Lower-case hex SHA-256 digest of the file's bytes. */
  sha256: string;
  /** Bytes actually hashed, as counted while reading. */
  bytes: number;
}

/** Default read size: big enough to amortise syscalls, small enough to forget. */
const DEFAULT_CHUNK_BYTES = 1024 * 1024;

/** Hard ceiling on the chunk size, so a silly option cannot buffer a whole file. */
const MAX_CHUNK_BYTES = 16 * 1024 * 1024;

/** Node's errno view of a failure; anything else falls back to `String`. */
interface FsFailure {
  code?: string;
  name?: string;
  message?: string;
}

function describeFailure(cause: unknown): string {
  const e = (typeof cause === "object" && cause !== null ? cause : {}) as FsFailure;
  switch (e.code) {
    case "ENOENT":
      return "file does not exist";
    case "EACCES":
    case "EPERM":
      return "permission denied";
    case "EISDIR":
      return "path is a directory, not a file";
    case "ELOOP":
      return "too many symbolic links";
    case "ENAMETOOLONG":
      return "path name is too long";
    case "ENOTDIR":
      return "part of the path is not a directory";
    default:
      return e.message ?? String(cause);
  }
}

/** Normalises the chunk size: integral, non-zero, and under the ceiling. */
function normalizeChunkBytes(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_CHUNK_BYTES;
  const whole = Math.floor(value);
  if (whole < 1) return 1;
  return Math.min(whole, MAX_CHUNK_BYTES);
}

function isAbort(cause: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted === true) return true;
  const e = (typeof cause === "object" && cause !== null ? cause : {}) as FsFailure;
  return e.name === "AbortError" || e.code === "ABORT_ERR";
}

/**
 * Hashes `filePath` with SHA-256 without ever holding the whole file in memory.
 *
 * - Regular files only: a directory, a device or a FIFO is rejected up front by
 *   an `lstat`-free `stat`, because reading a FIFO would block forever.
 * - Symbolic links are followed; the digest is of the target's bytes.
 * - `bytes` comes from what was actually read, not from the size reported before
 *   the read, so a file that grows or shrinks mid-hash still reports the truth.
 * - An empty file hashes to the well-known SHA-256 of the empty string.
 *
 * @throws Error when the path is missing, unreadable, not a regular file, or the
 *   read is aborted. The message names the operation and the path.
 */
export async function hashFile(filePath: string, options: HashOptions = {}): Promise<FileHash> {
  if (typeof filePath !== "string" || filePath.length === 0) {
    throw new Error("hash: path must be a non-empty string");
  }

  const { signal } = options;
  if (signal?.aborted === true) {
    throw new Error(`hash aborted: ${filePath}`);
  }

  let size: number;
  let isFile: boolean;
  try {
    const info = await stat(filePath);
    isFile = info.isFile();
    size = info.size;
  } catch (cause) {
    throw new Error(`hash: cannot stat ${filePath}: ${describeFailure(cause)}`);
  }
  if (!isFile) {
    throw new Error(`hash: not a regular file: ${filePath}`);
  }

  const hash = createHash("sha256");

  // An empty file still has a digest; skip the stream entirely so no fd is
  // opened for nothing. (A file that grew after stat is caught by the loop.)
  if (size === 0) {
    const sha256 = hash.digest("hex");
    return { path: filePath, sha256, bytes: 0 };
  }

  const chunkBytes = normalizeChunkBytes(options.chunkBytes);
  let bytes = 0;

  try {
    const stream = createReadStream(filePath, {
      highWaterMark: chunkBytes,
      ...(signal === undefined ? {} : { signal }),
    });
    for await (const chunk of stream) {
      const buffer = chunk as Buffer;
      hash.update(buffer);
      bytes += buffer.byteLength;
    }
  } catch (cause) {
    if (isAbort(cause, signal)) throw new Error(`hash aborted: ${filePath}`);
    throw new Error(`hash: cannot read ${filePath}: ${describeFailure(cause)}`);
  }

  return { path: filePath, sha256: hash.digest("hex"), bytes };
}

/**
 * `sha256sum`-compatible single line for a hash: `<hex>  <path>` with two
 * spaces, which is what `sha256sum -c` expects.
 */
export function formatHashLine(hash: FileHash): string {
  return `${hash.sha256}  ${hash.path}`;
}

/** Re-exported so callers can reason about the read size without hardcoding it. */
export const HASH_DEFAULT_CHUNK_BYTES = DEFAULT_CHUNK_BYTES;
