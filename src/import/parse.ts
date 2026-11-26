/**
 * Turning found instruction files into env entries.
 *
 * Everything imported lands under one stable prefix (`imported/`), so an import
 * never writes into `SOUL.md` or `AGENTS.md` itself. Names are derived from the
 * source file name and made unique within the batch deterministically, which is
 * what lets `planImport` compare them against what the env already holds.
 */

import { isUtf8 } from "node:buffer";
import { promises as fs } from "node:fs";
import path from "node:path";
import { sha256Hex } from "../env/pack.js";
import type { EnvEntry } from "../env/types.js";
import { MAX_INSTRUCTION_BYTES, type DiscoveredFile } from "./discover.js";

/** Where imported instructions live inside the agent home. */
export const IMPORT_PREFIX = "imported";

export interface ParseOptions {
  /** Env-relative directory the files land in. Default `imported`. */
  prefix?: string;
  /** Per-file ceiling; a file that grew past it is skipped. */
  maxBytes?: number;
}

/**
 * Validate a relative POSIX path that will become an env entry name. Rejects
 * absolute paths, backslashes, NUL bytes and any `.`/`..` segment, so a crafted
 * file name can never steer the import outside its prefix.
 */
export function assertSafeImportPath(raw: string): string {
  if (raw.length === 0) throw new Error("import target is empty");
  if (raw.includes("\\")) throw new Error(`import target must use '/' separators: ${raw}`);
  if (raw.includes("\0")) throw new Error("import target contains a NUL byte");
  if (raw.startsWith("/") || /^[A-Za-z]:/.test(raw)) {
    throw new Error(`import target must be relative: ${raw}`);
  }
  const segments = raw.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new Error(`import target has an empty or traversing segment: ${raw}`);
    }
  }
  return segments.join("/");
}

function assertPlainFileName(fileName: string): string {
  if (fileName.length === 0) throw new Error("import source has no file name");
  if (fileName.includes("/")) throw new Error(`import source name contains '/': ${fileName}`);
  if (fileName.includes("\\")) throw new Error(`import source name contains '\\': ${fileName}`);
  if (fileName.includes("\0")) throw new Error("import source name contains a NUL byte");
  if (fileName === "." || fileName === "..") {
    throw new Error(`import source name is not a file: ${fileName}`);
  }
  return fileName;
}

function withSuffix(fileName: string, n: number): string {
  const dot = fileName.lastIndexOf(".");
  if (dot > 0) return `${fileName.slice(0, dot)}-${n}${fileName.slice(dot)}`;
  return `${fileName}-${n}`;
}

/**
 * The env-relative name for one source file, e.g. `imported/CLAUDE.md`.
 *
 * When the name is already taken (by a previous file in this batch or by a name
 * the caller passed in), a numeric suffix is added: `imported/CLAUDE-2.md`.
 * The result depends only on the input order and the taken set, never on time
 * or randomness.
 */
export function importTargetName(
  fileName: string,
  taken: ReadonlySet<string> = new Set<string>(),
  prefix: string = IMPORT_PREFIX,
): string {
  const safePrefix = assertSafeImportPath(prefix);
  const safeName = assertPlainFileName(fileName);
  const first = `${safePrefix}/${safeName}`;
  if (!taken.has(first)) return first;
  for (let n = 2; n < 10_000; n += 1) {
    const candidate = `${safePrefix}/${withSuffix(safeName, n)}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`could not find a free import name for ${fileName}`);
}

function isMissing(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "ENOENT"
  );
}

/**
 * Read the discovered files and return env entries, sorted by target path.
 *
 * Empty and whitespace-only files are skipped: importing them would create a
 * confusing empty persona file. Non-UTF-8 content is skipped too, because an
 * instruction file is text by definition.
 */
export async function toSnapshotEntries(
  files: readonly DiscoveredFile[],
  options: ParseOptions = {},
): Promise<EnvEntry[]> {
  const prefix = options.prefix ?? IMPORT_PREFIX;
  assertSafeImportPath(prefix);
  const maxBytes = options.maxBytes ?? MAX_INSTRUCTION_BYTES;

  const taken = new Set<string>();
  const entries: EnvEntry[] = [];

  const ordered = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const file of ordered) {
    const absolute = path.resolve(file.path);
    if (file.bytes > maxBytes) continue;

    let stat;
    try {
      stat = await fs.lstat(absolute);
    } catch (err) {
      if (isMissing(err)) continue;
      throw err;
    }
    if (stat.isSymbolicLink() || !stat.isFile()) continue;
    if (stat.size > maxBytes) continue;

    const target = importTargetName(path.basename(absolute), taken, prefix);
    const bytes = await fs.readFile(absolute);
    if (bytes.byteLength > maxBytes) continue;
    if (!isUtf8(bytes)) continue;

    const content = bytes.toString("utf8");
    if (content.trim().length === 0) continue;

    taken.add(target);
    entries.push({
      path: target,
      kind: "file",
      sha256: sha256Hex(bytes),
      size: bytes.byteLength,
      encoding: "utf8",
      content,
    });
  }

  return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
