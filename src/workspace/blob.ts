import { createHash } from "node:crypto";
import type { Event } from "../protocol/types.js";

/**
 * The blob channel: files too big to be a single event travel as chunks with
 * a hash, and every node that sees the chunks can reassemble the file. The
 * cap stays: a 300 MB model is not an event either way.
 */

export const MAX_BLOB_BYTES = 8 * 1024 * 1024;
export const BLOB_CHUNK_BYTES = 256 * 1024;

/** sha256 of the raw bytes, hex — the id a blob set travels under. */
export function hashBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** One file as base64 chunk payloads, in order. */
export function blobChunks(buffer: Buffer, chunkBytes = BLOB_CHUNK_BYTES): { chunk: number; chunks: number; data: string }[] {
  const total = Math.max(1, Math.ceil(buffer.length / chunkBytes));
  const parts: { chunk: number; chunks: number; data: string }[] = [];
  for (let index = 0; index < total; index += 1) {
    const slice = buffer.subarray(index * chunkBytes, Math.min(buffer.length, (index + 1) * chunkBytes));
    parts.push({ chunk: index, chunks: total, data: slice.toString("base64") });
  }
  return parts;
}

/** A blob event as the sender wrote it, or null when it is not one. */
export interface BlobChunk {
  readonly hash: string;
  readonly path: string;
  readonly chunk: number;
  readonly chunks: number;
  readonly data: string;
}

export function parseBlobEvent(event: Event): BlobChunk | null {
  if (event.type !== "blob") return null;
  const data = event.data as Record<string, unknown> | null;
  if (data === null || typeof data !== "object") return null;
  const hash = data["hash"];
  const path = data["path"];
  const chunk = data["chunk"];
  const chunks = data["chunks"];
  const payload = data["data"];
  if (typeof hash !== "string" || hash.length !== 64) return null;
  if (typeof path !== "string" || path.length === 0 || path.includes("..") || path.startsWith("/")) return null;
  if (typeof chunk !== "number" || !Number.isInteger(chunk) || chunk < 0) return null;
  if (typeof chunks !== "number" || !Number.isInteger(chunks) || chunks < 1 || chunk >= chunks) return null;
  if (typeof payload !== "string" || payload.length === 0) return null;
  return { hash, path, chunk, chunks, data: payload };
}

/**
 * Accumulates incoming chunks and hands a file back only when the set is
 * complete and its bytes hash to the id it claimed. An incomplete or lying
 * set never becomes a file.
 */
export class BlobSlate {
  private readonly sets = new Map<string, { chunks: Map<number, string>; total: number }>();

  /** True when this chunk completed a set (already-known chunks return false). */
  add(event: Event): boolean {
    const chunk = parseBlobEvent(event);
    if (chunk === null) return false;
    let set = this.sets.get(chunk.hash);
    if (set === undefined) {
      set = { chunks: new Map<number, string>(), total: chunk.chunks };
      this.sets.set(chunk.hash, set);
    }
    if (set.total !== chunk.chunks || set.chunks.has(chunk.chunk)) return false;
    set.chunks.set(chunk.chunk, chunk.data);
    return set.chunks.size === set.total;
  }

  /** The reassembled file when every chunk arrived and the hash holds. */
  get(hash: string): Buffer | null {
    const set = this.sets.get(hash);
    if (set === undefined || set.chunks.size !== set.total) return null;
    const parts: Buffer[] = [];
    for (let index = 0; index < set.total; index += 1) {
      const data = set.chunks.get(index);
      if (data === undefined) return null;
      parts.push(Buffer.from(data, "base64"));
    }
    const whole = Buffer.concat(parts);
    return hashBuffer(whole) === hash ? whole : null;
  }

  forget(hash: string): void {
    this.sets.delete(hash);
  }
}
