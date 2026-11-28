import type { ComputerGrant, GrantCheck, GrantSessionOptions, GrantStore } from "./grant.js";
import { DEFAULT_GRANT_TTL_MS } from "./grant.js";

/**
 * Computer use permissions as a synced setting.
 *
 * A permission is "this conversation may use the computer until this
 * moment". It is kept in the config as conversation → end time, so it is the
 * same on every device: the owner allows it on the phone in their hand, and
 * the desktop that is being controlled sees it. Taking it back removes the
 * entry, and an entry whose time has passed counts as expired without anyone
 * having to clean it up.
 *
 * This is the same `GrantStore` the actions already check, with the map read
 * and written through the caller, who saves and publishes it.
 */
export function settingsGrantStore(
  read: () => Readonly<Record<string, number>>,
  write: (grants: Record<string, number>) => void,
  now: () => number = Date.now,
): GrantStore {
  /** The map without entries that ended, so the config does not grow. */
  const live = (): Record<string, number> => {
    const kept: Record<string, number> = {};
    for (const [session, until] of Object.entries(read())) {
      if (until > now()) kept[session] = until;
    }
    return kept;
  };

  const check = (sessionId: string): GrantCheck => {
    const until = read()[sessionId];
    if (until === undefined) return { granted: false, reason: "no-grant" };
    if (until <= now()) return { granted: false, reason: "expired" };
    return { granted: true, grant: { sessionId, grantedAtMs: now(), expiresAtMs: until } };
  };

  return {
    grantSession(sessionId: string, options?: GrantSessionOptions): ComputerGrant {
      if (sessionId.trim().length === 0) throw new Error("a computer use permission needs a conversation");
      const ttl = options?.ttlMs ?? DEFAULT_GRANT_TTL_MS;
      if (!(ttl > 0)) throw new Error("a computer use permission needs a duration above zero");
      const grantedAtMs = now();
      const expiresAtMs = grantedAtMs + ttl;
      write({ ...live(), [sessionId]: expiresAtMs });
      return { sessionId, grantedAtMs, expiresAtMs };
    },
    isGranted: (sessionId) => check(sessionId).granted,
    check,
    revokeSession(sessionId: string): boolean {
      const wasLive = check(sessionId).granted;
      const kept = live();
      delete kept[sessionId];
      write(kept);
      return wasLive;
    },
    list(): readonly ComputerGrant[] {
      return Object.entries(live())
        .map(([sessionId, expiresAtMs]) => ({ sessionId, grantedAtMs: now(), expiresAtMs }))
        .sort((a, b) => a.expiresAtMs - b.expiresAtMs);
    },
  };
}
