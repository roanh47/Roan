import { CATALOG } from "./catalog.js";
import type { Catalog, CatalogEntry, Model } from "./types.js";

/**
 * The live catalogue: providers and models straight from models.dev.
 *
 * The bundled snapshot in `catalog.ts` is a fallback for an offline machine, not
 * the source. models.dev is the registry — 324 providers at the time of writing,
 * against 235 in the snapshot — and a provider that is missing here cannot be
 * picked in the app at all, so a stale copy is the same as a missing feature.
 *
 * models.dev answers 403 to a default HTTP user agent, so one is sent.
 */
const SOURCE = "https://models.dev/api.json";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const DEFAULT_MAX_AGE_MS = 5 * 60_000;

let cache: { readonly at: number; readonly catalog: Catalog } | null = null;

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseModel(id: string, raw: unknown): Model {
  const m = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const cost = (typeof m["cost"] === "object" && m["cost"] !== null ? m["cost"] : {}) as Record<string, unknown>;
  const limit = (typeof m["limit"] === "object" && m["limit"] !== null ? m["limit"] : {}) as Record<string, unknown>;
  return {
    id,
    name: asString(m["name"]) ?? id,
    family: asString(m["family"]),
    context: asNumber(limit["context"]),
    output: asNumber(limit["output"]),
    inputCost: asNumber(cost["input"]),
    outputCost: asNumber(cost["output"]),
    reasoning: m["reasoning"] === true,
    toolCall: m["tool_call"] === true,
    attachment: m["attachment"] === true,
    knowledge: asString(m["knowledge"]),
    releaseDate: asString(m["release_date"]),
    status: asString(m["status"]),
  };
}

/**
 * Turns the models.dev payload into our catalogue shape. Returns null when the
 * payload is not an object of providers, so a changed API is reported instead of
 * quietly producing an empty list.
 */
export function parseCatalog(payload: unknown): Catalog | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const providers: Record<string, CatalogEntry> = {};
  for (const [id, raw] of Object.entries(payload as Record<string, unknown>)) {
    if (typeof raw !== "object" || raw === null) continue;
    const p = raw as Record<string, unknown>;
    const modelsRaw = p["models"];
    if (typeof modelsRaw !== "object" || modelsRaw === null) continue;
    const models: Record<string, Model> = {};
    for (const [modelId, modelRaw] of Object.entries(modelsRaw as Record<string, unknown>)) {
      models[modelId] = parseModel(modelId, modelRaw);
    }
    if (Object.keys(models).length === 0) continue;
    const env = Array.isArray(p["env"]) ? p["env"].filter((value): value is string => typeof value === "string") : [];
    providers[id] = {
      id,
      name: asString(p["name"]) ?? id,
      env,
      ...(asString(p["api"]) !== undefined ? { api: asString(p["api"]) } : {}),
      ...(asString(p["doc"]) !== undefined ? { doc: asString(p["doc"]) } : {}),
      npm: asString(p["npm"]) ?? "",
      models,
    };
  }
  if (Object.keys(providers).length === 0) return null;
  return { generatedAt: new Date().toISOString(), source: SOURCE, providers };
}

/**
 * The catalogue to use now: live when it can be had, the bundled snapshot when
 * the machine is offline. Cached for a few minutes, because every keystroke in
 * the model search asks for it.
 */
export async function loadCatalog(options: { maxAgeMs?: number; force?: boolean } = {}): Promise<Catalog> {
  const maxAge = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  if (!options.force && cache !== null && Date.now() - cache.at < maxAge) return cache.catalog;
  try {
    const response = await fetch(SOURCE, {
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`models.dev answered ${String(response.status)}`);
    const parsed = parseCatalog(await response.json());
    if (parsed === null) throw new Error("models.dev returned an unexpected shape");
    cache = { at: Date.now(), catalog: parsed };
    return parsed;
  } catch {
    // Offline: the snapshot is a real catalogue, just older.
    return cache?.catalog ?? CATALOG;
  }
}

/** Forget the cache; the next call fetches again. */
export function clearCatalog(): void {
  cache = null;
}

/** Where the catalogue in hand came from, for the app to show. */
export function catalogSource(catalog: Catalog): "models.dev" | "snapshot" {
  return catalog === CATALOG ? "snapshot" : "models.dev";
}
