/**
 * One-time approval for a command that runs above the normal trust level.
 *
 * A request produces an unguessable id; the id is approved once, by a human
 * decision somewhere else, and consumed once, by the code that actually runs
 * the command. The two steps are separate on purpose: approval is a decision,
 * consumption is the use of it, and a decision that is used twice would be a
 * second command running on the first command's approval.
 *
 * Every refusal carries its own reason so a caller can tell "never heard of
 * this id" from "too late" from "already used":
 * - `unknown`     — no such id was ever issued (or it was pruned);
 * - `not-approved` — the id is real and pending, but nobody approved it;
 * - `already-approved` — approve was called twice; the second call changes nothing;
 * - `expired`     — the request outlived its ttl;
 * - `reused`      — the id was already consumed; it is dead for good.
 *
 * Dead ids are kept as tombstones so a replay is reported as `reused` rather
 * than as an id that never existed.
 */

import { randomUUID } from "node:crypto";

/** Why a request was refused. Each value is a distinct, testable case. */
export type ElevationFailure =
  | "unknown"
  | "not-approved"
  | "already-approved"
  | "expired"
  | "reused";

/** The lifecycle position of a request. */
export type ElevationState = "pending" | "approved" | "consumed" | "expired";

/** A frozen snapshot of one request, safe to hand to a caller. */
export interface ElevationView {
  readonly id: string;
  readonly command: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  /** Set once the request is approved. */
  readonly approvedAtMs: number | null;
  readonly state: ElevationState;
}

/** What `request` returns: the id is the only handle the approver needs. */
export type ElevationRequest = ElevationView;

export type ApproveResult =
  | { readonly ok: true; readonly request: ElevationView }
  | { readonly ok: false; readonly reason: ElevationFailure };

export type ConsumeResult =
  | { readonly ok: true; readonly command: string }
  | { readonly ok: false; readonly reason: ElevationFailure };

/** Options for `request`. */
export interface ElevationRequestOptions {
  /** How long this request stays valid. Defaults to the store's ttl. */
  ttlMs?: number;
}

/** Options for `createElevationStore`; every field has a working default. */
export interface ElevationStoreOptions {
  /** Lifetime of a request when the caller does not pass one. Default 5 minutes. */
  ttlMs?: number;
  /** How many requests (live and tombstoned) are retained. Default 256. */
  maxRecords?: number;
  /** Clock, in milliseconds. Default `Date.now`; tests pass a fake. */
  now?: () => number;
  /** Id generator. Default `randomUUID`; tests may pass a counter. */
  idFactory?: () => string;
}

/** The in-memory handle returned by `createElevationStore`. */
export interface ElevationStore {
  request(command: string, options?: ElevationRequestOptions): ElevationRequest;
  approve(id: string): ApproveResult;
  consume(id: string): ConsumeResult;
  /** The current snapshot, or undefined for an id that was never issued. */
  inspect(id: string): ElevationView | undefined;
  /** Every retained request, oldest first. */
  list(): readonly ElevationView[];
}

/** Default lifetime: long enough to read the command, short enough to matter. */
const DEFAULT_TTL_MS = 5 * 60_000;

/** Default retention; tombstones are small but not free. */
const DEFAULT_MAX_RECORDS = 256;

interface Entry {
  readonly id: string;
  readonly command: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  approvedAtMs: number | null;
  state: ElevationState;
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive integer, got ${String(value)}`);
  }
  return value;
}

/** Render an untrusted value for an error message. */
function describeValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null) return "null";
  if (typeof value === "object") return Object.prototype.toString.call(value);
  return String(value);
}

function checkCommand(command: unknown): string {
  if (typeof command !== "string" || command.trim() === "") {
    throw new Error(`requestElevation: command must be a non-empty string, got ${describeValue(command)}`);
  }
  if (command.includes("\0")) {
    throw new Error("requestElevation: command must not contain a NUL byte");
  }
  return command;
}

function checkId(id: unknown): string {
  if (typeof id !== "string" || id.trim() === "") {
    throw new Error(`elevation: id must be a non-empty string, got ${describeValue(id)}`);
  }
  return id;
}

function snapshot(entry: Entry): ElevationView {
  return Object.freeze({
    id: entry.id,
    command: entry.command,
    createdAtMs: entry.createdAtMs,
    expiresAtMs: entry.expiresAtMs,
    approvedAtMs: entry.approvedAtMs,
    state: entry.state,
  });
}

/**
 * Create an isolated approval store.
 *
 * Nothing is shared between stores, the clock is the caller's, and ids come
 * from `randomUUID` unless a factory is injected. Expiry is evaluated lazily
 * against `now()` and is written back into the entry, so every later call
 * reports the same `expired` rather than flipping between states.
 */
export function createElevationStore(options: ElevationStoreOptions = {}): ElevationStore {
  const ttlMs = positiveInteger(options.ttlMs ?? DEFAULT_TTL_MS, "ttlMs");
  const maxRecords = positiveInteger(options.maxRecords ?? DEFAULT_MAX_RECORDS, "maxRecords");
  const now = options.now ?? Date.now;
  const idFactory = options.idFactory ?? randomUUID;

  /** Insertion order is the age order: the first key is the oldest request. */
  const records = new Map<string, Entry>();

  function isExpired(entry: Entry, atMs: number): boolean {
    return entry.state !== "consumed" && atMs >= entry.expiresAtMs;
  }

  /** Mark a live entry expired if its deadline has passed. */
  function settle(entry: Entry, atMs: number): void {
    if (isExpired(entry, atMs)) {
      entry.state = "expired";
    }
  }

  /** Drop dead requests, oldest first, until there is room for one more. */
  function makeRoom(): void {
    if (records.size < maxRecords) return;
    const atMs = now();
    for (const [id, entry] of records) {
      if (records.size < maxRecords) break;
      settle(entry, atMs);
      if (entry.state === "expired" || entry.state === "consumed") {
        records.delete(id);
      }
    }
    if (records.size >= maxRecords) {
      throw new Error(
        `elevation store is full: ${maxRecords} requests are still pending or approved`,
      );
    }
  }

  function request(command: string, requestOptions: ElevationRequestOptions = {}): ElevationRequest {
    const checked = checkCommand(command);
    const requestTtl = positiveInteger(requestOptions.ttlMs ?? ttlMs, "ttlMs");
    makeRoom();

    let id = idFactory();
    if (typeof id !== "string" || id.trim() === "") {
      throw new Error(`idFactory returned an unusable id: ${describeValue(id)}`);
    }
    let attempts = 0;
    while (records.has(id)) {
      attempts += 1;
      if (attempts > 32) {
        throw new Error("idFactory keeps returning an id that is already in use");
      }
      id = idFactory();
    }

    const createdAtMs = now();
    const entry: Entry = {
      id,
      command: checked,
      createdAtMs,
      expiresAtMs: createdAtMs + requestTtl,
      approvedAtMs: null,
      state: "pending",
    };
    records.set(id, entry);
    return snapshot(entry);
  }

  function approve(id: string): ApproveResult {
    const checked = checkId(id);
    const entry = records.get(checked);
    if (entry === undefined) {
      return { ok: false, reason: "unknown" };
    }
    if (entry.state === "consumed") {
      return { ok: false, reason: "reused" };
    }
    const atMs = now();
    settle(entry, atMs);
    if (entry.state === "expired") {
      return { ok: false, reason: "expired" };
    }
    if (entry.state === "approved") {
      return { ok: false, reason: "already-approved" };
    }

    entry.state = "approved";
    entry.approvedAtMs = atMs;
    return { ok: true, request: snapshot(entry) };
  }

  function consume(id: string): ConsumeResult {
    const checked = checkId(id);
    const entry = records.get(checked);
    if (entry === undefined) {
      return { ok: false, reason: "unknown" };
    }
    if (entry.state === "consumed") {
      return { ok: false, reason: "reused" };
    }
    settle(entry, now());
    if (entry.state === "expired") {
      return { ok: false, reason: "expired" };
    }
    if (entry.state !== "approved") {
      return { ok: false, reason: "not-approved" };
    }

    // Burn the id before returning the command: if this line is reached twice,
    // the second call sees `consumed` and gets `reused`.
    entry.state = "consumed";
    return { ok: true, command: entry.command };
  }

  function inspect(id: string): ElevationView | undefined {
    const checked = checkId(id);
    const entry = records.get(checked);
    if (entry === undefined) return undefined;
    settle(entry, now());
    return snapshot(entry);
  }

  function list(): readonly ElevationView[] {
    const atMs = now();
    const views: ElevationView[] = [];
    for (const entry of records.values()) {
      settle(entry, atMs);
      views.push(snapshot(entry));
    }
    return Object.freeze(views);
  }

  return { request, approve, consume, inspect, list };
}

/** The process-wide store behind the standalone functions below. */
let sharedStore: ElevationStore | undefined;

function defaultStore(): ElevationStore {
  sharedStore ??= createElevationStore();
  return sharedStore;
}

/** Ask for approval of `command`; the returned `id` is the one-time handle. */
export function requestElevation(
  command: string,
  options?: ElevationRequestOptions,
): ElevationRequest {
  return defaultStore().request(command, options);
}

/** Approve a pending id once. A second approval is refused, not silent. */
export function approveElevation(id: string): ApproveResult {
  return defaultStore().approve(id);
}

/** Take the command for an approved id, once. The id is dead afterwards. */
export function consumeElevation(id: string): ConsumeResult {
  return defaultStore().consume(id);
}
