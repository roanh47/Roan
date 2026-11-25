import { fetchText } from "../../http.js";
import { parseSearxng } from "../../parse.js";
import type { SearchHit, WebConfig, WebPluginContext, WebProvider } from "../../types.js";

/** A self-hosted SearXNG instance: real web results, no key, no quota. */
export const searxng: WebProvider = {
  name: "searxng",
  displayName: "SearXNG (self-hosted)",
  supportsSearch: () => true,
  supportsExtract: () => false,
  isAvailable: (config: WebConfig) => (config.searxngUrl ?? "").trim().length > 0,
  async search(query: string, limit: number, config: WebConfig): Promise<SearchHit[]> {
    const base = (config.searxngUrl ?? "").trim().replace(/\/+$/, "");
    if (base.length === 0) throw new Error("searxng has no url configured");
    const url = `${base}/search?q=${encodeURIComponent(query)}&format=json&pageno=1`;
    const hits = parseSearxng(await fetchText(url, 80_000), limit);
    if (hits.length === 0) throw new Error("searxng returned no results");
    return hits;
  },
};

export function register(ctx: WebPluginContext): void {
  ctx.registerWebProvider(searxng);
}
