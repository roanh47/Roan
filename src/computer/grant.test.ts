import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createGrantStore, DEFAULT_GRANT_TTL_MS } from "./grant.js";

/**
 * Rule under test: computer control is granted per session, expires on its own,
 * and stays revoked once revoked.
 *
 * Time is a plain closure here, not a timer: expiry must be provable without
 * waiting, so every test owns a mutable `t` it moves by hand.
 */

const SESSION = "session-1";
const OTHER = "session-2";
const T0 = 1_700_000_000_000;

function steppingClock(start = T0): { now: () => number; advance: (ms: number) => void } {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe("computer grant store", () => {
  it("grants a session and reports it live with its window", () => {
    const clock = steppingClock();
    const grants = createGrantStore({ now: clock.now });

    const grant = grants.grantSession(SESSION);

    assert.equal(grant.sessionId, SESSION);
    assert.equal(grant.grantedAtMs, T0);
    assert.equal(grant.expiresAtMs, T0 + DEFAULT_GRANT_TTL_MS);
    assert.equal(grants.isGranted(SESSION), true);

    const check = grants.check(SESSION);
    assert.equal(check.granted, true);
    if (!check.granted) assert.fail("unreachable");
    assert.deepEqual(check.grant, grant);
  });

  it("refuses a session that was never granted, with reason no-grant", () => {
    const grants = createGrantStore({ now: steppingClock().now });

    const check = grants.check(SESSION);

    assert.equal(check.granted, false);
    if (check.granted) assert.fail("unreachable");
    assert.equal(check.reason, "no-grant");
    assert.equal(grants.isGranted(SESSION), false);
  });

  it("expires a grant when its ttl passes", () => {
    const clock = steppingClock();
    const grants = createGrantStore({ now: clock.now });

    grants.grantSession(SESSION, { ttlMs: 1_000 });
    clock.advance(999);
    assert.equal(grants.isGranted(SESSION), true);

    clock.advance(1);
    const check = grants.check(SESSION);
    assert.equal(check.granted, false);
    if (check.granted) assert.fail("unreachable");
    assert.equal(check.reason, "expired");
  });

  it("keeps reporting expired rather than flipping back after a re-check", () => {
    const clock = steppingClock();
    const grants = createGrantStore({ now: clock.now });

    grants.grantSession(SESSION, { ttlMs: 10 });
    clock.advance(10);

    assert.equal(grants.isGranted(SESSION), false);
    clock.advance(1_000);
    const check = grants.check(SESSION);
    assert.equal(check.granted, false);
    if (check.granted) assert.fail("unreachable");
    assert.equal(check.reason, "expired");
  });

  it("makes the session live again when it is granted after expiry", () => {
    const clock = steppingClock();
    const grants = createGrantStore({ now: clock.now });

    grants.grantSession(SESSION, { ttlMs: 10 });
    clock.advance(10);
    assert.equal(grants.isGranted(SESSION), false);

    const regranted = grants.grantSession(SESSION, { ttlMs: 10 });

    assert.equal(regranted.grantedAtMs, T0 + 10);
    assert.equal(grants.isGranted(SESSION), true);
  });

  it("honours a per-grant ttl that is shorter than the store default", () => {
    const clock = steppingClock();
    const grants = createGrantStore({ now: clock.now, ttlMs: DEFAULT_GRANT_TTL_MS });

    const grant = grants.grantSession(SESSION, { ttlMs: 250 });

    assert.equal(grant.expiresAtMs, T0 + 250);
    clock.advance(250);
    assert.equal(grants.isGranted(SESSION), false);
  });

  it("revokes a live grant and leaves a tombstone, so the reason is revoked", () => {
    const clock = steppingClock();
    const grants = createGrantStore({ now: clock.now });

    grants.grantSession(SESSION);

    assert.equal(grants.revokeSession(SESSION), true);
    assert.equal(grants.isGranted(SESSION), false);

    const check = grants.check(SESSION);
    assert.equal(check.granted, false);
    if (check.granted) assert.fail("unreachable");
    assert.equal(check.reason, "revoked");
  });

  it("does not resurrect a revoked grant when the clock moves on", () => {
    const clock = steppingClock();
    const grants = createGrantStore({ now: clock.now, ttlMs: 1_000 });

    grants.grantSession(SESSION);
    grants.revokeSession(SESSION);
    clock.advance(10_000);

    const check = grants.check(SESSION);
    assert.equal(check.granted, false);
    if (check.granted) assert.fail("unreachable");
    assert.equal(check.reason, "revoked");
  });

  it("makes a revoked session live again only through a new grant", () => {
    const clock = steppingClock();
    const grants = createGrantStore({ now: clock.now });

    grants.grantSession(SESSION);
    grants.revokeSession(SESSION);
    grants.grantSession(SESSION);

    assert.equal(grants.isGranted(SESSION), true);
  });

  it("returns false when revoking a session that was never granted", () => {
    const grants = createGrantStore({ now: steppingClock().now });

    assert.equal(grants.revokeSession(OTHER), false);
    assert.equal(grants.isGranted(OTHER), false);
  });

  it("returns false when revoking an already expired grant", () => {
    const clock = steppingClock();
    const grants = createGrantStore({ now: clock.now });

    grants.grantSession(SESSION, { ttlMs: 5 });
    clock.advance(5);

    assert.equal(grants.revokeSession(SESSION), false);
    // The tombstone wins: the honest reason is still "you turned it off".
    const check = grants.check(SESSION);
    if (check.granted) assert.fail("unreachable");
    assert.equal(check.reason, "revoked");
  });

  it("isolates one session from another", () => {
    const grants = createGrantStore({ now: steppingClock().now });

    grants.grantSession(SESSION);
    grants.revokeSession(OTHER);

    assert.equal(grants.isGranted(SESSION), true);
    assert.equal(grants.isGranted(OTHER), false);
  });

  it("isolates separate stores from each other", () => {
    const clock = steppingClock();
    const a = createGrantStore({ now: clock.now });
    const b = createGrantStore({ now: clock.now });

    a.grantSession(SESSION);

    assert.equal(a.isGranted(SESSION), true);
    assert.equal(b.isGranted(SESSION), false);
  });

  it("lists only the grants that are still live", () => {
    const clock = steppingClock();
    const grants = createGrantStore({ now: clock.now });

    grants.grantSession("live-1");
    grants.grantSession("short", { ttlMs: 10 });
    grants.grantSession("revoked");
    grants.revokeSession("revoked");
    clock.advance(10);

    const listed = grants.list().map((grant) => grant.sessionId);
    assert.deepEqual(listed, ["live-1"]);
  });

  it("prunes settled tombstones to make room for a new session", () => {
    const clock = steppingClock();
    const grants = createGrantStore({ now: clock.now, maxSessions: 2 });

    grants.grantSession("a", { ttlMs: 10 });
    grants.grantSession("b");
    clock.advance(10);

    // "a" expired, so it may be dropped and "c" fits.
    grants.grantSession("c");
    assert.equal(grants.isGranted("c"), true);
    assert.equal(grants.isGranted("b"), true);
  });

  it("refuses to grant when every retained session still holds a live grant", () => {
    const grants = createGrantStore({ now: steppingClock().now, maxSessions: 2 });

    grants.grantSession("a");
    grants.grantSession("b");

    assert.throws(() => grants.grantSession("c"), /grant store is full/);
  });

  it("rejects an unusable session id", () => {
    const grants = createGrantStore({ now: steppingClock().now });

    assert.throws(() => grants.grantSession(""), /non-empty string/);
    assert.throws(() => grants.grantSession("   "), /non-empty string/);
    assert.throws(() => grants.grantSession("a\0b"), /NUL/);
    assert.throws(() => grants.check(""), /non-empty string/);
  });

  it("rejects a ttl or capacity that is not a positive integer", () => {
    assert.throws(() => createGrantStore({ ttlMs: 0 }), /positive integer/);
    assert.throws(() => createGrantStore({ ttlMs: -5 }), /positive integer/);
    assert.throws(() => createGrantStore({ ttlMs: 1.5 }), /positive integer/);
    assert.throws(() => createGrantStore({ maxSessions: 0 }), /positive integer/);

    const grants = createGrantStore({ now: steppingClock().now });
    assert.throws(() => grants.grantSession(SESSION, { ttlMs: 0 }), /positive integer/);
  });
});
