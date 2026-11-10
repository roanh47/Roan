import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProviderError, type ChatAdapter, type AdapterConfig } from "./adapter.js";
import { createAdapter, isSupported, protocolFor, supportedProviders } from "./factory.js";
import { CATALOG } from "./lookup.js";

/**
 * Deze test staat in src/providers/ (en niet in tests/) omdat tsconfig alleen
 * "src" include't en `npm test` de gecompileerde dist/**\/*.test.js draait; een
 * test buiten rootDir zou dus niet typechecken en niet draaien.
 *
 * De config wijst naar een dichte poort en de adapters worden alleen
 * geconstrueerd, nooit verzonden: geen netwerk, geen echte keys.
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

/** Controleert dat `fn` een ProviderError voor precies `providerId` gooit. */
function assertProviderError(fn: () => unknown, providerId: string): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof ProviderError, `verwachtte ProviderError, kreeg ${String(error)}`);
    assert.equal(error.provider, providerId);
    assert.match(error.message, new RegExp(providerId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(error.status, null);
    return true;
  });
}

describe("provider factory", () => {
  it("heeft een niet-lege catalogus om over te testen", () => {
    assert.ok(providerIds.length > 0, "catalogus bevat geen providers");
  });

  it("laat geen enkele catalogusprovider stil falen", () => {
    for (const providerId of providerIds) {
      if (isSupported(providerId)) {
        const adapter = adapterFor(providerId);
        assert.ok(
          PROTOCOLS.includes(adapter.id),
          `${providerId} resolvet naar onbekend protocol "${adapter.id}"`,
        );
        assert.equal(typeof adapter.send, "function", `${providerId}: send is geen functie`);
        assert.equal(
          protocolFor(providerId),
          adapter.id,
          `${providerId}: protocolFor en adapter.id lopen uiteen`,
        );
        assert.ok(
          supportedProviders().includes(providerId),
          `${providerId} is supported maar staat niet in supportedProviders()`,
        );
      } else {
        assertProviderError(() => adapterFor(providerId), providerId);
        assert.ok(
          !supportedProviders().includes(providerId),
          `${providerId} is unsupported maar staat wel in supportedProviders()`,
        );
      }
    }
  });

  it("gooit voor een onbekende id in plaats van een stille default", () => {
    const unknown = "no-such-provider";
    assert.equal(isSupported(unknown), false);
    assert.equal(protocolFor(unknown), null);
    assertProviderError(() => adapterFor(unknown), unknown);
  });

  it("pint de protocollen van anthropic en google", () => {
    assert.equal(protocolFor("anthropic"), "anthropic");
    assert.equal(protocolFor("google"), "google");
    assert.equal(adapterFor("anthropic").id, "anthropic");
    assert.equal(adapterFor("google").id, "google");
  });

  it("geeft supportedProviders() gesorteerd en zonder duplicaten", () => {
    const ids = supportedProviders();
    const sorted = [...ids].sort();
    assert.deepEqual(ids, sorted, "supportedProviders() is niet gesorteerd");
    assert.equal(new Set(ids).size, ids.length, "supportedProviders() bevat duplicaten");

    for (const id of ids) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(CATALOG.providers, id),
        `supportedProviders() noemt onbekende provider ${id}`,
      );
      assert.equal(isSupported(id), true, `${id} staat in supportedProviders() maar is niet supported`);
    }
  });

  it("resolvet elke provider naar precies één protocol", () => {
    // protocolFor is enkelvoudig; een tweede constructie mag niet van protocol
    // wisselen (geen stemming/ordening die per aanroep verandert).
    for (const providerId of supportedProviders()) {
      const first = adapterFor(providerId).id;
      const second = adapterFor(providerId).id;
      assert.equal(first, second, `${providerId} wisselt tussen ${first} en ${second}`);
      assert.ok(PROTOCOLS.includes(first), `${providerId} heeft onbekend protocol ${first}`);
    }
  });
});
