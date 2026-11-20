import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { join, relative, sep } from "node:path";
import { hashBuffer } from "./blob.js";

/**
 * The files of the shared workspace, as things that can travel.
 *
 * Text below a size where "send the whole file" stops being sane rides a
 * single event. Bigger or binary files travel as hashed chunks instead —
 * the blob channel — and beyond that cap nothing syncs at all: a 300 MB
 * model should not be an event either way, and pretending it can be is how
 * sync systems eat disk.
 */
export const MAX_FILE_BYTES = 512 * 1024;
export const MAX_BLOB_FILE_BYTES = 8 * 1024 * 1024;

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".cache", "__pycache__", ".venv", "target"]);

export interface FileEntry {
  readonly path: string;
  readonly hash: string;
  readonly bytes: number;
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function looksBinary(buffer: Buffer): boolean {
  const end = Math.min(buffer.length, 4096);
  for (let i = 0; i < end; i += 1) if (buffer[i] === 0) return true;
  return false;
}

export interface ScannedWorkspace {
  /** Files that ride a single event: text, at most `MAX_FILE_BYTES`. */
  readonly files: Map<string, FileEntry>;
  /** Files that ride the blob channel: hashed chunks, up to `MAX_BLOB_FILE_BYTES`. */
  readonly blobs: Map<string, FileEntry>;
}

/** Every file under `root`, keyed by its path relative to it, with "/" separators. */
export async function scanWorkspace(root: string): Promise<ScannedWorkspace> {
  const files = new Map<string, FileEntry>();
  const blobs = new Map<string, FileEntry>();

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = relative(root, full).split(sep).join("/");
      try {
        const stat = await fs.stat(full);
        if (stat.size > MAX_BLOB_FILE_BYTES) continue;
        const buffer = await fs.readFile(full);
        if (stat.size <= MAX_FILE_BYTES && !looksBinary(buffer)) {
          files.set(rel, { path: rel, hash: hashContent(buffer.toString("utf8")), bytes: stat.size });
          continue;
        }
        blobs.set(rel, { path: rel, hash: hashBuffer(buffer), bytes: stat.size });
      } catch {
        // a file that vanished mid-scan is simply not there
      }
    }
  }

  await walk(root);
  return { files, blobs };
}

/** The changes since `previous`, as puts and deletes. */
export function diffWorkspace(
  previous: ReadonlyMap<string, FileEntry>,
  current: ReadonlyMap<string, FileEntry>,
): { puts: FileEntry[]; deletes: string[] } {
  const puts: FileEntry[] = [];
  const deletes: string[] = [];
  for (const [path, entry] of current) {
    const before = previous.get(path);
    if (before === undefined || before.hash !== entry.hash) puts.push(entry);
  }
  for (const path of previous.keys()) if (!current.has(path)) deletes.push(path);
  return { puts, deletes };
}
