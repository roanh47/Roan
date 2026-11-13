import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * The files of the shared workspace, as things that can travel.
 *
 * Only text, only below a size where "send the whole file" stops being sane.
 * Everything else is left alone on the disk it lives on: a 300 MB model should
 * not be an event, and pretending it can be is how sync systems eat disk.
 */
export const MAX_FILE_BYTES = 512 * 1024;

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

/** Every text file under `root`, keyed by its path relative to it, with "/" separators. */
export async function scanWorkspace(root: string): Promise<Map<string, FileEntry>> {
  const out = new Map<string, FileEntry>();

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
        if (stat.size > MAX_FILE_BYTES) continue;
        const buffer = await fs.readFile(full);
        if (looksBinary(buffer)) continue;
        out.set(rel, { path: rel, hash: hashContent(buffer.toString("utf8")), bytes: stat.size });
      } catch {
        // a file that vanished mid-scan is simply not there
      }
    }
  }

  await walk(root);
  return out;
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
