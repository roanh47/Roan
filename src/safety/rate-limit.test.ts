import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_BURST,
  MAX_PER_MINUTE,
  MIN_BURST,
  MIN_PER_MINUTE,
  clampRateLimitConfig,
  createLimiter,
  describeLimiter,
  type Limiter,
} from "./rate-limit.js";

/** Een vaste tijd; de limiter leest zelf nooit de klok. */
const T0 = 1_000_000;

describe("createLimiter", () => {
  it("geeft eerst een volle burst en weigert daarna", () => {
    const limiter = createLimiter({ perMinute: 60, burst: 3 });

    assert.deepEqual(limiter.take("search", T0), { ok: true, waitMs: 0, remaining: 2 });
    assert.deepEqual(limiter.take("search", T0), { ok: true, waitMs: 0, remaining: 1 });
    assert.deepEqual(limiter.take("search", T0), { ok: true, waitMs: 0, remaining: 0 });
    assert.deepEqual(limiter.take("search", T0), { ok: false, waitMs: 1_000, remaining: 0 });
  });

  it("zegt hoe lang wachten tot één token weer vrij is", () => {
    const limiter = createLimiter({ perMinute: 60, burst: 1 });
    assert.equal(limiter.take("fetch", T0).ok, true);
    // 60 per minuut is precies één token per 1000 ms.
    assert.deepEqual(limiter.take("fetch", T0 + 1), { ok: false, waitMs: 999, remaining: 0 });
    assert.deepEqual(limiter.take("fetch", T0 + 999), { ok: false, waitMs: 1, remaining: 0 });
    assert.deepEqual(limiter.take("fetch", T0 + 1_000), { ok: true, waitMs: 0, remaining: 0 });
  });

  it("vult bij na verstreken tijd, niet eerder", () => {
    const limiter = createLimiter({ perMinute: 120, burst: 2 });
    assert.equal(limiter.take("db", T0).ok, true);
    assert.equal(limiter.take("db", T0).ok, true);
    // 120 per minuut = één token per 500 ms.
    assert.deepEqual(limiter.take("db", T0 + 499), { ok: false, waitMs: 1, remaining: 0 });
    assert.deepEqual(limiter.take("db", T0 + 500), { ok: true, waitMs: 0, remaining: 0 });
    assert.equal(limiter.take("db", T0 + 500).ok, false);
    assert.equal(limiter.take("db", T0 + 1_000).ok, true);
  });

  it("houdt buckets per toolnaam gescheiden", () => {
    const limiter = createLimiter({ perMinute: 60, burst: 2 });
    assert.equal(limiter.take("alpha", T0).ok, true);
    assert.equal(limiter.take("alpha", T0).ok, true);
    assert.equal(limiter.take("alpha", T0).ok, false);
    // Een andere tool heeft zijn eigen, verse bucket.
    assert.deepEqual(limiter.take("beta", T0), { ok: true, waitMs: 0, remaining: 1 });
    assert.deepEqual(limiter.take("beta", T0), { ok: true, waitMs: 0, remaining: 0 });
    assert.equal(limiter.take("beta", T0).ok, false);
    // En alpha blijft leeg.
    assert.equal(limiter.take("alpha", T0).ok, false);
  });

  it("maakt een bucket pas lui aan en start hem vol", () => {
    const limiter = createLimiter({ perMinute: 60, burst: 2 });
    // Ruim later eerste gebruik: de bucket heeft niet buiten gebruik opgespaard
    // en ook niets verloren; hij begint gewoon vol.
    assert.deepEqual(limiter.take("late", T0 + 86_400_000), {
      ok: true,
      waitMs: 0,
      remaining: 1,
    });
  });

  it("spaart niet verder op dan een volle bucket", () => {
    const limiter = createLimiter({ perMinute: 60, burst: 2 });
    assert.equal(limiter.take("cache", T0).ok, true);
    assert.equal(limiter.take("cache", T0).ok, true);
    // Een uur later is de bucket vol (2), niet 62.
    assert.deepEqual(limiter.take("cache", T0 + 3_600_000), {
      ok: true,
      waitMs: 0,
      remaining: 1,
    });
    assert.equal(limiter.take("cache", T0 + 3_600_000).ok, true);
    assert.equal(limiter.take("cache", T0 + 3_600_000).ok, false);
  });

  it("geeft geen tokens bij een tijd die terugloopt", () => {
    const limiter = createLimiter({ perMinute: 60, burst: 1 });
    assert.equal(limiter.take("skew", T0).ok, true);
    // Klokschommeling: nu ligt vóór de vorige aanroep.
    assert.equal(limiter.take("skew", T0 - 5_000).ok, false);
    assert.equal(limiter.take("skew", T0 + 999).ok, false);
    assert.equal(limiter.take("skew", T0 + 1_000).ok, true);
  });

  it("weigert een lege of niet-tekstuele toolnaam, met veldnaam", () => {
    const limiter = createLimiter({ perMinute: 60, burst: 1 });
    assert.throws(() => limiter.take("", T0), /rate limit tool/);
    assert.throws(() => limiter.take(42 as unknown as string, T0), /rate limit tool: .*42/);
    assert.throws(() => limiter.take("x", Number.NaN), /rate limit nowMs/);
    assert.throws(() => limiter.take("x", Number.POSITIVE_INFINITY), /rate limit nowMs/);
  });

  it("werkt met een limiter die aan de bovengrens staat", () => {
    const limiter = createLimiter({ perMinute: MAX_PER_MINUTE, burst: MAX_BURST });
    assert.equal(limiter.perMinute, MAX_PER_MINUTE);
    assert.equal(limiter.burst, MAX_BURST);
    for (let i = 0; i < MAX_BURST; i += 1) {
      assert.equal(limiter.take("bulk", T0).ok, true);
    }
    assert.equal(limiter.take("bulk", T0).ok, false);
    // 6000 per minuut = één token per 10 ms.
    assert.equal(limiter.take("bulk", T0).waitMs, 10);
    assert.equal(limiter.take("bulk", T0 + 10).ok, true);
  });
});

describe("clampRateLimitConfig", () => {
  it("laat een config binnen de grenzen ongemoeid", () => {
    assert.deepEqual(clampRateLimitConfig({ perMinute: 60, burst: 10 }), {
      perMinute: 60,
      burst: 10,
    });
  });

  it("klemt perMinute op 1..6000", () => {
    assert.equal(clampRateLimitConfig({ perMinute: 0, burst: 1 }).perMinute, MIN_PER_MINUTE);
    assert.equal(clampRateLimitConfig({ perMinute: 0.5, burst: 1 }).perMinute, MIN_PER_MINUTE);
    assert.equal(clampRateLimitConfig({ perMinute: 1, burst: 1 }).perMinute, MIN_PER_MINUTE);
    assert.equal(clampRateLimitConfig({ perMinute: 6_000, burst: 1 }).perMinute, MAX_PER_MINUTE);
    assert.equal(clampRateLimitConfig({ perMinute: 6_001, burst: 1 }).perMinute, MAX_PER_MINUTE);
    assert.equal(clampRateLimitConfig({ perMinute: 1e9, burst: 1 }).perMinute, MAX_PER_MINUTE);
  });

  it("klemt burst op 1..1000", () => {
    assert.equal(clampRateLimitConfig({ perMinute: 60, burst: 0 }).burst, MIN_BURST);
    assert.equal(clampRateLimitConfig({ perMinute: 60, burst: 1 }).burst, MIN_BURST);
    assert.equal(clampRateLimitConfig({ perMinute: 60, burst: 1_000 }).burst, MAX_BURST);
    assert.equal(clampRateLimitConfig({ perMinute: 60, burst: 1_001 }).burst, MAX_BURST);
    assert.equal(clampRateLimitConfig({ perMinute: 60, burst: 99_999 }).burst, MAX_BURST);
  });

  it("laat de geklemde waarden in het gedrag terugzien", () => {
    // perMinute 0 wordt 1: één token per 60_000 ms.
    const slow = createLimiter({ perMinute: 0, burst: 1 });
    assert.equal(slow.take("x", T0).ok, true);
    assert.equal(slow.take("x", T0).waitMs, 60_000);

    // Een enorme perMinute wordt 6000: één token per 10 ms.
    const fast = createLimiter({ perMinute: 100_000, burst: 2 });
    assert.equal(fast.perMinute, MAX_PER_MINUTE);
    assert.equal(fast.take("x", T0).ok, true);
    assert.equal(fast.take("x", T0).ok, true);
    assert.equal(fast.take("x", T0).waitMs, 10);

    // burst 0 wordt 1: na één token is de bucket leeg.
    const single = createLimiter({ perMinute: 60, burst: 0 });
    assert.equal(single.burst, MIN_BURST);
    assert.equal(single.take("x", T0).ok, true);
    assert.equal(single.take("x", T0).ok, false);
  });

  it("weigert een negatieve waarde met de veldnaam erbij", () => {
    assert.throws(
      () => clampRateLimitConfig({ perMinute: -1, burst: 1 }),
      /perMinute: must not be negative, got -1/,
    );
    assert.throws(
      () => clampRateLimitConfig({ perMinute: 60, burst: -10 }),
      /burst: must not be negative, got -10/,
    );
  });

  it("weigert niet-eindige en niet-numerieke waarden, met veld en waarde", () => {
    assert.throws(
      () => clampRateLimitConfig({ perMinute: Number.NaN, burst: 1 }),
      /perMinute: .*NaN/,
    );
    assert.throws(
      () => clampRateLimitConfig({ perMinute: Number.POSITIVE_INFINITY, burst: 1 }),
      /perMinute: .*Infinity/,
    );
    assert.throws(
      () => clampRateLimitConfig({ perMinute: 60, burst: Number.NEGATIVE_INFINITY }),
      /burst: .*-Infinity/,
    );
    assert.throws(() => clampRateLimitConfig({ perMinute: "60", burst: 1 }), /perMinute/);
    assert.throws(() => clampRateLimitConfig({ perMinute: "60", burst: 1 }), /"60"/);
    assert.throws(() => clampRateLimitConfig({ perMinute: 60, burst: null }), /burst: .*null/);
    assert.throws(() => clampRateLimitConfig({ perMinute: 60 }), /burst: .*undefined/);
    assert.throws(() => clampRateLimitConfig({ burst: 1 }), /perMinute: .*undefined/);
  });

  it("weigert invoer die geen object is", () => {
    for (const bad of [null, undefined, 42, "config", true, [1, 2]] as unknown[]) {
      assert.throws(() => clampRateLimitConfig(bad), /rate limit config: expected an object/);
    }
    assert.throws(() => createLimiter(null as unknown), /expected an object/);
  });
});

describe("describeLimiter", () => {
  it("geeft korte Nederlandse beleidsregels", () => {
    const limiter: Limiter = createLimiter({ perMinute: 60, burst: 5 });
    const lines = describeLimiter(limiter);

    assert.ok(lines.length >= 2);
    for (const line of lines) {
      assert.equal(typeof line, "string");
      assert.ok(line.length > 0);
      assert.ok(!line.includes("\n"));
    }
    const text = lines.join("\n");
    assert.match(text, /60/);
    assert.match(text, /milliseconden|ms/);
    assert.match(text, /per minuut/);
  });

  it("noemt het herstelinterval dat bij perMinute hoort", () => {
    assert.match(describeLimiter(createLimiter({ perMinute: 120, burst: 1 })).join("\n"), /500/);
    assert.match(describeLimiter(createLimiter({ perMinute: 1, burst: 1 })).join("\n"), /60000/);
  });

  it("is ook als methode op de limiter beschikbaar", () => {
    const limiter = createLimiter({ perMinute: 30, burst: 2 });
    assert.deepEqual(limiter.describeLimiter(), describeLimiter(limiter));
  });
});
