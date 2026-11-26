/**
 * Reading `git status` and `git diff --numstat` into something a panel can draw.
 *
 * The parsers are pure: text in, structure out, no clock and no I/O beyond the
 * injected runner in the two `read*` helpers. That keeps the awkward parts —
 * renames carrying a second NUL field, a file that is both staged and modified
 * again, a binary diff with no line counts — pinned by fixtures instead of by
 * whatever the working tree happened to look like.
 *
 * Anything the orchestrator runs must be `--porcelain=v1 -z`; the NUL form is
 * the only one where a path with a newline or a quote survives unchanged.
 * A newline-separated fixture is also accepted so tests read as prose.
 */

/** One changed path, as `git status` reported it. */
export interface ChangedFile {
  /** The path git reports: the new name for a rename. */
  readonly path: string;
  /** The old name, only on a rename or copy. */
  readonly originalPath?: string;
  /** The two-letter porcelain code, e.g. `"MM"`, `"??"`, `"R "`. */
  readonly code: string;
  /** Something is staged for this path (index differs from HEAD). */
  readonly staged: boolean;
  /** Something is changed in the working tree (index differs from the tree). */
  readonly unstaged: boolean;
  /** The path is new and untracked. */
  readonly untracked: boolean;
  /** Line counts, once a diffstat has been attached with `applyDiffStats`. */
  readonly stat?: FileStat;
}

/** Per-file line counts from `git diff --numstat`. */
export interface FileStat {
  readonly added: number;
  readonly removed: number;
  /** A binary file has no line counts; `added` and `removed` are 0. */
  readonly binary: boolean;
}

/** A changed path plus its counts, as one `--numstat` record. */
export interface DiffStatEntry extends FileStat {
  readonly path: string;
}

/** The working tree, split the way a person stages things. */
export interface RepoStatus {
  /** Every changed path, in the order git printed it. Ignored files excluded. */
  readonly files: readonly ChangedFile[];
  /** Files with something in the index. A `MM` file is here and in `unstaged`. */
  readonly staged: readonly ChangedFile[];
  /** Files with something in the working tree. */
  readonly unstaged: readonly ChangedFile[];
  /** Files git does not track yet. */
  readonly untracked: readonly ChangedFile[];
  /** Ignored files, when the caller asked git to report them. */
  readonly ignored: readonly ChangedFile[];
}

const STATUS_CODES = /^[ MADRCUT?!]{2}$/;

function isNulSeparated(output: string): boolean {
  return output.includes("\u0000");
}

/**
 * Parse `git status --porcelain=v1 -z` into buckets.
 *
 * A record is `XY path`, split off at the fourth character. Rename and copy
 * records carry the source path in the following NUL field, so the loop steps
 * over it instead of mistaking it for a new record. A path may appear in both
 * `staged` and `unstaged` — that is what `MM` means, and collapsing it would
 * hide half the work.
 */
export function parseStatus(output: string): RepoStatus {
  const files: ChangedFile[] = [];
  const staged: ChangedFile[] = [];
  const unstaged: ChangedFile[] = [];
  const untracked: ChangedFile[] = [];
  const ignored: ChangedFile[] = [];

  const nul = isNulSeparated(output);
  const fields = nul ? output.split("\u0000") : output.split(/\r?\n/);

  for (let i = 0; i < fields.length; i += 1) {
    const raw = fields[i];
    if (raw === undefined || raw.length === 0) continue;
    // `## branch…` headers only appear when --branch was passed; skip them.
    if (raw.startsWith("## ")) continue;
    if (raw.length < 4) continue;

    const code = raw.slice(0, 2);
    if (!STATUS_CODES.test(code) || raw[2] !== " ") continue;

    let filePath = raw.slice(3);
    let originalPath: string | undefined;
    // Porcelain v1 reports renames and copies in the index column only.
    const rename = code[0] === "R" || code[0] === "C";

    if (rename) {
      if (nul) {
        const source = fields[i + 1];
        if (source !== undefined && source.length > 0) {
          originalPath = source;
          i += 1;
        }
      } else {
        // Non-NUL porcelain writes `old -> new`; the new name is the path.
        const arrow = filePath.lastIndexOf(" -> ");
        if (arrow !== -1) {
          originalPath = filePath.slice(0, arrow);
          filePath = filePath.slice(arrow + 4);
        }
      }
    }

    const entry: ChangedFile = {
      path: filePath,
      ...(originalPath === undefined ? {} : { originalPath }),
      code,
      staged: code[0] !== " " && code[0] !== "?" && code[0] !== "!",
      unstaged: code[1] !== " " && code[1] !== "?" && code[1] !== "!",
      untracked: code === "??",
    };

    if (code === "!!") {
      ignored.push(entry);
      continue;
    }
    files.push(entry);
    if (entry.staged) staged.push(entry);
    if (entry.unstaged) unstaged.push(entry);
    if (entry.untracked) untracked.push(entry);
  }

  return { files, staged, unstaged, untracked, ignored };
}

/** One line for a panel header: `"2 staged, 1 unstaged, 3 untracked"`. */
export function summarise(status: RepoStatus): string {
  const parts: string[] = [];
  if (status.staged.length > 0) parts.push(`${String(status.staged.length)} staged`);
  if (status.unstaged.length > 0) parts.push(`${String(status.unstaged.length)} unstaged`);
  if (status.untracked.length > 0) parts.push(`${String(status.untracked.length)} untracked`);
  return parts.length === 0 ? "No changes" : parts.join(", ");
}

/** True when there is something to commit. */
export function hasStagedChanges(status: RepoStatus): boolean {
  return status.staged.length > 0;
}

/**
 * Why Commit is not allowed yet, or null when it is.
 *
 * One function for the rule, so the panel's disabled button and any shortcut
 * cannot disagree about an empty message or an empty index.
 */
export function commitBlocker(status: RepoStatus, message: string): string | null {
  if (message.trim().length === 0) return "Write a commit message first.";
  if (!hasStagedChanges(status)) return "Nothing staged yet.";
  return null;
}

/**
 * The new path of a `--numstat` record, where a rename is written either
 * `old => new` or, when a directory moved, `dir/{old => new}/file.ts`.
 */
function statPath(raw: string): string {
  const braced = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(raw);
  if (braced !== null) {
    return `${braced[1] ?? ""}${braced[3] ?? ""}${braced[4] ?? ""}`;
  }
  const arrow = raw.lastIndexOf(" => ");
  if (arrow !== -1) return raw.slice(arrow + 4);
  return raw;
}

/**
 * Parse `git diff --numstat` (`added<TAB>removed<TAB>path`) into per-file counts.
 *
 * A binary file prints `-` for both counts and is kept with 0/0 plus
 * `binary: true`, so the panel can say "binary" instead of "+0 -0". Lines that
 * do not have three tab-separated fields are skipped: git's own output always
 * does, and a malformed line is not a reason to lose the rest of the diff.
 */
export function parseDiffStat(text: string): DiffStatEntry[] {
  const entries: DiffStatEntry[] = [];

  for (const line of text.split(/\r?\n/)) {
    if (line.length === 0) continue;
    const first = line.indexOf("\t");
    const second = first === -1 ? -1 : line.indexOf("\t", first + 1);
    if (first <= 0 || second === -1) continue;

    const addedRaw = line.slice(0, first);
    const removedRaw = line.slice(first + 1, second);
    const pathRaw = line.slice(second + 1);
    if (pathRaw.length === 0) continue;

    const binary = addedRaw === "-" && removedRaw === "-";
    const added = binary ? 0 : Number.parseInt(addedRaw, 10);
    const removed = binary ? 0 : Number.parseInt(removedRaw, 10);
    if (!Number.isSafeInteger(added) || !Number.isSafeInteger(removed)) continue;

    entries.push({ path: statPath(pathRaw), added, removed, binary });
  }

  return entries;
}

/** Merge stat lists, summing counts for the same path (staged plus unstaged). */
export function mergeDiffStats(...lists: ReadonlyArray<readonly DiffStatEntry[]>): DiffStatEntry[] {
  const merged = new Map<string, DiffStatEntry>();
  for (const list of lists) {
    for (const entry of list) {
      const existing = merged.get(entry.path);
      if (existing === undefined) {
        merged.set(entry.path, entry);
        continue;
      }
      merged.set(entry.path, {
        path: entry.path,
        added: existing.added + entry.added,
        removed: existing.removed + entry.removed,
        binary: existing.binary || entry.binary,
      });
    }
  }
  return [...merged.values()];
}

/**
 * Copy `status` with line counts attached where a path matches.
 *
 * Matching falls back to the rename source, because `--numstat` may report the
 * old path or the new one depending on which diff produced it.
 */
export function applyDiffStats(status: RepoStatus, stats: readonly DiffStatEntry[]): RepoStatus {
  if (stats.length === 0) return status;
  const byPath = new Map<string, FileStat>();
  for (const entry of stats) {
    byPath.set(entry.path, { added: entry.added, removed: entry.removed, binary: entry.binary });
  }

  const decorate = (file: ChangedFile): ChangedFile => {
    const stat = byPath.get(file.path) ?? (file.originalPath === undefined ? undefined : byPath.get(file.originalPath));
    return stat === undefined ? file : { ...file, stat };
  };

  return {
    files: status.files.map(decorate),
    staged: status.staged.map(decorate),
    unstaged: status.unstaged.map(decorate),
    untracked: status.untracked.map(decorate),
    ignored: status.ignored,
  };
}

/** An argv list handed to the injected runner; never built from user text. */
export type CommandRunner = (argv: readonly string[]) => Promise<string>;

/** `git status` in the only format this module parses. */
export const STATUS_ARGV: readonly string[] = ["status", "--porcelain=v1", "-z"];

/** `git diff --numstat`, against the index or (`staged`) against HEAD. */
export function diffStatArgv(staged = false): readonly string[] {
  return staged ? ["diff", "--numstat", "--cached", "--"] : ["diff", "--numstat", "--"];
}

/** Run the injected runner and parse its status output. Nothing here spawns. */
export async function readStatus(run: CommandRunner): Promise<RepoStatus> {
  return parseStatus(await run(STATUS_ARGV));
}

/** Run the injected runner and parse its numstat output. Nothing here spawns. */
export async function readDiffStat(run: CommandRunner, options: { readonly staged?: boolean } = {}): Promise<DiffStatEntry[]> {
  return parseDiffStat(await run(diffStatArgv(options.staged === true)));
}
