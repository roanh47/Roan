/**
 * Finding the instruction files other agents leave behind.
 *
 * A workspace may contain Claude Code's `CLAUDE.md`, Cursor's `.cursorrules`,
 * Windsurf's `.windsurfrules`, OpenClaw's persona files, or plain `AGENTS.md`.
 * This module only *finds* them: it stats each candidate and never reads its
 * content. A file above the cap is reported as absent, so a stray multi-megabyte
 * log named `AGENTS.md` cannot be pulled into memory here.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

/** Largest instruction file we are willing to import. */
export const MAX_INSTRUCTION_BYTES = 64 * 1024;

/** The family a file came from; drives the label shown in the import panel. */
export type InstructionKind =
  | "agents"
  | "claude"
  | "cursor"
  | "windsurf"
  | "soul"
  | "identity"
  | "user"
  | "memory"
  | "openclaw";

export interface DiscoveredFile {
  /** Absolute path on this machine. */
  path: string;
  kind: InstructionKind;
  /** Size on disk, never the bytes themselves. */
  bytes: number;
}

/** File names recognised at the top of a candidate directory. */
const TOP_LEVEL_NAMES: Readonly<Record<string, InstructionKind>> = {
  "AGENTS.md": "agents",
  "CLAUDE.md": "claude",
  "CLAUDE.local.md": "claude",
  ".cursorrules": "cursor",
  ".windsurfrules": "windsurf",
  "SOUL.md": "soul",
  "IDENTITY.md": "identity",
  "USER.md": "user",
  "MEMORY.md": "memory",
  "TOOLS.md": "openclaw",
  "BOOTSTRAP.md": "openclaw",
  "HEARTBEAT.md": "openclaw",
};

/** Instruction files that live one directory down. */
const NESTED_NAMES: ReadonlyArray<readonly [string, InstructionKind]> = [
  [path.join(".claude", "CLAUDE.md"), "claude"],
];

export interface DiscoverOptions {
  /** Per-file ceiling. Files larger than this are skipped without being read. */
  maxBytes?: number;
  /** Also look in known nested locations such as `.claude/CLAUDE.md`. Default true. */
  nested?: boolean;
}

/** The kind for a bare file name, or `null` when it is not an instruction file. */
export function kindForInstructionFile(fileName: string): InstructionKind | null {
  const entry = TOP_LEVEL_NAMES[fileName];
  return entry ?? null;
}

function isMissing(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "ENOENT"
  );
}

async function statFile(target: string) {
  try {
    return await fs.lstat(target);
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

async function consider(
  target: string,
  kind: InstructionKind,
  maxBytes: number,
  found: Map<string, DiscoveredFile>,
): Promise<void> {
  if (found.has(target)) return;
  const stat = await statFile(target);
  if (stat === null || stat.isSymbolicLink() || !stat.isFile()) return;
  if (stat.size > maxBytes) return;
  found.set(target, { path: target, kind, bytes: stat.size });
}

async function scanDirectory(
  dir: string,
  options: Required<DiscoverOptions>,
  found: Map<string, DiscoveredFile>,
): Promise<void> {
  for (const [name, kind] of Object.entries(TOP_LEVEL_NAMES)) {
    await consider(path.join(dir, name), kind, options.maxBytes, found);
  }
  if (!options.nested) return;
  for (const [relative, kind] of NESTED_NAMES) {
    await consider(path.join(dir, relative), kind, options.maxBytes, found);
  }
}

/**
 * Find instruction files under each candidate.
 *
 * A candidate may be a directory (its known top-level files are considered) or
 * a single file (accepted only when its name is known). Missing paths, symlinks
 * and oversized files are skipped silently: discovery reports what it can import
 * and nothing else.
 */
export async function discoverInstructionFiles(
  candidates: readonly string[],
  options: DiscoverOptions = {},
): Promise<DiscoveredFile[]> {
  const resolved: Required<DiscoverOptions> = {
    maxBytes: options.maxBytes ?? MAX_INSTRUCTION_BYTES,
    nested: options.nested ?? true,
  };
  const found = new Map<string, DiscoveredFile>();

  for (const candidate of candidates) {
    if (candidate.trim().length === 0) continue;
    const absolute = path.resolve(candidate);
    const stat = await statFile(absolute);
    if (stat === null || stat.isSymbolicLink()) continue;

    if (stat.isDirectory()) {
      await scanDirectory(absolute, resolved, found);
      continue;
    }
    if (!stat.isFile()) continue;

    const kind = kindForInstructionFile(path.basename(absolute));
    if (kind === null) continue;
    await consider(absolute, kind, resolved.maxBytes, found);
  }

  return [...found.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
