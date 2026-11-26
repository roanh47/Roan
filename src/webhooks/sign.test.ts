import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_TOLERANCE_SEC,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  createReplayGuard,
  digestBody,
  signBody,
  verifySignature,
} from "./sign.js";

const SECRET = "test-secret-not-real";
const NOW = 1_800_000_000;
const BODY = JSON.stringify({ event: "build.finished", ok: true });

function headersFor(signature: string, extra: Record<string, string> = {}): Record<string, string> {
  return { "content-type": "application/json", [SIGNATURE_HEADER]: signature, ...extra };
}

describe("signBody", () => {
  it("produces the documented t=...,v1=... header", () => {
    const header = signBody(SECRET, BODY, NOW);
    assert.match(header, /^t=1800000000,v1=[0-9a-f]{64}$/u);
    assert.equal(header, `t=${NOW},v1=${digestBody(SECRET, BODY, NOW)}`);
  });

  it("is deterministic for the same input and different across timestamps", () => {
    assert.equal(signBody(SECRET, BODY, NOW), signBody(SECRET, BODY, NOW));
    assert.notEqual(signBody(SECRET, BODY, NOW), signBody(SECRET, BODY, NOW + 1));
  });

  it("changes when the body changes", () => {
    assert.notEqual(signBody(SECRET, BODY, NOW), signBody(SECRET, `${BODY} `, NOW));
  });

  it("rejects an empty secret and a fractional timestamp", () => {
    assert.throws(() => signBody("", BODY, NOW), /non-empty string/u);
    assert.throws(() => signBody(SECRET, BODY, NOW + 0.5), /whole seconds/u);
    assert.throws(() => signBody(SECRET, BODY, -1), /whole seconds/u);
  });
});

describe("verifySignature", () => {
  it("accepts a signature it produced", () => {
    const result = verifySignature(
      headersFor(signBody(SECRET, BODY, NOW)),
      BODY,
      SECRET,
      DEFAULT_TOLERANCE_SEC,
      { nowSec: NOW + 5 },
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.timestampSec, NOW);
    assert.equal(result.digest, digestBody(SECRET, BODY, NOW));
  });

  it("reads headers case-insensitively", () => {
    const result = verifySignature(
      { "X-Roan-Signature": signBody(SECRET, BODY, NOW) },
      BODY,
      SECRET,
      DEFAULT_TOLERANCE_SEC,
      { nowSec: NOW },
    );
    assert.equal(result.ok, true);
  });

  it("accepts a Headers-like object", () => {
    const headers = new Headers({ [SIGNATURE_HEADER]: signBody(SECRET, BODY, NOW) });
    const result = verifySignature(headers, BODY, SECRET, DEFAULT_TOLERANCE_SEC, { nowSec: NOW });
    assert.equal(result.ok, true);
  });

  it("refuses a tampered body", () => {
    const result = verifySignature(
      headersFor(signBody(SECRET, BODY, NOW)),
      `${BODY} `,
      SECRET,
      DEFAULT_TOLERANCE_SEC,
      { nowSec: NOW },
    );
    assert.deepEqual(result, { ok: false, reason: "invalid_signature" });
  });

  it("refuses the right signature under the wrong secret", () => {
    const result = verifySignature(
      headersFor(signBody(SECRET, BODY, NOW)),
      BODY,
      "another-secret-not-real",
      DEFAULT_TOLERANCE_SEC,
      { nowSec: NOW },
    );
    assert.deepEqual(result, { ok: false, reason: "invalid_signature" });
  });

  it("refuses a signature re-dated to look fresh", () => {
    const stale = signBody(SECRET, BODY, NOW - 10_000);
    const reDated = stale.replace(`t=${NOW - 10_000}`, `t=${NOW}`);
    const result = verifySignature(headersFor(reDated), BODY, SECRET, DEFAULT_TOLERANCE_SEC, {
      nowSec: NOW,
    });
    assert.deepEqual(result, { ok: false, reason: "invalid_signature" });
  });

  it("reports a timestamp older than the tolerance as stale", () => {
    const result = verifySignature(
      headersFor(signBody(SECRET, BODY, NOW - 301)),
      BODY,
      SECRET,
      300,
      { nowSec: NOW },
    );
    assert.deepEqual(result, { ok: false, reason: "stale_timestamp" });
  });

  it("reports a timestamp too far ahead as future", () => {
    const result = verifySignature(
      headersFor(signBody(SECRET, BODY, NOW + 301)),
      BODY,
      SECRET,
      300,
      { nowSec: NOW },
    );
    assert.deepEqual(result, { ok: false, reason: "future_timestamp" });
  });

  it("accepts the edge of the window", () => {
    const result = verifySignature(
      headersFor(signBody(SECRET, BODY, NOW - 300)),
      BODY,
      SECRET,
      300,
      { nowSec: NOW },
    );
    assert.equal(result.ok, true);
  });

  it("reports a missing, malformed or incomplete header distinctly", () => {
    assert.deepEqual(verifySignature({}, BODY, SECRET, 300, { nowSec: NOW }), {
      ok: false,
      reason: "missing_signature",
    });
    assert.deepEqual(
      verifySignature(headersFor("banana"), BODY, SECRET, 300, { nowSec: NOW }),
      { ok: false, reason: "malformed_signature" },
    );
    assert.deepEqual(
      verifySignature(headersFor(`t=${NOW},v1=abc`), BODY, SECRET, 300, { nowSec: NOW }),
      { ok: false, reason: "malformed_signature" },
    );
  });

  it("reports a missing timestamp when the header has no t=", () => {
    const digest = digestBody(SECRET, BODY, NOW);
    assert.deepEqual(
      verifySignature(headersFor(`v1=${digest}`), BODY, SECRET, 300, { nowSec: NOW }),
      { ok: false, reason: "missing_timestamp" },
    );
  });

  it("accepts the separate timestamp header when t= is absent", () => {
    const digest = digestBody(SECRET, BODY, NOW);
    const result = verifySignature(
      headersFor(`v1=${digest}`, { [TIMESTAMP_HEADER]: String(NOW) }),
      BODY,
      SECRET,
      300,
      { nowSec: NOW },
    );
    assert.equal(result.ok, true);
  });

  it("rejects a malformed separate timestamp", () => {
    const digest = digestBody(SECRET, BODY, NOW);
    assert.deepEqual(
      verifySignature(headersFor(`v1=${digest}`, { [TIMESTAMP_HEADER]: "soon" }), BODY, SECRET, 300, {
        nowSec: NOW,
      }),
      { ok: false, reason: "malformed_timestamp" },
    );
  });
});

describe("replay protection", () => {
  it("refuses the same signature twice and allows a fresh one", () => {
    const guard = createReplayGuard();
    const headers = headersFor(signBody(SECRET, BODY, NOW));
    const first = verifySignature(headers, BODY, SECRET, 300, { nowSec: NOW, replay: guard });
    assert.equal(first.ok, true);
    const second = verifySignature(headers, BODY, SECRET, 300, { nowSec: NOW + 1, replay: guard });
    assert.deepEqual(second, { ok: false, reason: "replay" });

    const fresh = headersFor(signBody(SECRET, BODY, NOW + 2));
    assert.equal(verifySignature(fresh, BODY, SECRET, 300, { nowSec: NOW + 2, replay: guard }).ok, true);
  });

  it("does not remember a signature that failed verification", () => {
    const guard = createReplayGuard();
    const good = headersFor(signBody(SECRET, BODY, NOW));
    const bad = headersFor(signBody(SECRET, BODY, NOW).replace(/v1=./u, "v1=0"));
    const refused = verifySignature(bad, BODY, SECRET, 300, { nowSec: NOW, replay: guard });
    assert.deepEqual(refused, { ok: false, reason: "invalid_signature" });
    assert.equal(verifySignature(good, BODY, SECRET, 300, { nowSec: NOW, replay: guard }).ok, true);
  });

  it("forgets an entry once its window has passed", () => {
    const guard = createReplayGuard(8);
    assert.equal(guard.accept("key", NOW, NOW + 10), true);
    assert.equal(guard.accept("key", NOW + 5, NOW + 10), false);
    assert.equal(guard.accept("key", NOW + 11, NOW + 20), true);
  });

  it("stays bounded", () => {
    const guard = createReplayGuard(2);
    assert.equal(guard.accept("a", NOW, NOW + 100), true);
    assert.equal(guard.accept("b", NOW, NOW + 100), true);
    // "a" is evicted before "c" is inserted, so it is accepted again.
    assert.equal(guard.accept("c", NOW, NOW + 100), true);
    assert.equal(guard.accept("a", NOW, NOW + 100), true);
  });
});
