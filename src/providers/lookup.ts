import { CATALOG } from "./catalog.js";
import type { Catalog, CatalogEntry, Model } from "./types.js";

export { CATALOG };
export type { Catalog, CatalogEntry, Model, Provider } from "./types.js";

/**
 * Locale-independent string comparison, so ordering is identical on every
 * machine (no ICU/locale differences and no surprise from numeric ids).
 */
function compareIds(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

let providerCache: readonly CatalogEntry[] | undefined;
const modelCache = new Map<string, readonly Model[]>();

/** All providers, sorted by id. */
export function listProviders(): readonly CatalogEntry[] {
  providerCache ??= Object.freeze(
    Object.values(CATALOG.providers).sort((a, b) => compareIds(a.id, b.id)),
  );
  return providerCache;
}

/** All models for a provider, sorted by id. Unknown providers yield an empty list. */
export function modelsFor(providerId: string): readonly Model[] {
  let models = modelCache.get(providerId);
  if (models === undefined) {
    const provider = CATALOG.providers[providerId];
    models = Object.freeze(
      provider === undefined
        ? []
        : Object.values(provider.models).sort((a, b) => compareIds(a.id, b.id)),
    );
    modelCache.set(providerId, models);
  }
  return models;
}

/** One model, or `undefined` when the provider or model is unknown. */
export function findModel(providerId: string, modelId: string): Model | undefined {
  return CATALOG.providers[providerId]?.models[modelId];
}
