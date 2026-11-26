import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_MAX_BODY_BYTES,
  WebhookConfigError,
  handleIncoming,
  sendWebhook,
} from "./dispatch.js";
import { SIGNATURE_HEADER, createReplayGuard, signBody, verifySignature } from "./sign.js";

const SECRET = "test-secret-not-real";
const NOW = 1_800_000_000;
const NOW_MS = NOW * 1_000;

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(answer: (call: Call) => Response | Promise<Response>): {
  fetch: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return answer(call);
  };
  return { fetch: impl as unknown as typeof fetch, calls };
}

function headerOf(call: Call, name: string): string {
  const headers = new Headers(call.init.headers as Record<string, string>);
  const value = headers.get(name);
  assert.notEqual(value, null, `missing header ${name}`);
  return value ?? "";
}

function incomingHeaders(body: string, timestamp: number): Record<string, string> {
  return { [SIGNATURE_HEADER]: signBody(SECRET, body, timestamp) };
}

describe("sendWebhook", () => {
  const payload = { event: "turn.finished", session: "gesprek" };

  it("signs the exact bytes it posts", async () => {
    const fake = fakeFetch(() => new Response("ok", { status: 200 }));
    const delivery = await sendWebhook("https://example.test/hook", payload, {
      secret: SECRET,
      nowSec: NOW,
      fetchImpl: fake.fetch,
    });

    assert.equal(fake.calls.length, 1);
    const call = fake.calls[0];
    assert.notEqual(call, undefined);
    if (call === undefined) return;
    assert.equal(call.url, "https://example.test/hook");
    assert.equal(call.init.method, "POST");
    assert.equal(call.init.redirect, "manual");
    const body = String(call.init.body);
    assert.deepEqual(JSON.parse(body), payload);
    assert.equal(headerOf(call, "content-type"), "application/json");

    const checked = verifySignature(
      { [SIGNATURE_HEADER]: headerOf(call, SIGNATURE_HEADER) },
      body,
      SECRET,
      300,
      { nowSec: NOW },
    );
    assert.equal(checked.ok, true);
    assert.equal(delivery.ok, true);
    assert.equal(delivery.status, 200);
    assert.equal(delivery.body, "ok");
  });

  it("refuses plain http, credentials and non-http schemes before signing", async () => {
    const fake = fakeFetch(() => new Response("", { status: 200 }));
    await assert.rejects(
      sendWebhook("http://example.test/hook", payload, { secret: SECRET, fetchImpl: fake.fetch }),
      WebhookConfigError,
    );
    await assert.rejects(
      sendWebhook("https://user:pass@example.test/hook", payload, { secret: SECRET, fetchImpl: fake.fetch }),
      /credentials/u,
    );
    await assert.rejects(
      sendWebhook("ftp://example.test/hook", payload, { secret: SECRET, fetchImpl: fake.fetch }),
      /unsupported scheme/u,
    );
    await assert.rejects(
      sendWebhook("not a url", payload, { secret: SECRET, fetchImpl: fake.fetch }),
      /not a valid URL/u,
    );
    assert.equal(fake.calls.length, 0);
  });

  it("allows loopback http only with the explicit test flag", async () => {
    const fake = fakeFetch(() => new Response("", { status: 200 }));
    await assert.rejects(
      sendWebhook("http://127.0.0.1:9/hook", payload, { secret: SECRET, fetchImpl: fake.fetch }),
      /plain http is refused/u,
    );
    const delivery = await sendWebhook("http://127.0.0.1:9/hook", payload, {
      secret: SECRET,
      allowLoopback: true,
      nowSec: NOW,
      fetchImpl: fake.fetch,
    });
    assert.equal(delivery.ok, true);
    assert.equal(delivery.status, 200);
  });

  it("does not treat a lookalike hostname as loopback", async () => {
    const fake = fakeFetch(() => new Response("", { status: 200 }));
    await assert.rejects(
      sendWebhook("http://localhost.example.test/hook", payload, {
        secret: SECRET,
        allowLoopback: true,
        fetchImpl: fake.fetch,
      }),
      /plain http is refused/u,
    );
    assert.equal(fake.calls.length, 0);
  });

  it("reports a redirect as a refused delivery", async () => {
    const fake = fakeFetch(
      () => new Response("moved", { status: 302, headers: { location: "https://elsewhere.test/" } }),
    );
    const delivery = await sendWebhook("https://example.test/hook", payload, {
      secret: SECRET,
      fetchImpl: fake.fetch,
    });
    assert.equal(delivery.ok, false);
    assert.equal(delivery.status, 302);
    assert.equal(delivery.error, "redirect refused");
  });

  it("reports a transport failure without echoing the secret", async () => {
    const fake = fakeFetch(() => {
      throw new Error(`connect failed for ${SECRET}`);
    });
    const delivery = await sendWebhook("https://example.test/hook", payload, {
      secret: SECRET,
      fetchImpl: fake.fetch,
    });
    assert.equal(delivery.ok, false);
    assert.equal(delivery.status, 0);
    assert.equal(delivery.error?.includes(SECRET), false);
    assert.match(delivery.error ?? "", /redacted/u);
  });

  it("rejects a bad timeout and an unserialisable payload", async () => {
    const fake = fakeFetch(() => new Response("", { status: 200 }));
    await assert.rejects(
      sendWebhook("https://example.test/hook", payload, { secret: "", fetchImpl: fake.fetch }),
      /secret/u,
    );
    await assert.rejects(
      sendWebhook("https://example.test/hook", payload, { secret: SECRET, timeoutMs: 0, fetchImpl: fake.fetch }),
      /timeoutMs/u,
    );
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    await assert.rejects(
      sendWebhook("https://example.test/hook", circular, { secret: SECRET, fetchImpl: fake.fetch }),
      /not JSON-serialisable/u,
    );
    assert.equal(fake.calls.length, 0);
  });
});

describe("handleIncoming", () => {
  const body = JSON.stringify({ event: "ci.failed", id: "run-17", branch: "main" });

  it("accepts a signed request and returns one event", () => {
    const result = handleIncoming(
      { ...incomingHeaders(body, NOW), "x-roan-source": "github" },
      body,
      SECRET,
      NOW_MS,
    );
    assert.equal(result.accepted, true);
    if (!result.accepted) return;
    assert.equal(result.event.type, "webhook");
    assert.equal(result.event.event, "ci.failed");
    assert.equal(result.event.source, "github");
    assert.equal(result.event.receivedAt, NOW_MS);
    assert.equal(result.event.timestampSec, NOW);
    assert.match(result.event.id, /^wh_[0-9a-f]{32}$/u);
    assert.deepEqual(result.event.payload, { event: "ci.failed", id: "run-17", branch: "main" });
  });

  it("accepts a seconds timestamp as well as milliseconds", () => {
    const result = handleIncoming(incomingHeaders(body, NOW), body, SECRET, NOW);
    assert.equal(result.accepted, true);
  });

  it("derives the same id for the same request", () => {
    const headers = incomingHeaders(body, NOW);
    const first = handleIncoming(headers, body, SECRET, NOW_MS);
    const second = handleIncoming(headers, body, SECRET, NOW_MS + 1_000);
    assert.equal(first.accepted && second.accepted, true);
    if (!first.accepted || !second.accepted) return;
    assert.equal(first.event.id, second.event.id);
  });

  it("refuses an unsigned request", () => {
    assert.deepEqual(handleIncoming({}, body, SECRET, NOW_MS), {
      accepted: false,
      reason: "missing_signature",
    });
  });

  it("refuses a tampered body", () => {
    const headers = incomingHeaders(body, NOW);
    const tampered = body.replace("main", "attacker");
    assert.deepEqual(handleIncoming(headers, tampered, SECRET, NOW_MS), {
      accepted: false,
      reason: "invalid_signature",
    });
  });

  it("refuses a stale request", () => {
    assert.deepEqual(handleIncoming(incomingHeaders(body, NOW - 3_600), body, SECRET, NOW_MS), {
      accepted: false,
      reason: "stale_timestamp",
    });
  });

  it("refuses a replayed request only when given a guard", () => {
    const headers = incomingHeaders(body, NOW);
    const guard = createReplayGuard();
    const first = handleIncoming(headers, body, SECRET, NOW_MS, { replay: guard });
    const second = handleIncoming(headers, body, SECRET, NOW_MS + 1_000, { replay: guard });
    assert.equal(first.accepted, true);
    assert.deepEqual(second, { accepted: false, reason: "replay" });
  });

  it("refuses an oversized body before verifying", () => {
    const big = "x".repeat(DEFAULT_MAX_BODY_BYTES + 1);
    assert.deepEqual(handleIncoming(incomingHeaders(big, NOW), big, SECRET, NOW_MS), {
      accepted: false,
      reason: "body_too_large",
    });
  });

  it("refuses signed but unparseable or non-object JSON", () => {
    const broken = "not json";
    assert.deepEqual(handleIncoming(incomingHeaders(broken, NOW), broken, SECRET, NOW_MS), {
      accepted: false,
      reason: "invalid_json",
    });
    const array = "[1,2,3]";
    assert.deepEqual(handleIncoming(incomingHeaders(array, NOW), array, SECRET, NOW_MS), {
      accepted: false,
      reason: "invalid_payload",
    });
  });

  it("falls back to webhook labels when no headers or payload event exist", () => {
    const plain = JSON.stringify({ hello: "world" });
    const result = handleIncoming(incomingHeaders(plain, NOW), plain, SECRET, NOW_MS);
    assert.equal(result.accepted, true);
    if (!result.accepted) return;
    assert.equal(result.event.event, "webhook");
    assert.equal(result.event.source, "webhook");
  });

  it("drops a header label that is too long", () => {
    const result = handleIncoming(
      { ...incomingHeaders(body, NOW), "x-roan-event": "e".repeat(200) },
      body,
      SECRET,
      NOW_MS,
    );
    assert.equal(result.accepted, true);
    if (!result.accepted) return;
    assert.equal(result.event.event, "ci.failed");
  });
});
