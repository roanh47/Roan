import { fetchText } from "../../http.js";
import { parseBingRss } from "../../parse.js";
import type { SearchHit, WebPluginContext, WebProvider } from "../../types.js";

/** Bing's RSS view: plain items, no cookies, no scripts. */
const BING_RSS = "https://www.bing.com/search?format=rss&q=";

export const bingRss: WebProvider = {
  name: "bing-rss",
  displayName: "Bing (RSS)",
  supportsSearch: () => true,
  supportsExtract: () => false,
  isAvailable: () => true,
  async search(query: string, limit: number): Promise<SearchHit[]> {
    const hits = parseBingRss(await fetchText(`${BING_RSS}${encodeURIComponent(query)}`), limit);
    if (hits.length === 0) throw new Error("bing-rss returned no results");
    return hits;
  },
};

export function register(ctx: WebPluginContext): void {
  ctx.registerWebProvider(bingRss);
}
