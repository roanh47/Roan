import os from "node:os";
import path from "node:path";
import { VERSION } from "../version.js";
import { resolvePaths } from "./paths.js";

/**
 * A small, safe snapshot of the daemon: is it up, how far is the chain, who is
 * connected, where does it keep its data and for how long has it been running.
 *
 * This is the shape the `health` control request answers with. It is built
 * field by field in `describeHealth`, so a caller's extra properties — an
 * identity, a config object with a provider key — can never ride along. There
 * is no field for a token or a key here, and there must never be one; a health
 * reply may be pasted into an issue without leaking anything.
 */
export interface Health {
  /** When the snapshot was taken, ISO-8601. */
  readonly checkedAt: string;
  readonly version: string;
  /** Chain id, or null while this machine is still onboarding. */
  readonly chain: string | null;
  /** This machine's node id, or null while onboarding. */
  readonly node: string | null;
  /** Highest seq in the chain; 0 on an empty chain or while onboarding. */
  readonly head: number;
  /** Number of distinct peers currently known. */
  readonly peers: number;
  readonly peerIds: readonly string[];
  /** Path under the home directory, rewritten to `~/...` where possible. */
  readonly dataPath: string;
  readonly homeCollapsed: boolean;
  /** Whole seconds since the daemon started. */
  readonly uptimeSeconds: number;
}

export interface HealthInput {
  /** Defaults to the app's single `VERSION` constant from `src/version.ts`. */
  readonly version?: string;
  /** Defaults to 0, which is also the honest answer for an empty chain. */
  readonly head?: number;
  readonly peers?: readonly string[];
  /** Defaults to the Roan home directory. */
  readonly dataPath?: string;
  readonly chain?: string | null;
  readonly node?: string | null;
  /** Epoch ms when the daemon started; used when `uptimeSeconds` is absent. */
  readonly startedAt?: number;
  /** Epoch ms "now", for deterministic uptime in tests. */
  readonly now?: number;
  /** Explicit uptime override; wins over `startedAt`/`now`. */
  readonly uptimeSeconds?: number;
}

export interface CollapsedPath {
  readonly path: string;
  readonly homeCollapsed: boolean;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    // Not echoed: these fields can be handed the wrong object entirely, and a
    // health error must not be the place a token first appears in a log.
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function optionalText(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  return requireText(value, field);
}

function requireCount(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer, got ${String(value)}`);
  }
  return value;
}

function requireTimestamp(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite epoch timestamp, got ${String(value)}`);
  }
  return value;
}

/** Peer ids are node ids, never tokens. Anything else is refused by name. */
function requirePeers(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    throw new Error("peers must be an array of node ids");
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const peer of value) {
    if (typeof peer !== "string" || peer.trim().length === 0) {
      // The value is not echoed: a caller may have handed us a whole identity
      // object, and its token must not end up in an error line or a log.
      throw new Error("peers must contain non-empty node ids");
    }
    if (seen.has(peer)) continue;
    seen.add(peer);
    out.push(peer);
  }
  return out;
}

/**
 * Rewrites a path under the home directory to `~/...`; reports whether it did.
 * A path outside home is returned unchanged, never guessed at. Both separators
 * are checked because a daemon on Windows may report a path with `/`.
 */
export function collapseHomePath(target: string): CollapsedPath {
  if (target.length === 0) return { path: target, homeCollapsed: false };
  const sep = path.sep;
  let home = os.homedir();
  if (home.endsWith(sep)) home = home.slice(0, -sep.length);
  if (home.length === 0) return { path: target, homeCollapsed: false };
  if (target === home) return { path: "~", homeCollapsed: true };
  for (const prefix of [`${home}${sep}`, `${home}/`, `${home}\\`]) {
    if (target.startsWith(prefix)) return { path: `~${target.slice(home.length)}`, homeCollapsed: true };
  }
  return { path: target, homeCollapsed: false };
}

function resolveUptime(input: HealthInput): number {
  if (input.uptimeSeconds !== undefined) {
    if (typeof input.uptimeSeconds !== "number" || !Number.isFinite(input.uptimeSeconds) || input.uptimeSeconds < 0) {
      throw new Error(`uptimeSeconds must be a non-negative number, got ${String(input.uptimeSeconds)}`);
    }
    return Math.floor(input.uptimeSeconds);
  }
  if (input.startedAt !== undefined) {
    const startedAt = requireTimestamp(input.startedAt, "startedAt");
    const now = input.now === undefined ? Date.now() : requireTimestamp(input.now, "now");
    return Math.max(0, Math.floor((now - startedAt) / 1000));
  }
  return Math.floor(process.uptime());
}

/**
 * Builds the health snapshot. Reads only the fields declared on `HealthInput`;
 * unknown properties are ignored, so passing an `Identity` or settings object
 * can not copy `token`, `apiKey` or anything else into the result.
 */
export function describeHealth(input: HealthInput): Health {
  if (typeof input !== "object" || input === null) {
    throw new Error("health input must be an object");
  }
  const version = input.version === undefined ? VERSION : requireText(input.version, "version");
  const head = input.head === undefined ? 0 : requireCount(input.head, "head");
  const peerIds = requirePeers(input.peers ?? []);
  const requested = requireText(input.dataPath ?? resolvePaths().home, "dataPath");
  const collapsed = collapseHomePath(requested);
  return {
    checkedAt: new Date().toISOString(),
    version,
    chain: optionalText(input.chain, "chain"),
    node: optionalText(input.node, "node"),
    head,
    peers: peerIds.length,
    peerIds,
    dataPath: collapsed.path,
    homeCollapsed: collapsed.homeCollapsed,
    uptimeSeconds: resolveUptime(input),
  };
}
