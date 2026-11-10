import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_INTERVAL_MS,
  MAX_MISS_THRESHOLD,
  MIN_INTERVAL_MS,
  MIN_MISS_THRESHOLD,
  clampPolicy,
  isPeerStale,
  nextBeatAt,
  type HeartbeatPolicy,
} from "./heartbeat.js";

/** Een policy die al binnen de grenzen valt. */
const VALID: HeartbeatPolicy = { intervalMs: 5_000, missThreshold: 3 };

describe("clampPolicy", () => {
  it("laat een policy binnen de grenzen ongemoeid", () => {
    assert.deepEqual(clampPolicy({ intervalMs: 5_000, missThreshold: 3 }), VALID);
  });

  it("klemt intervalMs aan beide kanten", () => {
    assert.equal(clampPolicy({ intervalMs: 0, missThreshold: 3 }).intervalMs, MIN_INTERVAL_MS);
    assert.equal(clampPolicy({ intervalMs: 999, missThreshold: 3 }).intervalMs, MIN_INTERVAL_MS);
    assert.equal(clampPolicy({ intervalMs: 1, missThreshold: 3 }).intervalMs, MIN_INTERVAL_MS);
    assert.equal(clampPolicy({ intervalMs: 60_001, missThreshold: 3 }).intervalMs, MAX_INTERVAL_MS);
    assert.equal(
      clampPolicy({ intervalMs: 10_000_000, missThreshold: 3 }).intervalMs,
      MAX_INTERVAL_MS,
    );
    // Precies op de grenzen blijft staan.
    assert.equal(clampPolicy({ intervalMs: 1_000, missThreshold: 3 }).intervalMs, 1_000);
    assert.equal(clampPolicy({ intervalMs: 60_000, missThreshold: 3 }).intervalMs, 60_000);
  });

  it("klemt missThreshold aan beide kanten", () => {
    assert.equal(clampPolicy({ intervalMs: 5_000, missThreshold: 1 }).missThreshold, MIN_MISS_THRESHOLD);
    assert.equal(clampPolicy({ intervalMs: 5_000, missThreshold: 0 }).missThreshold, MIN_MISS_THRESHOLD);
    assert.equal(clampPolicy({ intervalMs: 5_000, missThreshold: -3 }).missThreshold, MIN_MISS_THRESHOLD);
    assert.equal(clampPolicy({ intervalMs: 5_000, missThreshold: 11 }).missThreshold, MAX_MISS_THRESHOLD);
    assert.equal(clampPolicy({ intervalMs: 5_000, missThreshold: 99 }).missThreshold, MAX_MISS_THRESHOLD);
    assert.equal(clampPolicy({ intervalMs: 5_000, missThreshold: 2 }).missThreshold, 2);
    assert.equal(clampPolicy({ intervalMs: 5_000, missThreshold: 10 }).missThreshold, 10);
  });

  it("klemt beide velden onafhankelijk", () => {
    assert.deepEqual(clampPolicy({ intervalMs: 10, missThreshold: 50 }), {
      intervalMs: MIN_INTERVAL_MS,
      missThreshold: MAX_MISS_THRESHOLD,
    });
  });

  it("noemt het veld en de waarde in de foutmelding", () => {
    assert.throws(() => clampPolicy({ intervalMs: "5000", missThreshold: 3 }), /intervalMs/);
    assert.throws(() => clampPolicy({ intervalMs: "5000", missThreshold: 3 }), /"5000"/);
    assert.throws(() => clampPolicy({ intervalMs: 5_000, missThreshold: "3" }), /missThreshold/);
    assert.throws(() => clampPolicy({ intervalMs: 5_000, missThreshold: "3" }), /"3"/);
    assert.throws(() => clampPolicy({ intervalMs: null, missThreshold: 3 }), /intervalMs: .*null/);
    assert.throws(() => clampPolicy({ intervalMs: 5_000 }), /missThreshold: .*undefined/);
    assert.throws(() => clampPolicy({ missThreshold: 3 }), /intervalMs: .*undefined/);
  });

  it("weigert NaN en Infinity, met veldnaam", () => {
    assert.throws(() => clampPolicy({ intervalMs: Number.NaN, missThreshold: 3 }), /intervalMs/);
    assert.throws(
      () => clampPolicy({ intervalMs: Number.POSITIVE_INFINITY, missThreshold: 3 }),
      /intervalMs: .*Infinity/,
    );
    assert.throws(
      () => clampPolicy({ intervalMs: 5_000, missThreshold: Number.NEGATIVE_INFINITY }),
      /missThreshold: .*-Infinity/,
    );
  });

  it("weigert invoer die geen object is", () => {
    for (const bad of [null, undefined, 42, "policy", true, [1, 2]] as unknown[]) {
      assert.throws(() => clampPolicy(bad), /heartbeat policy: expected an object/);
    }
  });
});

describe("isPeerStale", () => {
  // interval 5000 * 3 = 15000 ms is de grens.
  const policy = VALID;

  it("is niet stale vlak voor de grens en precies erop wel", () => {
    const last = 1_000_000;
    assert.equal(isPeerStale(last, last + 14_999, policy), false);
    assert.equal(isPeerStale(last, last + 15_000, policy), true);
    assert.equal(isPeerStale(last, last + 15_001, policy), true);
  });

  it("is vers als er net een teken van leven was", () => {
    const last = 1_000_000;
    assert.equal(isPeerStale(last, last, policy), false);
    assert.equal(isPeerStale(last, last + 1, policy), false);
  });

  it("behandelt een lastSeenAt in de toekomst als niet-stale", () => {
    const last = 1_000_000;
    assert.equal(isPeerStale(last, last - 1, policy), false);
    assert.equal(isPeerStale(last, last - 1_000_000, policy), false);
  });

  it("respecteert de missThreshold-grens per policy", () => {
    const last = 0;
    const lenient: HeartbeatPolicy = { intervalMs: 1_000, missThreshold: 10 };
    const strict: HeartbeatPolicy = { intervalMs: 1_000, missThreshold: 2 };
    assert.equal(isPeerStale(last, 9_999, lenient), false);
    assert.equal(isPeerStale(last, 10_000, lenient), true);
    assert.equal(isPeerStale(last, 1_999, strict), false);
    assert.equal(isPeerStale(last, 2_000, strict), true);
  });

  it("is niet-stale bij een niet-eindige tijd", () => {
    assert.equal(isPeerStale(0, Number.NaN, policy), false);
  });
});

describe("nextBeatAt", () => {
  it("telt precies één interval bij nu op", () => {
    assert.equal(nextBeatAt(1_000_000, VALID), 1_005_000);
    assert.equal(nextBeatAt(0, VALID), 5_000);
    assert.equal(nextBeatAt(0, { intervalMs: 1_000, missThreshold: 2 }), 1_000);
    assert.equal(nextBeatAt(0, { intervalMs: 60_000, missThreshold: 10 }), 60_000);
  });

  it("is onafhankelijk van missThreshold", () => {
    const now = 123_456;
    assert.equal(
      nextBeatAt(now, { intervalMs: 7_500, missThreshold: 2 }),
      nextBeatAt(now, { intervalMs: 7_500, missThreshold: 10 }),
    );
  });
});
