/**
 * One daemon per workspace.
 *
 * The daemon writes a pid lock to `workspace/daemon.lock` before it opens the
 * store or binds the control port. The file is created with `O_EXCL`, so the
 * kernel decides the winner when two processes start at the same time.
 *
 * Reclaiming is deliberately different from the store lock in
 * `src/chain/lockfile.ts`. A daemon is long-lived: it may hold the lock for
 * weeks, so age alone must never take a lock away from a live process. On this
 * host the pid decides:
 *
 * - pid gone (`ESRCH`) means the daemon crashed and the lock is stale;
 * - pid alive, or `EPERM` (another user's process — still alive), means refuse;
 * - a pid from another host means nothing here, so that lock is reclaimed only
 *   once its file has not been touched for `staleMs`;
 * - an unparseable lock (the writer died mid-write) is reclaimable after a
 *   short grace period, so a starting daemon is never robbed.
 *
 * Reclaiming is a single attempt: unlink, then create. If a third process wins
 * that create, the error names the winner instead of retrying in a loop.
 */

import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

/** Name of the lock file inside the workspace directory. */
export const DAEMON_LOCK_FILE = "daemon.lock";

/** Contents of the daemon lock file. */
export interface DaemonPidRecord {
  version: 1;
  pid: number;
  /** Hostname of the process that wrote the lock. */
  host: string;
  /** Epoch milliseconds, from the injected clock. */
  startedAt: number;
}

export interface DaemonLockOptions {
  /**
   * Age after which a lock written on another host may be reclaimed, in
   * milliseconds. Default: 10 minutes. Never used to reclaim a lock whose
   * pid is alive on this host.
   */
  staleMs?: number;
  /** Clock injection point for tests. Default: `Date.now`. */
  now?: () => number;
  /** Hostname of this process. Default: `hostname()`. */
  host?: string;
  /** Liveness probe for tests. Default: `process.kill(pid, 0)`. */
  isAlive?: (pid: number) => boolean;
}

export class DaemonLockError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DaemonLockError";
  }
}

/**
 * Another daemon holds the workspace: its pid is alive on this host, it runs
 * on another host and its lock is fresh, or the file is too new to judge.
 */
export class DaemonAlreadyRunningError extends DaemonLockError {
  readonly lockPath: string;
  readonly pid: number | null;
  readonly host: string | null;
  readonly startedAt: number | null;

  constructor(lockPath: string, holder: DaemonPidRecord | null) {
    super(describeHolder(lockPath, holder));
    this.name = "DaemonAlreadyRunningError";
    this.lockPath = lockPath;
    this.pid = holder === null ? null : holder.pid;
    this.host = holder === null ? null : holder.host;
    this.startedAt = holder === null ? null : holder.startedAt;
  }
}

const LOCK_VERSION = 1;
const DEFAULT_STALE_MS = 10 * 60 * 1000;
const PARTIAL_GRACE_MS = 5_000;
const MAX_LOCK_BYTES = 64 * 1024;

type LockSnapshot =
  | { kind: "missing" }
  | { kind: "present"; record: DaemonPidRecord | null; mtimeMs: number };

function errorCode(err: unknown): string | undefined {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return typeof code === "string" ? code : undefined;
}

function hasCode(err: unknown, code: string): boolean {
  return errorCode(err) === code;
}

function describeHolder(lockPath: string, holder: DaemonPidRecord | null): string {
  if (holder === null) {
    return (
      `daemon lock at ${lockPath} exists and is too recent to reclaim` +
      " (unreadable contents, a daemon may still be starting)"
    );
  }
  const since = new Date(holder.startedAt).toISOString();
  return (
    `daemon is already running: pid ${holder.pid} on host ` +
    `${JSON.stringify(holder.host)} since ${holder.startedAt} (${since}); ` +
    `lock file: ${lockPath}`
  );
}

/** Path of the daemon lock file for a workspace directory. */
export function daemonLockPath(workspace: string): string {
  if (typeof workspace !== "string" || workspace.length === 0) {
    throw new TypeError("workspace must be a non-empty string");
  }
  return join(workspace, DAEMON_LOCK_FILE);
}

function parsePidRecord(raw: string): DaemonPidRecord | null {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const { version, pid, host, startedAt } = record;
  if (version !== LOCK_VERSION) return null;
  if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) return null;
  if (typeof host !== "string" || host.length === 0) return null;
  if (typeof startedAt !== "number" || !Number.isFinite(startedAt)) return null;
  return { version: LOCK_VERSION, pid, host, startedAt };
}

function readSnapshot(path: string): LockSnapshot {
  let mtimeMs: number;
  try {
    const stat = statSync(path);
    mtimeMs = stat.mtimeMs;
    if (!stat.isFile() || stat.size > MAX_LOCK_BYTES) {
      return { kind: "present", record: null, mtimeMs };
    }
  } catch (err) {
    if (hasCode(err, "ENOENT")) return { kind: "missing" };
    // Exists but cannot be stat'ed: not evidence of death.
    return { kind: "present", record: null, mtimeMs: 0 };
  }
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    if (hasCode(err, "ENOENT")) return { kind: "missing" };
    // Unreadable (permissions) is not evidence of death.
    return { kind: "present", record: null, mtimeMs };
  }
  return { kind: "present", record: parsePidRecord(raw), mtimeMs };
}

/** `true` when `pid` exists on this host. `EPERM` counts as alive. */
export function defaultIsPidAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return !hasCode(err, "ESRCH");
  }
}

function writeLock(path: string, record: DaemonPidRecord): void {
  const payload = `${JSON.stringify(record)}\n`;
  const fd = openSync(path, "wx", 0o644);
  let written = false;
  try {
    writeFileSync(fd, payload, "utf8");
    fsyncSync(fd);
    written = true;
  } finally {
    closeSync(fd);
    if (!written) {
      try {
        unlinkSync(path);
      } catch {
        // Best effort: a partial file becomes reclaimable after the grace.
      }
    }
  }
}

export class DaemonLock {
  /** Absolute path of the lock file. */
  readonly path: string;
  /** Our own lock record. */
  readonly info: DaemonPidRecord;
  /** `true` when a stale lock was taken over during `acquire`. */
  readonly reclaimed: boolean;
  private released = false;

  private constructor(path: string, info: DaemonPidRecord, reclaimed: boolean) {
    this.path = path;
    this.info = Object.freeze({ ...info });
    this.reclaimed = reclaimed;
  }

  /**
   * Take the workspace lock, or throw `DaemonAlreadyRunningError` naming the
   * holder. `workspace` is the directory, not the file.
   */
  static acquire(workspace: string, options: DaemonLockOptions = {}): DaemonLock {
    const path = daemonLockPath(workspace);
    const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
    if (!Number.isFinite(staleMs) || staleMs < 0) {
      throw new TypeError("staleMs must be a non-negative finite number");
    }
    const now = options.now ?? Date.now;
    const host = options.host ?? hostname();
    if (typeof host !== "string" || host.length === 0) {
      throw new TypeError("host must be a non-empty string");
    }
    const isAlive = options.isAlive ?? defaultIsPidAlive;
    mkdirSync(workspace, { recursive: true });

    const info: DaemonPidRecord = {
      version: LOCK_VERSION,
      pid: process.pid,
      host,
      startedAt: now(),
    };

    try {
      writeLock(path, info);
      return new DaemonLock(path, info, false);
    } catch (err) {
      if (!hasCode(err, "EEXIST")) throw err;
    }

    const found = readSnapshot(path);
    if (!isStale(found, now(), staleMs, host, isAlive)) {
      throw new DaemonAlreadyRunningError(path, found.kind === "present" ? found.record : null);
    }

    try {
      unlinkSync(path);
    } catch (err) {
      if (!hasCode(err, "ENOENT")) throw err;
    }
    try {
      writeLock(path, info);
    } catch (err) {
      if (!hasCode(err, "EEXIST")) throw err;
      const current = readSnapshot(path);
      throw new DaemonAlreadyRunningError(
        path,
        current.kind === "present" ? current.record : null,
      );
    }
    return new DaemonLock(path, info, true);
  }

  /**
   * Remove the lock, but only while it still holds this acquisition's record
   * (pid, host and start time). Idempotent, and never throws: it belongs in a
   * `finally` where a throw would hide the real failure.
   */
  release(): void {
    if (this.released) return;
    this.released = true;
    const current = readSnapshot(this.path);
    if (current.kind !== "present" || current.record === null) return;
    const holder = current.record;
    const ours =
      holder.pid === this.info.pid &&
      holder.host === this.info.host &&
      holder.startedAt === this.info.startedAt;
    if (!ours) return;
    try {
      unlinkSync(this.path);
    } catch {
      // Already removed, or unremovable; a leftover lock is reclaimable.
    }
  }
}

/**
 * Decide whether an existing lock may be taken. Same-host liveness is
 * authoritative; age only applies to a foreign host or an unparseable file.
 */
function isStale(
  snapshot: LockSnapshot,
  at: number,
  staleMs: number,
  host: string,
  isAlive: (pid: number) => boolean,
): boolean {
  if (snapshot.kind === "missing") return true;
  if (snapshot.record === null) {
    return at - snapshot.mtimeMs > PARTIAL_GRACE_MS;
  }
  if (snapshot.record.host === host) {
    return !isAlive(snapshot.record.pid);
  }
  // A pid from another machine says nothing about this one; use the file age.
  return at - snapshot.mtimeMs > staleMs;
}
