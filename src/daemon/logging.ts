/**
 * The daemon's own log file: append-only, scrubbed on the way in, bounded by
 * rotation.
 *
 * Every record passes through `redact` before it touches the disk, so a token
 * that slipped into a message never becomes a line in `roan.log`. Rotation is
 * planned by `planRotation` (pure) and applied here; the active file is renamed
 * aside once it has grown past the byte budget, and `maxFiles` archives are
 * kept (`roan.log`, `roan.log.1` … `roan.log.3` by default, matching the
 * `rotate 3` convention). A file may therefore exceed the budget by at most one
 * record, which is cheaper than unpacking a write to measure it first.
 *
 * Writes are queued: two callers appending at once can never interleave a
 * rename with an append, and a failed write rejects only its own promise.
 */

import { appendFile, mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { redact } from "../protocol/redact.js";
import { parsePolicy, planRotation, type LogFile, type RotationPolicy } from "./log-rotate.js";

/** 2 MB active file plus three archives, so at most ~8 MB on disk. */
export const DEFAULT_POLICY: RotationPolicy = Object.freeze({
  maxBytes: 2 * 1024 * 1024,
  maxFiles: 3,
});

export interface LoggerOptions {
  /** Absolute path of the active log file, usually `logFilePath(workspace)`. */
  readonly logFile: string;
  /** Defaults to `DEFAULT_POLICY`; out-of-range numbers are clamped. */
  readonly policy?: RotationPolicy;
  /** Directory collapsed to `~`. Defaults to the OS home directory. */
  readonly home?: string;
  /** Extra expressions besides the built-in credential shapes. */
  readonly extraPatterns?: readonly RegExp[];
  /** Clock, injected by tests. */
  readonly now?: () => Date;
}

export interface Logger {
  /** Queue one record. The returned promise settles when it is on disk. */
  write(message: string): Promise<void>;
  /** Resolve once every queued record has been written. */
  flush(): Promise<void>;
}

const SUFFIX = /^(.+)\.(\d+)$/;

/*
 * `redact` catches `Authorization: Bearer …`, but a bare "Bearer <token>" (a
 * curl command echoed into a message, a mis-quoted header) slips through. A log
 * line is the worst place for that gap, so close it here rather than trusting
 * every caller to phrase its error nicely.
 */
const BARE_SCHEME_TOKEN = /\b(?:bearer|basic|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi;

/** `workspace/logs/roan.log`, where `workspace` comes from `resolvePaths`. */
export function logFilePath(workspace: string): string {
  return join(workspace, "logs", "roan.log");
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

async function sizeOf(path: string): Promise<number> {
  try {
    const info = await stat(path);
    return info.isFile() ? info.size : 0;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return 0;
    throw error;
  }
}

/** Active file plus every archived member that currently exists. */
async function listFamily(logFile: string): Promise<LogFile[]> {
  const files: LogFile[] = [{ path: logFile, size: await sizeOf(logFile) }];

  let names: string[];
  try {
    names = await readdir(dirname(logFile));
  } catch (error) {
    if (errorCode(error) === "ENOENT") return files;
    throw error;
  }

  const base = basename(logFile);
  for (const name of names) {
    if (name === base) continue;
    const match = SUFFIX.exec(name);
    if (match === null || match[1] !== base) continue;
    const path = join(dirname(logFile), name);
    files.push({ path, size: await sizeOf(path) });
  }

  return files;
}

async function removeIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
}

/** Apply whatever `planRotation` asks for; a no-op while the file fits. */
async function rotate(logFile: string, policy: RotationPolicy): Promise<void> {
  const plan = planRotation(await listFamily(logFile), policy);
  for (const path of plan.remove) {
    await removeIfPresent(path);
  }
  // Newest suffix first: every rename lands on a name just freed.
  for (const step of plan.renames) {
    await rename(step.from, step.to);
  }
}

function formatRecord(message: string, timestamp: string): string {
  const body = message.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  return body
    .split("\n")
    .map((line) => (line.length === 0 ? `${timestamp}\n` : `${timestamp} ${line}\n`))
    .join("");
}

async function appendRecord(
  logFile: string,
  policy: RotationPolicy,
  record: string,
): Promise<void> {
  await mkdir(dirname(logFile), { recursive: true });
  if ((await sizeOf(logFile)) > policy.maxBytes) {
    await rotate(logFile, policy);
  }
  await appendFile(logFile, record, { encoding: "utf8", mode: 0o600 });
}

export function createLogger(options: LoggerOptions): Logger {
  const { logFile } = options;
  if (typeof logFile !== "string" || logFile.trim().length === 0) {
    throw new Error(`logger requires a non-empty logFile path, got ${JSON.stringify(logFile)}`);
  }

  const policy = parsePolicy(options.policy ?? DEFAULT_POLICY);
  const clock = options.now ?? (() => new Date());
  const redactOptions = {
    ...(options.home === undefined ? {} : { home: options.home }),
    extraPatterns: [BARE_SCHEME_TOKEN, ...(options.extraPatterns ?? [])],
  };

  let queue: Promise<void> = Promise.resolve();

  function write(message: string): Promise<void> {
    // Formatting and redaction stay outside the queue: a bad argument fails
    // immediately instead of poisoning the writes behind it.
    const record = formatRecord(redact(message, redactOptions), clock().toISOString());
    const task = queue.then(() => appendRecord(logFile, policy, record));
    queue = task.catch(() => undefined);
    return task;
  }

  return { write, flush: () => queue };
}
