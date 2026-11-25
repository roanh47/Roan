import { fetchText } from "../../http.js";
import { parseWikiOpenSearch } from "../../parse.js";
import type { SearchHit, WebPluginContext, WebProvider } from "../../types.js";

/** Wikipedia opensearch: the floor that never walls, used when the web lanes fail. */
const WIKI_API = "https://LANG.wikipedia.org/w/api.php?action=opensearch&limit=6&format=json&redirects=resolve&search=";

export const wikipedia: WebProvider = {
  name: "wikipedia",
  displayName: "Wikipedia",
  supportsSearch: () => true,
  supportsExtract: () => true,
  isAvailable: () => true,
  async search(query: string): Promise<SearchHit[]> {
    for (const lang of ["en", "nl"]) {
      const hits = parseWikiOpenSearch(await fetchText(`${WIKI_API.replace("LANG", lang)}${encodeURIComponent(query)}`, 20_000));
      if (hits.length > 0) return hits;
    }
    throw new Error("wikipedia returned no results");
  },
  async extract(url: string): Promise<string> {
    const { assertSafeUrl, htmlToText } = await import("../../http.js");
    return htmlToText(await fetchText(assertSafeUrl(url)));
  },
};

export function register(ctx: WebPluginContext): void {
  ctx.registerWebProvider(wikipedia);
}
