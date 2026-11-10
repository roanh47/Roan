/**
 * Read-only git access for a repository on disk.
 *
 * Every command runs as `git --no-pager -C <repo> …` through `execFile`, so the
 * repo path and the arguments never pass a shell. There is deliberately no
 * write operation here (no add, commit, checkout, reset): callers that need one
 * must run it explicitly elsewhere.
 */

import { execFile } from "node:child_process";

export interface GitStatusEntry {
  status: string;
  path: string;
}

export interface GitLogEntry {
  hash: string;
  date: string;
  subject: string;
}

/** Default cap for `gitDiff`, in characters. */
const DEFAULT_DIFF_MAX_CHARS = 20_000;
/** Default number of commits for `gitLog`. */
const DEFAULT_LOG_LIMIT = 20;
/** Hard cap so one call cannot pull the whole history by accident. */
const MAX_LOG_LIMIT = 1_000;
/** A diff of a large repo can be big; keep a ceiling well above the char cap. */
const MAX_BUFFER = 32 * 1024 * 1024;

interface ExecFailure {
  code?: number | string;
  stderr?: string;
  stdout?: string;
  message?: string;
}

function requireRepo(repo: string): string {
  if (typeof repo !== "string" || repo.trim().length === 0) {
    throw new Error("repo moet een niet-lege padnaam zijn");
  }
  return repo;
}

function describeFailure(repo: string, err: unknown): Error {
  const e = err as ExecFailure;
  const detail = (e.stderr ?? "").trim() || (e.stdout ?? "").trim() || e.message || "onbekende fout";
  if (e.code === "ENOENT") {
    return new Error(`git niet gevonden voor ${repo}: ${detail}`);
  }
  if (e.code === "E2BIG" || e.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
    return new Error(`git-uitvoer te groot voor ${repo}: ${detail}`);
  }
  return new Error(`git faalde voor ${repo}: ${detail}`);
}

/** Run git in `repo` and return stdout; any failure becomes an Error naming the repo. */
function runGit(repo: string, args: string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile(
      "git",
      ["--no-pager", "-C", repo, ...args],
      { encoding: "utf8", maxBuffer: MAX_BUFFER, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          // Some failures carry a clearer stderr than the errno message; fold
          // both in through describeFailure.
          const failure = err as ExecFailure & { stderr?: string };
          if (!failure.stderr && stderr) {
            failure.stderr = stderr;
          }
          reject(describeFailure(repo, failure));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function positiveInt(value: number | undefined, fallback: number, field: string): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${field} moet een positief geheel getal zijn`);
  }
  return value;
}

/**
 * Turn the `## …` header of `git status --porcelain=v1 --branch` into a branch
 * name. Detached HEAD is reported as `HEAD`, an unborn branch keeps its name.
 */
function parseBranch(header: string): string {
  const rest = header.slice(2).trim();
  if (rest.length === 0) {
    return "HEAD";
  }
  const noCommits = /^No commits yet on (.+)$/.exec(rest);
  if (noCommits !== null && noCommits[1] !== undefined) {
    return noCommits[1].trim();
  }
  if (rest.startsWith("Initial commit on ")) {
    return rest.slice("Initial commit on ".length).trim();
  }
  const dots = rest.indexOf("...");
  const name = dots === -1 ? rest : rest.slice(0, dots);
  // `HEAD (no branch)` means detached; keep it recognisable but stable.
  if (name.startsWith("HEAD (no branch)")) {
    return "HEAD";
  }
  return name.trim();
}

/**
 * Working-tree status of `repo`.
 *
 * Uses `--porcelain=v1 --branch -z`, so paths with spaces, quotes or newlines
 * survive intact; entries are split on NUL. Rename/copy entries carry two NUL
 * fields (new path, then old path) and are reported as `"new (was old)"`.
 */
export async function gitStatus(
  repo: string,
): Promise<{ branch: string; entries: GitStatusEntry[] }> {
  const target = requireRepo(repo);
  const out = await runGit(target, ["status", "--porcelain=v1", "--branch", "-z"]);
  const fields = out.split("\u0000");
  const entries: GitStatusEntry[] = [];
  let branch = "HEAD";

  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i];
    if (field === undefined || field.length === 0) {
      continue;
    }
    if (field.startsWith("## ")) {
      branch = parseBranch(field);
      continue;
    }
    if (field.length < 4) {
      continue;
    }
    const status = field.slice(0, 2);
    const path = field.slice(3);
    if (status.includes("R") || status.includes("C")) {
      const original = fields[i + 1];
      i += 1;
      entries.push({
        status,
        path: original === undefined || original.length === 0 ? path : `${path} (was ${original})`,
      });
      continue;
    }
    entries.push({ status, path });
  }

  return { branch, entries };
}

/**
 * Diff of the working tree against the index (or the index against HEAD when
 * `staged`), optionally limited to `path`. Output is capped at `maxChars`
 * characters (default 20000); when truncated, a marker line states how many
 * characters were withheld.
 */
export async function gitDiff(
  repo: string,
  options?: { staged?: boolean; path?: string; maxChars?: number },
): Promise<string> {
  const target = requireRepo(repo);
  const maxChars =
    options?.maxChars === undefined
      ? DEFAULT_DIFF_MAX_CHARS
      : positiveInt(options.maxChars, DEFAULT_DIFF_MAX_CHARS, "maxChars");

  const args = ["diff", "--no-color", "--no-ext-diff"];
  if (options?.staged === true) {
    args.push("--cached");
  }
  if (options?.path !== undefined) {
    if (typeof options.path !== "string" || options.path.length === 0) {
      throw new Error("diff-pad moet een niet-lege string zijn");
    }
    args.push("--", options.path);
  } else {
    args.push("--");
  }

  const out = await runGit(target, args);
  if (out.length <= maxChars) {
    return out;
  }
  const withheld = out.length - maxChars;
  const marker = `…(diff afgekapt: ${maxChars} van ${out.length} tekens getoond, ${withheld} tekens weggelaten)`;
  return `${out.slice(0, maxChars)}\n${marker}\n`;
}

/**
 * Recent commits, newest first. Each entry has the full hash, the committer date
 * in strict ISO 8601 (`%cI`) and the subject line; records are NUL-separated and
 * fields tab-separated, so subjects containing tabs stay intact.
 *
 * An empty repository (no commits yet) yields `[]` rather than an error.
 */
export async function gitLog(
  repo: string,
  options?: { limit?: number },
): Promise<GitLogEntry[]> {
  const target = requireRepo(repo);
  const limit = Math.min(
    positiveInt(options?.limit, DEFAULT_LOG_LIMIT, "limit"),
    MAX_LOG_LIMIT,
  );

  let out: string;
  try {
    out = await runGit(target, ["log", "-z", "--format=%H%x09%cI%x09%s", "-n", String(limit)]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("does not have any commits yet") || message.includes("has no commits yet")) {
      return [];
    }
    throw err;
  }

  const entries: GitLogEntry[] = [];
  for (const record of out.split("\u0000")) {
    const line = record.replace(/^\n/, "");
    if (line.length === 0) {
      continue;
    }
    const first = line.indexOf("\t");
    const second = first === -1 ? -1 : line.indexOf("\t", first + 1);
    if (first === -1 || second === -1) {
      // Defensive: git should always emit three fields; skip rather than throw.
      continue;
    }
    entries.push({
      hash: line.slice(0, first),
      date: line.slice(first + 1, second),
      subject: line.slice(second + 1),
    });
  }
  return entries.slice(0, limit);
}
