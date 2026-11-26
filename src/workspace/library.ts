import { promises as fs } from "node:fs";
import { join, sep } from "node:path";
import { isInsideWorkspace } from "../tools/policy.js";

/**
 * The workspace as a file library: what is in it, and how to read one file
 * back without ever leaving the folder.
 *
 * Listing is bounded twice — by depth and by count — because a workspace with
 * a `node_modules` in it is not something a panel should try to render. Reading
 * is bounded by bytes: a preview that pulls a 300 MB model into memory is not a
 * preview. Anything over a bound is refused with a sentence a person can read,
 * never silently truncated or silently skipped.
 */

/** Directory levels below the root that `listWorkspace` walks into. */
export const DEFAULT_LIST_DEPTH = 4;
/** Entries `listWorkspace` returns at most; the rest are simply not listed. */
export const MAX_LIST_ENTRIES = 500;
/** Bytes `readWorkspaceFile` reads at most by default. */
export const DEFAULT_READ_BYTES = 512 * 1024;

export type EntryKind = "file" | "dir";

export interface LibraryEntry {
  /** Path relative to the root, with forward slashes. */
  readonly path: string;
  /** Bytes on disk; 0 for a directory. */
  readonly bytes: number;
  readonly kind: EntryKind;
}

export interface ListOptions {
  /** How deep to walk; 1 lists the root's children only. */
  readonly maxDepth?: number;
  /** Stop after this many entries. */
  readonly maxEntries?: number;
}

export interface WorkspaceFile {
  /** Path relative to the root, with forward slashes. */
  readonly path: string;
  readonly bytes: Buffer;
  readonly mime: string;
}

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  txt: "text/plain",
  log: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
  jsonl: "application/x-ndjson",
  js: "text/javascript",
  mjs: "text/javascript",
  cjs: "text/javascript",
  ts: "text/plain",
  tsx: "text/plain",
  jsx: "text/plain",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  xml: "application/xml",
  svg: "image/svg+xml",
  yml: "text/yaml",
  yaml: "text/yaml",
  toml: "text/plain",
  ini: "text/plain",
  sql: "text/plain",
  sh: "text/x-shellscript",
  py: "text/x-python",
  rs: "text/plain",
  go: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  zip: "application/zip",
  gz: "application/gzip",
  wasm: "application/wasm",
};

/** The type a preview and a download link should claim for `path`. */
export function mimeFor(path: string): string {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "application/octet-stream";
  const extension = name.slice(dot + 1).toLowerCase();
  return MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
}

/** True for the types a text preview can show as-is. */
export function isTextMime(mime: string): boolean {
  return mime.startsWith("text/") || mime === "application/json" || mime === "application/x-ndjson" || mime === "application/xml";
}

/** Ordering is by path, byte-wise: the same list on every machine and locale. */
function byPath(a: LibraryEntry, b: LibraryEntry): number {
  if (a.path < b.path) return -1;
  if (a.path > b.path) return 1;
  return 0;
}

function depthOf(relativePath: string): number {
  return relativePath.split("/").length;
}

/**
 * Every file and directory under `root`, sorted by path.
 *
 * Dotfiles and dot-directories are invisible: they are where `.git`, editor
 * state and credentials live, and a library that lists them invites reading
 * them. Symbolic links are not followed, at any depth — following one is how a
 * listing turns into a tour of the whole disk.
 */
export async function listWorkspace(root: string, options: ListOptions = {}): Promise<LibraryEntry[]> {
  const maxDepth = options.maxDepth ?? DEFAULT_LIST_DEPTH;
  const maxEntries = options.maxEntries ?? MAX_LIST_ENTRIES;
  if (!Number.isInteger(maxDepth) || maxDepth < 1) throw new Error("listWorkspace: maxDepth must be at least 1");
  if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new Error("listWorkspace: maxEntries must be at least 1");

  const entries: LibraryEntry[] = [];

  async function walk(dir: string, relative: string): Promise<void> {
    let children;
    try {
      children = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      // Unreadable or vanished between listing and walking: not there.
      return;
    }
    for (const child of children) {
      if (entries.length >= maxEntries) return;
      if (child.name.startsWith(".")) continue;
      if (child.isSymbolicLink()) continue;
      const childRelative = relative.length === 0 ? child.name : `${relative}/${child.name}`;
      if (depthOf(childRelative) > maxDepth) continue;
      const kind: EntryKind = child.isDirectory() ? "dir" : "file";
      if (!child.isDirectory() && !child.isFile()) continue;
      const full = join(dir, child.name);
      let bytes = 0;
      if (kind === "file") {
        try {
          bytes = (await fs.stat(full)).size;
        } catch {
          continue;
        }
      }
      entries.push({ path: childRelative, bytes, kind });
      if (kind === "dir") await walk(full, childRelative);
    }
  }

  await walk(root, "");
  return entries.sort(byPath);
}

/** The path as the library spells it: relative, forward slashes, no leading `/`. */
function normaliseRequestedPath(path: string): string {
  return path.split(sep).join("/");
}

/**
 * One file's bytes and type, or a refusal.
 *
 * The guard is the tools' own: `isInsideWorkspace` resolves symlinks for the
 * part that exists, so a link pointing out of the folder is refused exactly
 * like `../` is, and `..` can never walk out. A file over `maxBytes` is refused
 * with its real size, because the caller cannot act on a silent truncation.
 */
export async function readWorkspaceFile(
  root: string,
  path: string,
  maxBytes: number = DEFAULT_READ_BYTES,
): Promise<WorkspaceFile> {
  if (typeof path !== "string" || path.trim().length === 0) {
    throw new Error("readWorkspaceFile: no path given");
  }
  if (!Number.isInteger(maxBytes) || maxBytes < 1) {
    throw new Error("readWorkspaceFile: maxBytes must be at least 1");
  }
  const relative = normaliseRequestedPath(path);
  if (!isInsideWorkspace(root, relative)) {
    throw new Error(`readWorkspaceFile: path "${path}" escapes the workspace`);
  }
  if (relative.split("/").some((segment) => segment.startsWith("."))) {
    throw new Error(`readWorkspaceFile: "${path}" is a dotfile; the library does not serve those`);
  }
  const full = join(root, relative);
  let stat;
  try {
    stat = await fs.stat(full);
  } catch {
    throw new Error(`readWorkspaceFile: "${relative}" does not exist`);
  }
  if (stat.isDirectory()) {
    throw new Error(`readWorkspaceFile: "${relative}" is a directory`);
  }
  if (stat.size > maxBytes) {
    throw new Error(
      `readWorkspaceFile: "${relative}" is ${String(stat.size)} bytes, over the ${String(maxBytes)} byte preview cap`,
    );
  }
  const bytes = await fs.readFile(full);
  if (bytes.length > maxBytes) {
    throw new Error(
      `readWorkspaceFile: "${relative}" grew to ${String(bytes.length)} bytes, over the ${String(maxBytes)} byte preview cap`,
    );
  }
  return { path: relative, bytes, mime: mimeFor(relative) };
}

/** Bytes as a short label: `12 B`, `3 kB`, `1.2 MB`. */
export function bytesLabel(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
