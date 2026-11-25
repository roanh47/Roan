import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProviderError, type ChatAdapter, type AdapterConfig } from "./adapter.js";
import { createAdapter, isSupported, protocolFor, supportedProviders } from "./factory.js";
import { CATALOG } from "./lookup.js";

/**
 * This test sits in src/providers/ (and not in tests/) because tsconfig only
 * includes "src" and `npm test` runs the compiled dist/**\/*.test.js; a test
 * outside rootDir would neither typecheck nor run.
 *
 * The config points at a closed port and the adapters are only constructed,
 * never sent: no network, no real keys.
 */
const CFG: AdapterConfig = {
  baseUrl: "http://127.0.0.1:9/v1",
  apiKey: "not-a-real-key",
  model: "test",
};

const PROTOCOLS: readonly string[] = ["openai-compat", "anthropic", "google"];

const providerIds: readonly string[] = Object.values(CATALOG.providers).map((entry) => entry.id);

function adapterFor(providerId: string): ChatAdapter {
  return createAdapter(providerId, CFG);
}

/** Asserts that `fn` throws a ProviderError for exactly `providerId`. */
function assertProviderError(fn: () => unknown, providerId: string): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof ProviderError, `expected a ProviderError, got ${String(error)}`);
    assert.equal(error.provider, providerId);
    assert.match(error.message, new RegExp(providerId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(error.status, null);
    return true;
  });
}

describe("provider factory", () => {
  it("has a non-empty catalog to test against", () => {
    assert.ok(providerIds.length > 0, "the catalog contains no providers");
  });

  it("lets no catalog provider fail silently", () => {
    for (const providerId of providerIds) {
      if (isSupported(providerId)) {
        const adapter = adapterFor(providerId);
        assert.ok(
          PROTOCOLS.includes(adapter.id),
          `${providerId} resolves to unknown protocol "${adapter.id}"`,
        );
        assert.equal(typeof adapter.send, "function", `${providerId}: send is not a function`);
        assert.equal(
          protocolFor(providerId),
          adapter.id,
          `${providerId}: protocolFor and adapter.id disagree`,
        );
        assert.ok(
          supportedProviders().includes(providerId),
          `${providerId} is supported but is not in supportedProviders()`,
        );
      } else {
        assertProviderError(() => adapterFor(providerId), providerId);
        assert.ok(
          !supportedProviders().includes(providerId),
          `${providerId} is unsupported but is in supportedProviders()`,
        );
      }
    }
  });

  it("throws for an unknown id instead of returning a silent default", () => {
    const unknown = "no-such-provider";
    assert.equal(isSupported(unknown), false);
    assert.equal(protocolFor(unknown), null);
    assertProviderError(() => adapterFor(unknown), unknown);
  });

  it("pins the protocols of anthropic and google", () => {
    assert.equal(protocolFor("anthropic"), "anthropic");
    assert.equal(protocolFor("google"), "google");
    assert.equal(adapterFor("anthropic").id, "anthropic");
    assert.equal(adapterFor("google").id, "google");
  });

  it("returns supportedProviders() sorted and without duplicates", () => {
    const ids = supportedProviders();
    const sorted = [...ids].sort();
    assert.deepEqual(ids, sorted, "supportedProviders() is not sorted");
    assert.equal(new Set(ids).size, ids.length, "supportedProviders() contains duplicates");

    for (const id of ids) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(CATALOG.providers, id),
        `supportedProviders() names unknown provider ${id}`,
      );
      assert.equal(isSupported(id), true, `${id} is in supportedProviders() but is not supported`);
    }
  });

  it("resolves every provider to exactly one protocol", () => {
    // protocolFor is single-valued; a second construction must not switch
    // protocol (no mood/ordering that changes per call).
    for (const providerId of supportedProviders()) {
      const first = adapterFor(providerId).id;
      const second = adapterFor(providerId).id;
      assert.equal(first, second, `${providerId} switches between ${first} and ${second}`);
      assert.ok(PROTOCOLS.includes(first), `${providerId} has an unknown protocol ${first}`);
    }
  });
});
