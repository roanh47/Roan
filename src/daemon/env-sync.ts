import { existsSync } from "node:fs";
import type { EventStore } from "../chain/store.js";
import { applyEnvSnapshot } from "../env/apply.js";
import { packEnv } from "../env/pack.js";
import type { EnvSnapshot } from "../env/types.js";
import type { Event } from "../protocol/types.js";

/**
 * The agent travels with the chain.
 *
 * `~/.roan` holds the part of Roan that is the same everywhere: AGENTS.md,
 * USER.md, MEMORY.md, config.json, `memory/`, `skills/` and `mcp/`. That is not
 * a place you fetch from — every device keeps its own copy on its own disk, and
 * the chain is how the copies stay equal.
 *
 * The rule is one-way per change: whoever edited last writes a snapshot event,
 * everyone else applies it. Applying is a local file write, so a device that is
 * offline keeps working and catches up when it can reach a peer.
 */
const CHAIN_EVENT = "env";

interface EnvEventData {
  readonly snapshot: EnvSnapshot;
}

function readSnapshot(event: Event): EnvSnapshot | null {
  const data = event.data;
  if (typeof data !== "object" || data === null) return null;
  const snapshot = (data as Partial<EnvEventData>).snapshot;
  if (typeof snapshot !== "object" || snapshot === null) return null;
  const hash = (snapshot as { hash?: unknown }).hash;
  return typeof hash === "string" ? (snapshot as EnvSnapshot) : null;
}

/** The newest env snapshot in the chain, or null when nobody has published one. */
export function latestEnv(store: EventStore, chain: string): EnvSnapshot | null {
  const head = store.head(chain);
  if (head === 0) return null;
  const tail = store.read(chain, Math.max(1, head - 199), 200);
  for (let i = tail.length - 1; i >= 0; i -= 1) {
    const event = tail[i];
    if (event === undefined || event.type !== CHAIN_EVENT) continue;
    const snapshot = readSnapshot(event);
    if (snapshot !== null) return snapshot;
  }
  return null;
}

export interface PublishOptions {
  readonly store: EventStore;
  readonly chain: string;
  readonly node: string;
  readonly home: string;
}

/**
 * Writes this device's env into the chain, but only when it actually changed.
 *
 * Comparing hashes matters: without it every start of every daemon appends a
 * snapshot, and the chain fills with identical copies of the same nine files.
 */
export async function publishEnv(
  options: PublishOptions,
): Promise<{ published: boolean; hash: string }> {
  const snapshot = await packEnv({
    home: options.home,
    chainId: options.chain,
    nodeId: options.node,
  });
  const current = latestEnv(options.store, options.chain);
  if (current !== null && current.hash === snapshot.hash) {
    return { published: false, hash: snapshot.hash };
  }
  options.store.append(options.chain, {
    // The id is the content, not the author: two devices that publish the same
    // env at the same moment then dedupe as duplicates instead of colliding on
    // a sequence number with two different ids.
    id: `env-${snapshot.hash}`,
    node: options.node,
    type: CHAIN_EVENT,
    data: { snapshot },
  });
  return { published: true, hash: snapshot.hash };
}

/** Applies an `env` event that just arrived from a peer or from the backfill. */
export async function adoptEnvEvent(event: Event, home: string): Promise<boolean> {
  if (event.type !== CHAIN_EVENT) return false;
  const snapshot = readSnapshot(event);
  if (snapshot === null) return false;
  const result = await adoptEnv(snapshot, home);
  return result.applied;
}

/** Applies a snapshot that arrived from anywhere — peer, backfill, or this device. */
export async function adoptEnv(
  snapshot: EnvSnapshot,
  home: string,
): Promise<{ applied: boolean; hash: string }> {
  if (!existsSync(home)) return { applied: false, hash: snapshot.hash };
  const result = await applyEnvSnapshot(snapshot, { home });
  return { applied: result.applied, hash: result.hash };
}
