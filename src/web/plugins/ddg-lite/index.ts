import { fetchText } from "../../http.js";
import { parseDuckDuckGoLite } from "../../parse.js";
import type { SearchHit, WebPluginContext, WebProvider } from "../../types.js";

/** DuckDuckGo lite: works from consumer networks, walls some datacenter IPs. */
const DDG_LITE = "https://lite.duckduckgo.com/lite/?q=";

export const ddgLite: WebProvider = {
  name: "ddg-lite",
  displayName: "DuckDuckGo (lite)",
  supportsSearch: () => true,
  supportsExtract: () => false,
  isAvailable: () => true,
  async search(query: string, limit: number): Promise<SearchHit[]> {
    const hits = parseDuckDuckGoLite(await fetchText(`${DDG_LITE}${encodeURIComponent(query)}`), limit);
    if (hits.length === 0) throw new Error("ddg-lite returned no results");
    return hits;
  },
};

export function register(ctx: WebPluginContext): void {
  ctx.registerWebProvider(ddgLite);
}
