import { promises as fs } from "node:fs";
import path from "node:path";

export interface GrepMatch {
  file: string;
  line: number;
  text: string;
}

export interface GrepOptions {
  maxResults?: number;
  ignoreCase?: boolean;
  literal?: boolean;
  include?: string;
}

export interface GrepResult {
  matches: GrepMatch[];
  truncated: boolean;
  error?: string;
}

const DEFAULT_MAX_RESULTS = 200;
/** Hoeveel bytes we inlezen om te bepalen of een bestand binair is. */
const SNIFF_BYTES = 8192;
const SKIP_DIRS = new Set(["node_modules", ".git"]);

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Lees een bestand als tekst; geef null terug als het binair lijkt of onleesbaar is. */
async function readTextFile(absPath: string): Promise<string | null> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(absPath, "r");
    const head = Buffer.alloc(SNIFF_BYTES);
    const { bytesRead } = await handle.read(head, 0, SNIFF_BYTES, 0);
    if (head.subarray(0, bytesRead).includes(0)) return null;
    const buf = await handle.readFile();
    return buf.toString("utf8");
  } catch {
    return null;
  } finally {
    if (handle !== undefined) {
      await handle.close().catch(() => undefined);
    }
  }
}

/** Verzamel alle tekstkandidaat-bestanden onder een map, deterministisch gesorteerd. */
async function collectFiles(root: string): Promise<string[]> {
  const found: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(abs);
      } else if (entry.isFile()) {
        // Symbolische koppelingen slaan we over: die kunnen lussen veroorzaken.
        found.push(abs);
      }
    }
  }

  await walk(root);
  return found;
}

function matchesInclude(file: string, include: string | undefined): boolean {
  if (include === undefined || include === "") return true;
  const wanted = include.startsWith(".") ? include.toLowerCase() : `.${include.toLowerCase()}`;
  return file.toLowerCase().endsWith(wanted);
}

function buildRegExp(pattern: string, options: GrepOptions): RegExp {
  const source = options.literal === true ? pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : pattern;
  return new RegExp(source, options.ignoreCase === true ? "i" : "");
}

function normalizeMaxResults(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_MAX_RESULTS;
  const floored = Math.floor(value);
  return floored < 1 ? 1 : floored;
}

/**
 * Zoek naar een patroon in tekstbestanden. Gooit nooit: fouten komen terug in `error`.
 */
export async function grep(
  pattern: string,
  targetPath: string,
  options: GrepOptions = {},
): Promise<GrepResult> {
  let re: RegExp;
  try {
    re = buildRegExp(pattern, options);
  } catch (err) {
    return { matches: [], truncated: false, error: toErrorMessage(err) };
  }

  const maxResults = normalizeMaxResults(options.maxResults);

  let stats;
  try {
    stats = await fs.stat(targetPath);
  } catch {
    return {
      matches: [],
      truncated: false,
      error: `pad bestaat niet of is niet leesbaar: ${targetPath}`,
    };
  }

  const isDirectory = stats.isDirectory();
  const files = isDirectory ? await collectFiles(targetPath) : [targetPath];

  const matches: GrepMatch[] = [];
  for (const abs of files) {
    if (!matchesInclude(abs, options.include)) continue;

    const content = await readTextFile(abs);
    if (content === null) continue;

    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const text = lines[i] ?? "";
      if (!re.test(text)) continue;
      if (matches.length >= maxResults) {
        return { matches, truncated: true };
      }
      const file = isDirectory
        ? path.relative(targetPath, abs).split(path.sep).join("/")
        : path.basename(abs);
      matches.push({ file, line: i + 1, text });
    }
  }

  return { matches, truncated: false };
}
