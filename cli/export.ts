/**
 * Getting an export file from the daemon's export folder to where the caller
 * asked for it.
 *
 * The `export` request writes inside the daemon's home and answers with that
 * path; `--out` is the CLI's own promise about where the copy lands. The
 * daemon's file is left in place: it is the app's export folder, and a CLI run
 * must not empty it behind the app's back.
 */

import { copyFile, cp, mkdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

/** Expands a leading `~` so a quoted `--out "~/chain.jsonl"` still lands in the home. */
export function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/") || path.startsWith("~\\")) return join(homedir(), path.slice(2));
  return path;
}

async function statOrNull(path: string) {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

/**
 * Copies `source` (a chain jsonl file, a session markdown file, or a session
 * folder with attachments) to `out` and resolves with the path actually
 * written.
 *
 * - A file lands at `out`, unless `out` is an existing directory, in which case
 *   it keeps the daemon's file name inside it.
 * - A directory lands at `out` and merges into it when it already exists.
 * - Missing parent directories are created; the daemon's own file is untouched.
 */
export async function copyExport(source: string, out: string): Promise<string> {
  const info = await statOrNull(source);
  if (info === null) {
    throw new Error(`the daemon said it exported to ${source}, but nothing is there`);
  }
  const target = resolve(expandHome(out));

  if (info.isDirectory()) {
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target, { recursive: true });
    return target;
  }

  const existing = await statOrNull(target);
  const destination = existing !== null && existing.isDirectory() ? join(target, basename(source)) : target;
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
  return destination;
}
