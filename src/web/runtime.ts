import { WebRegistry } from "./registry.js";
import { readWebConfig } from "./config.js";
import type { SearchHit } from "./types.js";

/** The one registry every web provider lands in — the tool reads it, plugins fill it. */
export const webRegistry = new WebRegistry();

/**
 * Search through the configured provider, falling through the ordered
 * candidates when a lane is down or empty. Everything failing is one honest
 * error that names each lane — never an empty answer pretending success.
 */
export async function runSearch(query: string, limit: number): Promise<SearchHit[]> {
  const config = await readWebConfig();
  const picked = webRegistry.candidates("search", config);
  if ("error" in picked) throw new Error(picked.error);
  const failures: string[] = [];
  for (const provider of picked.providers) {
    try {
      const hits = await provider.search?.(query, limit, config);
      if (hits !== undefined && hits.length > 0) return hits;
      failures.push(`${provider.name}: no results`);
    } catch (error) {
      failures.push(`${provider.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`web search failed — ${failures.join("; ")}`);
}

/** Read one page through the configured extract provider. */
export async function runExtract(url: string): Promise<string> {
  const config = await readWebConfig();
  const picked = webRegistry.candidates("extract", config);
  if ("error" in picked) throw new Error(picked.error);
  const failures: string[] = [];
  for (const provider of picked.providers) {
    try {
      const text = await provider.extract?.(url, config);
      if (text !== undefined && text.trim().length > 0) return text;
      failures.push(`${provider.name}: empty page`);
    } catch (error) {
      failures.push(`${provider.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`web fetch failed — ${failures.join("; ")}`);
}
