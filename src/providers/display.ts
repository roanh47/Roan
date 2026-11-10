/**
 * Presentation helpers for the provider and model pickers.
 *
 * Four things live here: display labels, a curated provider order, short
 * capability badges and query search. All of it is derived from the generated
 * catalog in `catalog.ts`. A label is only ever taken from the catalog; when
 * the catalog has nothing better than the id (which happens for individual
 * models, whose `name` is sometimes the bare id), the id is used as-is.
 */
import { CATALOG, listProviders } from "./lookup.js";
import type { CatalogEntry, Model } from "./types.js";

/**
 * Locale-independent comparison. Ordering must be identical on every machine,
 * so this is a plain code-unit compare and never `localeCompare`.
 */
function compareIds(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** True for a string that is worth showing, i.e. not empty after trimming. */
function isUsableLabel(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Own-property lookup, so ids such as `constructor` or `__proto__` resolve to
 * "unknown" instead of picking up something off `Object.prototype`.
 */
function providerEntry(providerId: string): CatalogEntry | undefined {
  const providers = CATALOG.providers;
  if (!Object.hasOwn(providers, providerId)) return undefined;
  return providers[providerId];
}

/** Own-property model lookup; `undefined` when the provider or model is unknown. */
function lookupModel(providerId: string, modelId: string): Model | undefined {
  const provider = providerEntry(providerId);
  if (provider === undefined) return undefined;
  const models = provider.models;
  if (!Object.hasOwn(models, modelId)) return undefined;
  return models[modelId];
}

const EMPTY_STRINGS: readonly string[] = Object.freeze([]);

/**
 * Human name for a provider, e.g. `302ai` -> `302.AI`.
 *
 * Never throws: unknown (or otherwise unusable) ids come back unchanged.
 */
export function providerLabel(id: string): string {
  try {
    const provider = providerEntry(id);
    if (provider !== undefined && isUsableLabel(provider.name)) {
      return provider.name;
    }
  } catch {
    // A frozen catalog should not throw; if it somehow does, the id is still
    // a better answer than an exception inside a picker.
  }
  return id;
}

/** Human name for a model, falling back to the model id. Never throws. */
export function modelLabel(providerId: string, modelId: string): string {
  try {
    const model = lookupModel(providerId, modelId);
    if (model !== undefined && isUsableLabel(model.name)) {
      return model.name;
    }
  } catch {
    // See `providerLabel`.
  }
  return modelId;
}

/**
 * Providers that get the top of the picker, in this exact order. Everything
 * else follows alphabetically by id, so a catalog update only adds rows at the
 * bottom instead of shuffling what people already know.
 */
const FEATURED_PROVIDERS: readonly string[] = Object.freeze([
  "anthropic",
  "openai",
  "google",
  "openrouter",
  "deepseek",
  "mistral",
  "xai",
  "groq",
  "together",
  // The snapshot in `catalog.ts` spells it `togetherai`; keep both so the
  // picker stays curated whichever spelling the generator emits.
  "togetherai",
]);

const CONTEXT_ONE_MILLION = 1_000_000;
const CHEAP_INPUT_COST = 0.5;

let orderedCache: readonly CatalogEntry[] | undefined;

/**
 * Every provider: the curated list first (missing ones skipped), then the rest
 * sorted by id. The same frozen array is returned on every call.
 */
export function orderedProviders(): readonly CatalogEntry[] {
  const cached = orderedCache;
  if (cached !== undefined) return cached;

  const byId = new Map<string, CatalogEntry>();
  for (const provider of listProviders()) {
    byId.set(provider.id, provider);
  }

  const ordered: CatalogEntry[] = [];
  const placed = new Set<string>();
  for (const id of FEATURED_PROVIDERS) {
    const provider = byId.get(id);
    if (provider === undefined || placed.has(provider.id)) continue;
    ordered.push(provider);
    placed.add(provider.id);
  }

  const rest = [...byId.values()]
    .filter((provider) => !placed.has(provider.id))
    .sort((a, b) => compareIds(a.id, b.id));
  ordered.push(...rest);

  orderedCache = Object.freeze(ordered);
  return orderedCache;
}

/**
 * Short capability badges for one model, in a fixed order so rows line up:
 * `tools`, `vision`, `reasoning`, `1M ctx`, `cheap`.
 *
 * `1M ctx` means a context window of at least 1,000,000 tokens; `cheap` means
 * at most 0.5 USD per 1M input tokens. Unknown models yield no badges.
 */
export function modelBadges(providerId: string, modelId: string): readonly string[] {
  const model = lookupModel(providerId, modelId);
  if (model === undefined) return EMPTY_STRINGS;

  const badges: string[] = [];
  if (model.toolCall === true) badges.push("tools");
  if (model.attachment === true) badges.push("vision");
  if (model.reasoning === true) badges.push("reasoning");
  if (model.context !== undefined && model.context >= CONTEXT_ONE_MILLION) {
    badges.push("1M ctx");
  }
  if (model.inputCost !== undefined && model.inputCost <= CHEAP_INPUT_COST) {
    badges.push("cheap");
  }
  return badges.length === 0 ? EMPTY_STRINGS : Object.freeze(badges);
}

/** One row of a model search: the model plus the provider it belongs to. */
export interface ModelSearchResult {
  readonly providerId: string;
  readonly providerName: string;
  readonly model: Model;
}

interface IndexedModel extends ModelSearchResult {
  /** Lower-cased match keys, computed once for the whole catalog. */
  readonly idKey: string;
  readonly nameKey: string;
  readonly providerKey: string;
}

/** Ranking tiers, best first. A model takes its highest-scoring tier. */
const SCORE_EXACT_ID = 5;
const SCORE_ID_PREFIX = 4;
const SCORE_ID_SUBSTRING = 3;
const SCORE_NAME_SUBSTRING = 2;
const SCORE_PROVIDER_SUBSTRING = 1;

const DEFAULT_SEARCH_LIMIT = 50;

let indexCache: readonly IndexedModel[] | undefined;

/** Every model in the catalog with its match keys, built once and frozen. */
function searchIndex(): readonly IndexedModel[] {
  const cached = indexCache;
  if (cached !== undefined) return cached;

  const rows: IndexedModel[] = [];
  for (const provider of orderedProviders()) {
    const providerId = provider.id;
    const providerName = providerLabel(providerId);
    const providerKey = providerName.toLowerCase();
    for (const model of Object.values(provider.models)) {
      rows.push({
        providerId,
        providerName,
        model,
        idKey: model.id.toLowerCase(),
        nameKey: model.name.toLowerCase(),
        providerKey,
      });
    }
  }

  indexCache = Object.freeze(rows);
  return indexCache;
}

/** Highest matching tier for one row, or 0 when the query does not match. */
function scoreOf(row: IndexedModel, query: string): number {
  if (row.idKey === query) return SCORE_EXACT_ID;
  if (row.idKey.startsWith(query)) return SCORE_ID_PREFIX;
  if (row.idKey.includes(query)) return SCORE_ID_SUBSTRING;
  if (row.nameKey.includes(query)) return SCORE_NAME_SUBSTRING;
  if (row.providerKey.includes(query)) return SCORE_PROVIDER_SUBSTRING;
  return 0;
}

/** Normalises the caller's limit: whole numbers only, never negative. */
function normaliseLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_SEARCH_LIMIT;
  const floor = Math.floor(limit);
  return floor > 0 ? floor : 0;
}

/**
 * Ranked model search, case-insensitive.
 *
 * Ranking, best first: exact model id, id prefix, id substring, model name
 * substring, provider name substring. Ties break on provider id then model id,
 * both by plain string compare, so the same query always yields the same order.
 * An empty or whitespace-only query returns no rows.
 *
 * @param query Free-text query, e.g. `claude`, `gpt-4o` or `deepseek`.
 * @param limit Maximum number of rows; defaults to 50.
 */
export function searchModels(
  query: string,
  limit: number = DEFAULT_SEARCH_LIMIT,
): readonly ModelSearchResult[] {
  if (typeof query !== "string") return Object.freeze([]);
  const needle = query.trim().toLowerCase();
  if (needle === "") return Object.freeze([]);

  const max = normaliseLimit(limit);
  if (max === 0) return Object.freeze([]);

  const hits: { readonly score: number; readonly row: IndexedModel }[] = [];
  for (const row of searchIndex()) {
    const score = scoreOf(row, needle);
    if (score !== 0) hits.push({ score, row });
  }

  hits.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    const byProvider = compareIds(a.row.providerId, b.row.providerId);
    if (byProvider !== 0) return byProvider;
    return compareIds(a.row.model.id, b.row.model.id);
  });

  const results: ModelSearchResult[] = [];
  for (const hit of hits.slice(0, max)) {
    results.push({
      providerId: hit.row.providerId,
      providerName: hit.row.providerName,
      model: hit.row.model,
    });
  }
  return Object.freeze(results);
}
