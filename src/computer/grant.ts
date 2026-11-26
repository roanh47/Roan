/**
 * A per-session grant for computer control.
 *
 * Moving a mouse and typing into whatever window has focus is the most
 * dangerous thing this agent can do: it acts on the machine, not on a file
 * path, so there is no scope to check and nothing to undo. The grant is the
 * whole safety story, and it is deliberately small:
 *
 *  - it is per session, so permission given in one conversation cannot be
 *    spent by another;
 *  - it expires on its own, so a grant made an hour ago is not still live;
 *  - it can be revoked, and revocation is a tombstone rather than a delete, so
 *    a later action is told `revoked` instead of `no-grant` — "you turned this
 *    off" and "you never turned this on" are different answers.
 *
 * Nothing here executes input. This module only answers "may this session act
 * right now", which keeps the decision testable without a display server.
 */

/** Why a session is not allowed to act. Each value is a distinct case. */
export type GrantFailure = "no-grant" | "expired" | "revoked";

/** A live grant, frozen, safe to hand to a caller. */
export interface ComputerGrant {
  readonly sessionId: string;
  readonly grantedAtMs: number;
  readonly expiresAtMs: number;
}

/** The grant decision: either the grant itself, or the reason there is none. */
export type GrantCheck =
  | { readonly granted: true; readonly grant: ComputerGrant }
  | { readonly granted: false; readonly reason: GrantFailure };

/** Options for `grantSession`. */
export interface GrantSessionOptions {
  /** Lifetime of this grant. Defaults to the store's ttl. */
  readonly ttlMs?: number;
}

/** Options for `createGrantStore`; every field has a working default. */
export interface GrantStoreOptions {
  /** Lifetime of a grant when the caller does not pass one. Default 10 minutes. */
  readonly ttlMs?: number;
  /** How many sessions are retained, tombstones included. Default 256. */
  readonly maxSessions?: number;
  /** Clock, in milliseconds. Default `Date.now`; tests pass a fake. */
  readonly now?: () => number;
}

/** The in-memory handle returned by `createGrantStore`. */
export interface GrantStore {
  grantSession(sessionId: string, options?: GrantSessionOptions): ComputerGrant;
  isGranted(sessionId: string): boolean;
  /** The full decision, including why it was refused. */
  check(sessionId: string): GrantCheck;
  /** Revoke a grant. Returns true when a live grant was actually revoked. */
  revokeSession(sessionId: string): boolean;
  /** Every retained grant that is still live, oldest first. */
  list(): readonly ComputerGrant[];
}

/**
 * Ten minutes: long enough to finish a task, short enough that a forgotten
 * grant is not an open door for the rest of the day.
 */
export const DEFAULT_GRANT_TTL_MS = 10 * 60_000;

/** Tombstones are small but not free, so the store is bounded. */
const DEFAULT_MAX_SESSIONS = 256;

type EntryState = "active" | "expired" | "revoked";

interface Entry {
  readonly sessionId: string;
  readonly grantedAtMs: number;
  readonly expiresAtMs: number;
  state: EntryState;
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive integer, got ${String(value)}`);
  }
  return value;
}

/** Render an untrusted value for an error message without echoing junk. */
function describeValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null) return "null";
  if (typeof value === "object") return Object.prototype.toString.call(value);
  return String(value);
}

function checkSessionId(sessionId: unknown): string {
  if (typeof sessionId !== "string" || sessionId.trim() === "") {
    throw new Error(
      `computer grant: sessionId must be a non-empty string, got ${describeValue(sessionId)}`,
    );
  }
  if (sessionId.includes("\0")) {
    throw new Error("computer grant: sessionId must not contain a NUL byte");
  }
  return sessionId;
}

function snapshot(entry: Entry): ComputerGrant {
  return Object.freeze({
    sessionId: entry.sessionId,
    grantedAtMs: entry.grantedAtMs,
    expiresAtMs: entry.expiresAtMs,
  });
}

/**
 * Create an isolated grant store.
 *
 * Nothing is shared between stores, the clock is the caller's, and expiry is
 * evaluated lazily against `now()` and written back into the entry, so every
 * later call reports the same `expired` instead of flipping between answers.
 *
 * Granting a session that was revoked is allowed and replaces the tombstone:
 * a grant always comes from an explicit decision, and re-asking is a decision.
 */
export function createGrantStore(options: GrantStoreOptions = {}): GrantStore {
  const ttlMs = positiveInteger(options.ttlMs ?? DEFAULT_GRANT_TTL_MS, "ttlMs");
  const maxSessions = positiveInteger(options.maxSessions ?? DEFAULT_MAX_SESSIONS, "maxSessions");
  const now = options.now ?? Date.now;

  /** Insertion order is the age order: the first key is the oldest session. */
  const records = new Map<string, Entry>();

  function settle(entry: Entry, atMs: number): void {
    if (entry.state === "active" && atMs >= entry.expiresAtMs) {
      entry.state = "expired";
    }
  }

  /** Drop settled tombstones, oldest first, until there is room for one more. */
  function makeRoom(): void {
    if (records.size < maxSessions) return;
    const atMs = now();
    for (const [sessionId, entry] of records) {
      if (records.size < maxSessions) break;
      settle(entry, atMs);
      if (entry.state !== "active") records.delete(sessionId);
    }
    if (records.size >= maxSessions) {
      throw new Error(
        `computer grant store is full: ${maxSessions} sessions still hold a live grant`,
      );
    }
  }

  function grantSession(
    sessionId: string,
    grantOptions: GrantSessionOptions = {},
  ): ComputerGrant {
    const checked = checkSessionId(sessionId);
    const grantedTtlMs = positiveInteger(grantOptions.ttlMs ?? ttlMs, "ttlMs");

    const existing = records.get(checked);
    if (existing === undefined) makeRoom();

    const grantedAtMs = now();
    const entry: Entry = {
      sessionId: checked,
      grantedAtMs,
      expiresAtMs: grantedAtMs + grantedTtlMs,
      state: "active",
    };
    // Re-granting an existing key keeps its age position in the map, which is
    // harmless: pruning only ever removes settled entries.
    records.set(checked, entry);
    return snapshot(entry);
  }

  function check(sessionId: string): GrantCheck {
    const checked = checkSessionId(sessionId);
    const entry = records.get(checked);
    if (entry === undefined) return { granted: false, reason: "no-grant" };
    settle(entry, now());
    if (entry.state === "revoked") return { granted: false, reason: "revoked" };
    if (entry.state === "expired") return { granted: false, reason: "expired" };
    return { granted: true, grant: snapshot(entry) };
  }

  function isGranted(sessionId: string): boolean {
    return check(sessionId).granted;
  }

  function revokeSession(sessionId: string): boolean {
    const checked = checkSessionId(sessionId);
    const entry = records.get(checked);
    if (entry === undefined) return false;
    settle(entry, now());
    const wasLive = entry.state === "active";
    // The tombstone stays, so a later action is told `revoked`, not `no-grant`.
    entry.state = "revoked";
    return wasLive;
  }

  function list(): readonly ComputerGrant[] {
    const atMs = now();
    const live: ComputerGrant[] = [];
    for (const entry of records.values()) {
      settle(entry, atMs);
      if (entry.state === "active") live.push(snapshot(entry));
    }
    return Object.freeze(live);
  }

  return { grantSession, isGranted, check, revokeSession, list };
}

/** The process-wide store behind the standalone functions below. */
let sharedStore: GrantStore | undefined;

function defaultStore(): GrantStore {
  sharedStore ??= createGrantStore();
  return sharedStore;
}

/** Grant `sessionId` control of this machine for a bounded time. */
export function grantSession(
  sessionId: string,
  options?: GrantSessionOptions,
): ComputerGrant {
  return defaultStore().grantSession(sessionId, options);
}

/** True while `sessionId` holds a live grant. Expiry is checked, never cached. */
export function isGranted(sessionId: string): boolean {
  return defaultStore().isGranted(sessionId);
}

/** The full decision for `sessionId`, including the reason when refused. */
export function checkGrant(sessionId: string): GrantCheck {
  return defaultStore().check(sessionId);
}

/** Kill the grant for `sessionId`; it stays dead until granted again. */
export function revokeSession(sessionId: string): boolean {
  return defaultStore().revokeSession(sessionId);
}
