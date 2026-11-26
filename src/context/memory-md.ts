/**
 * MEMORY.md, folded from `memory` events.
 *
 * The chain is the only copy that matters: every device that holds the chain can
 * rebuild MEMORY.md from it, and no device has to be told separately. The fold is
 * pure — events in, markdown out — so the same chain always produces byte-for-byte
 * the same file, whatever order the store handed the events over in.
 *
 * Two folds, one rule set:
 *
 *   foldFacts    normalised fact → newest text, oldest fact first
 *   foldMemoryMd the same, rendered as bullets
 *
 * "Newest wins" is per fact, not over the file: a fact restated later replaces
 * its text but keeps the position of its newest restatement, so touching one
 * fact does not reshuffle the file.
 *
 * Bullets are separated by a blank line. MEMORY.md is also edited by the memory
 * tool, which reads entries as blank-line separated blocks (`MemoryStore`), so
 * one bullet per block keeps hand edits and folded facts speaking one format.
 */

import { chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import type { Event } from "../protocol/types.js";
import { foldFacts } from "../memory/distil.js";

/** The file, inside the home, that both the fold and the memory tool write. */
export const MEMORY_FILE = "MEMORY.md";

/** Fold `events` to the markdown of MEMORY.md; `""` when nothing is remembered. */
export function foldMemoryMd(events: readonly Event[]): string {
  const facts = foldFacts(events);
  if (facts.length === 0) return "";
  return `${facts.map((fact) => `- ${fact.text}`).join("\n\n")}\n`;
}

function tempPathFor(file: string): string {
  return `${file}.${String(process.pid)}.${randomBytes(6).toString("hex")}.tmp`;
}

/** Write `contents` to `file` in one rename, so a reader never sees half a file. */
async function writeAtomically(file: string, contents: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });

  const temp = tempPathFor(file);
  let renamed = false;
  try {
    const handle = await open(temp, "wx", 0o600);
    try {
      await handle.writeFile(contents, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, file);
    renamed = true;
  } finally {
    // A failed write must not leave a .tmp behind for the next fold to trip on.
    if (!renamed) await unlink(temp).catch(() => undefined);
  }

  await chmod(file, 0o600);
}

/**
 * Write MEMORY.md into `home`.
 *
 * The file is left untouched — same bytes, same inode — when `content` is what it
 * already says, and when neither file nor content exists. Writes go through a
 * temp file plus rename: a crash leaves the old file whole, never a truncated one.
 * Returns whether anything was written.
 */
export async function writeMemoryMd(home: string, content: string): Promise<boolean> {
  if (home.trim().length === 0) {
    throw new Error("cannot write MEMORY.md: the home directory is empty");
  }

  const file = path.join(home, MEMORY_FILE);
  let current: string | null = null;
  try {
    current = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  if (current === content) return false;
  // Nothing remembered and nothing remembered yet: there is no file to write.
  if (current === null && content.length === 0) return false;

  await writeAtomically(file, content);
  return true;
}
