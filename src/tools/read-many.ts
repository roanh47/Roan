import { promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";

/** Options for {@link readMany}; all fields are optional. */
export interface ReadManyOptions {
  /** Upper bound on the total number of characters returned (default 40000). */
  maxTotalChars?: number;
}

/** Per-path outcome of a {@link readMany} call. */
export type ReadResult =
  | { path: string; ok: true; text: string }
  | { path: string; ok: false; error: string };

/** Result of a {@link readMany} call. */
export interface ReadManyResult {
  /** One entry per input path, sorted by `path` (byte order). */
  results: ReadResult[];
  /** True when the character budget forced a partial read or skipped files. */
  truncated: boolean;
  /** Characters actually returned, i.e. the sum of all `ok` texts. */
  totalChars: number;
}

const DEFAULT_MAX_TOTAL_CHARS = 40_000;
const BINARY_PROBE_BYTES = 8_000;
const TRUNCATION_MARKER = "\n[truncated]";
const BUDGET_EXHAUSTED = "not read: character budget exhausted";

interface ReadOk {
  kind: "ok";
  text: string;
  /** Characters charged against the budget (excludes the truncation marker). */
  used: number;
  truncated: boolean;
}

interface ReadError {
  kind: "error";
  error: string;
}

/**
 * Plain string comparison, i.e. byte order over the UTF-16 code units.
 * Deliberately not `localeCompare`, so the order does not depend on the host
 * locale; callers can rely on it for stable, machine-independent output.
 */
function compareBytes(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function normalizeBudget(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_MAX_TOTAL_CHARS;
  return Math.max(0, Math.floor(value));
}

/** Slices by code unit, but never splits a surrogate pair. */
function sliceChars(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let end = limit;
  if (end > 0) {
    const code = text.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  }
  return text.slice(0, end);
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Reads one file, capped at `remaining` characters.
 *
 * The first {@link BINARY_PROBE_BYTES} bytes are inspected for a NUL byte; such
 * a file is reported as an error instead of being decoded. The file is read
 * through a handle and at most `remaining * 4 + 4` bytes are decoded, so a huge
 * file never lands in memory in full.
 */
async function readCapped(filePath: string, remaining: number): Promise<ReadOk | ReadError> {
  let handle: FileHandle | undefined;
  try {
    handle = await fs.open(filePath, "r");
    const stat = await handle.stat();
    if (!stat.isFile()) {
      return { kind: "error", error: `not a regular file: ${filePath}` };
    }
    const total = stat.size;
    const probeLength = Math.min(total, BINARY_PROBE_BYTES);
    if (probeLength > 0) {
      const probe = Buffer.alloc(probeLength);
      await handle.read(probe, 0, probeLength, 0);
      if (probe.includes(0)) {
        return { kind: "error", error: `binary file: ${filePath}` };
      }
    }

    const maxBytes = Math.min(total, remaining * 4 + 4);
    let text = "";
    if (maxBytes > 0) {
      const buffer = Buffer.alloc(maxBytes);
      const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
      text = buffer.subarray(0, bytesRead).toString("utf8");
      // A byte cap can cut a multi-byte sequence; drop the resulting partial char.
      if (bytesRead < total) text = text.replace(/\uFFFD+$/u, "");
    }

    if (maxBytes >= total && text.length <= remaining) {
      return { kind: "ok", text, used: text.length, truncated: false };
    }
    const clipped = sliceChars(text, remaining);
    return {
      kind: "ok",
      text: `${clipped}${TRUNCATION_MARKER}`,
      used: clipped.length,
      truncated: true,
    };
  } catch (cause) {
    return { kind: "error", error: errorText(cause) };
  } finally {
    if (handle !== undefined) await handle.close().catch(() => undefined);
  }
}

/**
 * Reads several files under one shared character budget.
 *
 * - Paths are sorted (byte order) before reading, so the budget is always spent
 *   in a deterministic order, and the results are sorted the same way.
 * - A missing or unreadable file yields `{ ok: false, error }`; nothing throws.
 * - A file with a NUL byte in its first 8000 bytes yields `{ ok: false, error }`
 *   naming the path instead of being decoded.
 * - Once the budget is exhausted the remaining files are reported as
 *   "not read: character budget exhausted" and `truncated` becomes true.
 * - A file that only partly fits is cut to the remaining budget, gets a short
 *   "[truncated]" marker appended, and sets `truncated`.
 */
export async function readMany(
  paths: readonly string[],
  options: ReadManyOptions = {},
): Promise<ReadManyResult> {
  const budget = normalizeBudget(options.maxTotalChars);
  const ordered = [...paths].sort(compareBytes);
  const results: ReadResult[] = [];
  let used = 0;
  let exhausted = false;
  let truncated = false;

  for (const filePath of ordered) {
    if (exhausted || budget - used <= 0) {
      exhausted = true;
      truncated = true;
      results.push({ path: filePath, ok: false, error: BUDGET_EXHAUSTED });
      continue;
    }
    const outcome = await readCapped(filePath, budget - used);
    if (outcome.kind === "error") {
      results.push({ path: filePath, ok: false, error: outcome.error });
      continue;
    }
    results.push({ path: filePath, ok: true, text: outcome.text });
    used += outcome.used;
    if (outcome.truncated) {
      truncated = true;
      exhausted = true;
    }
  }

  results.sort((a, b) => compareBytes(a.path, b.path));

  let totalChars = 0;
  for (const result of results) {
    if (result.ok) totalChars += result.text.length;
  }

  return { results, truncated, totalChars };
}
