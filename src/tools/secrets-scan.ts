import { promises as fs } from "node:fs";
import path from "node:path";

/** One suspected secret, with a redacted preview instead of the value. */
export interface SecretFinding {
  /** Path relative to `root`, with forward slashes. */
  file: string;
  /** 1-based line number. */
  line: number;
  /** 1-based column of the secret within the line. */
  column: number;
  /** Kind of hit, for example `openai-key` or `assigned-credential`. */
  kind: string;
  /** Matched text with the middle left out; never the complete secret. */
  preview: string;
}

export interface SecretsScanOptions {
  /** Maximum number of files actually read (default 2000). */
  maxFiles?: number;
  /** Maximum number of hits (default 500). */
  maxFindings?: number;
  /** Aborts the scan early; the result is then incomplete. */
  signal?: AbortSignal;
}

export interface SecretsScanResult {
  findings: SecretFinding[];
  /** Number of files read as text. */
  scanned: number;
  /** Number of files skipped: binary, too large or unreadable. */
  skipped: number;
  /** True when not everything was inspected: due to a limit or an abort. */
  truncated: boolean;
}

/** Directories we never enter: never the user's and too large. */
const SKIP_DIRS: ReadonlySet<string> = new Set(["node_modules", ".git", "dist", "build"]);

/** How many bytes we read to determine whether a file is binary. */
const SNIFF_BYTES = 8192;

/** Files above this size are skipped: too expensive and rarely interesting. */
const MAX_FILE_BYTES = 1024 * 1024;

const DEFAULT_MAX_FILES = 2000;
const DEFAULT_MAX_FINDINGS = 500;

/** Upper bound for the preview; well above what `redact` ever returns. */
const MAX_PREVIEW = 120;

interface Rule {
  kind: string;
  source: string;
  flags?: string;
  /** Capture group with the actual secret text; 0 means the whole match. */
  secretGroup?: number;
  /** Extra filter: values that are not a secret (placeholders) are dropped. */
  filter?: (value: string) => boolean;
}

interface CompiledRule {
  kind: string;
  re: RegExp;
  secretGroup: number;
  filter?: (value: string) => boolean;
}

/**
 * Values that look like a placeholder and are therefore not a secret.
 * Deliberately narrow: better one hit too many than missing a real secret.
 */
const PLACEHOLDER: RegExp =
  /^(?:\$\{|<|%\{|\{\{|change(?:me|_me)?|placeholder|example|your(?:[_-].*)?|todo|none|null|true|false|x{3,}|\*+)$/i;

function isPlaceholder(value: string): boolean {
  const text = value.trim();
  if (text.length < 4) return true;
  if (text.includes("{") && text.includes("}")) return true;
  return PLACEHOLDER.test(text);
}

/**
 * Detection rules, evaluated in this order. `sk-ant-` comes before `sk-`
 * so that an Anthropic key is not reported as an OpenAI key.
 */
const RULES: readonly Rule[] = [
  { kind: "anthropic-key", source: "\\bsk-ant-[A-Za-z0-9_-]{16,}" },
  { kind: "openai-key", source: "\\bsk-[A-Za-z0-9_-]{16,}" },
  { kind: "github-token", source: "\\bgh[pousr]_[A-Za-z0-9]{20,}" },
  { kind: "slack-token", source: "\\bxox[baprs]-[A-Za-z0-9-]{10,}" },
  { kind: "google-api-key", source: "\\bAIza[0-9A-Za-z_-]{20,}" },
  { kind: "aws-access-key-id", source: "\\bAKIA[0-9A-Z]{16}\\b" },
  {
    kind: "bearer-token",
    source: "\\bauthorization\\s*[:=]\\s*[\"']?bearer\\s+([A-Za-z0-9._~+/=-]{10,})",
    flags: "i",
    secretGroup: 1,
  },
  {
    kind: "private-key",
    source: "-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----",
    flags: "i",
  },
  {
    // .env lines, YAML and TOML: key name containing a secret-like word,
    // followed by `=` or `:` and a value without whitespace or comment.
    kind: "assigned-credential",
    source:
      "^\\s*(?:export\\s+)?[\"']?[A-Za-z0-9_.-]*(?:api[_-]?key|secret|token|password|passwd|client[_-]?secret)[A-Za-z0-9_.-]*[\"']?\\s*[:=]\\s*[\"']?([^\"'\\s#]{4,})",
    flags: "i",
    secretGroup: 1,
    filter: (value: string): boolean => !isPlaceholder(value),
  },
];

/**
 * Compile the rules once per scan. A broken pattern is a programming
 * error and must fail loudly, including the source of the pattern.
 */
function compileRules(): CompiledRule[] {
  return RULES.map((rule) => {
    try {
      const compiled: CompiledRule = {
        kind: rule.kind,
        re: new RegExp(rule.source, `g${rule.flags ?? ""}`),
        secretGroup: rule.secretGroup ?? 0,
      };
      if (rule.filter !== undefined) compiled.filter = rule.filter;
      return compiled;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`secrets-scan: invalid regex pattern "${rule.source}": ${detail}`);
    }
  });
}

/**
 * Redact a found value: the first four and last four characters stay,
 * the rest becomes `…`. Short values (<= 12 characters) are hidden entirely,
 * because otherwise the preview would still contain the whole secret.
 */
function redact(value: string): string {
  const text = value.trim();
  if (text.length <= 12) return "…";
  const preview = `${text.slice(0, 4)}…${text.slice(-4)}`;
  return preview.length > MAX_PREVIEW ? `${preview.slice(0, MAX_PREVIEW - 1)}…` : preview;
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  const floored = Math.floor(value);
  return floored < 0 ? 0 : floored;
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

interface Counters {
  skipped: number;
}

/**
 * Collect all regular files under `dir`, deterministically sorted.
 * Unreadable directories count as skipped and do not raise an error.
 */
async function collectFiles(dir: string, signal: AbortSignal | undefined, counters: Counters): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    counters.skipped += 1;
    return [];
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));

  const found: string[] = [];
  for (const entry of entries) {
    if (signal?.aborted === true) break;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      found.push(...(await collectFiles(path.join(dir, entry.name), signal, counters)));
      continue;
    }
    // Symbolic links are dropped: they can cause loops.
    if (entry.isFile()) found.push(path.join(dir, entry.name));
  }
  return found;
}

/**
 * Read a file as text. Returns `null` for binary files, files above the
 * size limit and anything that is not readable.
 */
async function readTextFile(absPath: string): Promise<string | null> {
  let handle: fs.FileHandle | undefined;
  try {
    const info = await fs.stat(absPath);
    if (!info.isFile() || info.size > MAX_FILE_BYTES) return null;

    handle = await fs.open(absPath, "r");
    const sniffSize = Math.min(SNIFF_BYTES, info.size);
    const head = Buffer.alloc(sniffSize);
    const { bytesRead } = await handle.read(head, 0, sniffSize, 0);
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

/** Position of the secret text within the whole match, for the column. */
function groupOffset(match: RegExpExecArray, value: string): number {
  if (value === match[0]) return 0;
  const at = match[0].indexOf(value);
  return at < 0 ? 0 : at;
}

function toRelative(root: string, absPath: string): string {
  return path.relative(root, absPath).split(path.sep).join("/");
}

/**
 * Scan a directory for suspected secrets. Unreadable, binary and oversized
 * files are counted as `skipped` and never make the scan crash.
 * Only an unusable `root` or a broken regex pattern throws an `Error`.
 */
export async function scanForSecrets(
  root: string,
  options: SecretsScanOptions = {},
): Promise<SecretsScanResult> {
  const rules = compileRules();
  const maxFiles = normalizeLimit(options.maxFiles, DEFAULT_MAX_FILES);
  const maxFindings = normalizeLimit(options.maxFindings, DEFAULT_MAX_FINDINGS);
  const signal = options.signal;
  const findings: SecretFinding[] = [];
  let scanned = 0;
  let truncated = false;

  const absoluteRoot = path.resolve(root);
  try {
    const info = await fs.stat(absoluteRoot);
    if (!info.isDirectory()) throw new Error("not a directory");
  } catch (err) {
    throw new Error(`secrets-scan: cannot scan directory "${root}": ${toErrorMessage(err)}`);
  }

  const counters: Counters = { skipped: 0 };
  const files = await collectFiles(absoluteRoot, signal, counters);
  let stopped = false;

  for (const absPath of files) {
    if (signal?.aborted === true) {
      truncated = true;
      break;
    }
    if (scanned >= maxFiles) {
      truncated = true;
      break;
    }

    const content = await readTextFile(absPath);
    if (content === null) {
      counters.skipped += 1;
      continue;
    }
    scanned += 1;

    const file = toRelative(absoluteRoot, absPath);
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      if (line === "") continue;
      for (const rule of rules) {
        for (const match of line.matchAll(rule.re)) {
          const value = rule.secretGroup === 0 ? match[0] : match[1] ?? "";
          if (value === "") continue;
          if (rule.filter !== undefined && !rule.filter(value)) continue;
          if (findings.length >= maxFindings) {
            truncated = true;
            stopped = true;
            break;
          }
          const start = (match.index ?? 0) + groupOffset(match, value);
          findings.push({
            file,
            line: index + 1,
            column: start + 1,
            kind: rule.kind,
            preview: redact(value),
          });
        }
        if (stopped) break;
      }
      if (stopped) break;
    }
    if (stopped) break;
  }

  return {
    findings,
    scanned,
    skipped: counters.skipped,
    truncated,
  };
}
