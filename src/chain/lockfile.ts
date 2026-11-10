/**
 * Single-writer lock for the chain store.
 *
 * One process owns a store file at a time. The lock is a sibling file,
 * `<storePath>.lock`, created with `O_EXCL` so exactly one process wins the
 * create. Nothing here is registered globally: the caller owns the handle and
 * must `release()` it, usually in a `finally`.
 *
 * Reclaiming a dead process is deliberate, not automatic on every open:
 *
 * - a lock whose pid no longer exists on this host is stale;
 * - a lock older than `staleMs` (default 10 minutes) is stale, because the
 *   writer never refreshed it — this is also how a recycled pid is caught;
 * - a lock whose contents do not parse (the writer died mid-write) is stale
 *   once it is at least 5 seconds old, so a live writer is never robbed.
 *
 * A readable lock from another host is never probed for liveness — a pid from
 * another machine means nothing here — and is only reclaimed by age.
 *
 * EPERM from `process.kill(pid, 0)` means the pid exists but belongs to another
 * user, which still means alive: the store is refused.
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
import { dirname } from "node:path";

/** Contents of the lock file. */
export interface LockInfo {
  version: 1;
  pid: number;
  host: string;
  /** Epoch milliseconds, taken from the injected clock. */
  startedAt: number;
}

export interface StoreLockOptions {
  /** Age at which a leftover lock may be reclaimed. Default: 10 minutes. */
  staleMs?: number;
  /** Clock injection point for tests. Default: `Date.now`. */
  now?: () => number;
}

export class StoreLockError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StoreLockError";
  }
}

/**
 * The store is held by another live writer, or by a lock too recent to judge.
 * The message names the holder's pid, host, start time and the lock path.
 */
export class StoreLockedError extends StoreLockError {
  readonly lockPath: string;
  readonly pid: number | null;
  readonly host: string | null;
  readonly startedAt: number | null;

  constructor(lockPath: string, holder: LockInfo | null) {
    super(describeLocked(lockPath, holder));
    this.name = "StoreLockedError";
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

/** A lock file as found on disk: absent, readable, or present but unreadable. */
type LockSnapshot =
  | { kind: "missing" }
  | { kind: "present"; info: LockInfo | null; mtimeMs: number };

function errorCode(err: unknown): string | undefined {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return typeof code === "string" ? code : undefined;
}

function hasCode(err: unknown, code: string): boolean {
  return errorCode(err) === code;
}

function describeLocked(lockPath: string, holder: LockInfo | null): string {
  if (holder === null) {
    return (
      `store lock at ${lockPath} exists and is too recent to reclaim` +
      " (unreadable contents, writer may still be starting)"
    );
  }
  const since = new Date(holder.startedAt).toISOString();
  return (
    `store is locked by pid ${holder.pid} on host ${JSON.stringify(holder.host)}` +
    ` since ${holder.startedAt} (${since}); lock file: ${lockPath}`
  );
}

function parseLockInfo(raw: string): LockInfo | null {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const { version, pid, host, startedAt } = record;
  if (version !== LOCK_VERSION) return null;
  if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) return null;
  if (typeof host !== "string" || host.length === 0) return null;
  if (typeof startedAt !== "number" || !Number.isFinite(startedAt)) return null;
  return { version: LOCK_VERSION, pid, host, startedAt };
}

function readLock(path: string): LockSnapshot {
  let mtimeMs: number;
  try {
    const stat = statSync(path);
    mtimeMs = stat.mtimeMs;
    if (!stat.isFile() || stat.size > MAX_LOCK_BYTES) {
      return { kind: "present", info: null, mtimeMs };
    }
  } catch (err) {
    if (hasCode(err, "ENOENT")) return { kind: "missing" };
    return { kind: "present", info: null, mtimeMs: 0 };
  }
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    if (hasCode(err, "ENOENT")) return { kind: "missing" };
    // Unreadable (permissions) is not evidence of death.
    return { kind: "present", info: null, mtimeMs };
  }
  return { kind: "present", info: parseLockInfo(raw), mtimeMs };
}

/** `true` when `pid` exists on this host. EPERM counts as alive. */
function isPidAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH: no such process. Anything else (EPERM, EACCES): alive or unknown.
    return !hasCode(err, "ESRCH");
  }
}

/**
 * Decide whether an existing lock may be taken over. Ordered so that age wins:
 * a lock past `staleMs` is reclaimed even if its pid happens to be alive, which
 * is what catches pid reuse after a reboot.
 */
function isStale(snapshot: LockSnapshot, at: number, staleMs: number): boolean {
  if (snapshot.kind === "missing") return true;
  if (snapshot.info === null) {
    return at - snapshot.mtimeMs > PARTIAL_GRACE_MS;
  }
  if (at - snapshot.info.startedAt > staleMs) return true;
  if (snapshot.info.host !== hostname()) return false;
  return !isPidAlive(snapshot.info.pid);
}

function writeLock(path: string, info: LockInfo): void {
  const payload = `${JSON.stringify(info)}\n`;
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
        // Best effort: a partial file is reclaimable after PARTIAL_GRACE_MS.
      }
    }
  }
}

export class StoreLock {
  /** Path of the lock file, `<storePath>.lock`. */
  readonly path: string;
  /** Our own lock record. */
  readonly info: LockInfo;
  /** `true` when a stale lock was taken over during `acquire`. */
  readonly recovered: boolean;
  private released = false;

  private constructor(path: string, info: LockInfo, recovered: boolean) {
    this.path = path;
    this.info = Object.freeze({ ...info });
    this.recovered = recovered;
  }

  static acquire(storePath: string, options: StoreLockOptions = {}): StoreLock {
    if (typeof storePath !== "string" || storePath.length === 0) {
      throw new TypeError("storePath must be a non-empty string");
    }
    const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
    if (!Number.isFinite(staleMs) || staleMs < 0) {
      throw new TypeError("staleMs must be a non-negative finite number");
    }
    const now = options.now ?? Date.now;
    const path = `${storePath}.lock`;
    mkdirSync(dirname(path), { recursive: true });

    const info: LockInfo = {
      version: LOCK_VERSION,
      pid: process.pid,
      host: hostname(),
      startedAt: now(),
    };

    try {
      writeLock(path, info);
      return new StoreLock(path, info, false);
    } catch (err) {
      if (!hasCode(err, "EEXIST")) throw err;
    }

    const found = readLock(path);
    if (!isStale(found, now(), staleMs)) {
      throw new StoreLockedError(path, found.kind === "present" ? found.info : null);
    }

    // Stale: take it over exactly once. If a third process slips in between, we
    // lose the create and report the winner rather than looping.
    try {
      unlinkSync(path);
    } catch (err) {
      if (!hasCode(err, "ENOENT")) throw err;
    }
    try {
      writeLock(path, info);
    } catch (err) {
      if (!hasCode(err, "EEXIST")) throw err;
      const current = readLock(path);
      throw new StoreLockedError(path, current.kind === "present" ? current.info : null);
    }
    return new StoreLock(path, info, true);
  }

  /**
   * Remove the lock file, but only while it still holds this acquisition's
   * record (pid, host and start time). Idempotent; never throws, because it is
   * meant for `finally` where a throw would mask the real error.
   */
  release(): void {
    if (this.released) return;
    this.released = true;
    const current = readLock(this.path);
    if (current.kind !== "present" || current.info === null) return;
    const holder = current.info;
    const ours =
      holder.pid === this.info.pid &&
      holder.host === this.info.host &&
      holder.startedAt === this.info.startedAt;
    if (!ours) return;
    try {
      unlinkSync(this.path);
    } catch {
      // Someone else already removed it, or we cannot. A leftover lock expires.
    }
  }
}
