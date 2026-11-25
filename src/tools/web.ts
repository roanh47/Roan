import { get as httpsGet } from "node:https";
import type { Tool } from "../types.js";

/**
 * Two hands for the agent, both https-only: search the web and read a page.
 *
 * Both tools answer as *citations*: a list of sources with a one-line snippet
 * each, never a wall of text. The parsers are pure on injected markup so the
 * shape is pinned by tests without touching the network.
 */

export interface SearchHit {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}

const RESULT_LIMIT = 6;
const FETCH_LIMIT_BYTES = 64_000;
const TIMEOUT_MS = 10_000;

/** Bing's RSS view: one <item> per result, no scripts, no cookies. */
const BING_RSS = "https://www.bing.com/search?format=rss&q=";
/** DuckDuckGo's lite endpoint: one result per anchor, no scripts, no cookies. */
const DDG_LITE = "https://lite.duckduckgo.com/lite/?q=";

function stripTags(fragment: string): string {
  return fragment
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function xmlText(fragment: string): string {
  return stripTags(
    fragment
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(parseInt(code, 16))),
  );
}

/**
 * Parses Bing's RSS result feed. Every <item> carries title, link and
 * description; that is the whole contract, and it answers without cookies or
 * scripts — which is why it is the primary lane.
 */
export function parseBingRss(xml: string, limit = RESULT_LIMIT): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const item = match[1] ?? "";
    const title = xmlText(/<title>([\s\S]*?)<\/title>/.exec(item)?.[1] ?? "");
    const url = xmlText(/<link>([\s\S]*?)<\/link>/.exec(item)?.[1] ?? "");
    const snippet = xmlText(/<description>([\s\S]*?)<\/description>/.exec(item)?.[1] ?? "");
    if (!url.startsWith("https://") || title.length === 0) continue;
    hits.push({ title, url, snippet });
    if (hits.length >= limit) break;
  }
  return hits;
}

/**
 * Parses a DuckDuckGo lite results page. The lite layout is a table: a link
 * with the title, then a snippet row, and the raw url in the anchor's own
 * href (a redirect wrapper) or in a following row.
 */
export function parseDuckDuckGoLite(html: string, limit = RESULT_LIMIT): SearchHit[] {
  const hits: SearchHit[] = [];
  const anchor = /<a[^>]+class="result-link"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippet = /<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/g;
  const titles: { url: string; title: string }[] = [];
  for (const match of html.matchAll(anchor)) {
    const url = match[1] ?? "";
    const title = stripTags(match[2] ?? "");
    // The lite endpoint wraps results in a redirect; the target rides in uddg.
    const target = /uddg=([^&]+)/.exec(url);
    const clean = target !== null ? decodeURIComponent(target[1] ?? url) : url;
    if (clean.startsWith("https://") && title.length > 0) titles.push({ url: clean, title });
  }
  const snippets: string[] = [];
  for (const match of html.matchAll(snippet)) snippets.push(stripTags(match[1] ?? ""));
  for (let index = 0; index < titles.length && hits.length < limit; index += 1) {
    const entry = titles[index];
    if (entry === undefined) continue;
    hits.push({ title: entry.title, url: entry.url, snippet: snippets[index] ?? "" });
  }
  return hits;
}

function formatHits(hits: SearchHit[]): string {
  if (hits.length === 0) return "no results found";
  return hits
    .map((hit, index) => `${String(index + 1)}. ${hit.title}\n   ${hit.url}\n   ${hit.snippet}`)
    .join("\n\n");
}

function fetchText(url: string, limitBytes = FETCH_LIMIT_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = httpsGet(
      url,
      {
        timeout: TIMEOUT_MS,
        headers: { "user-agent": "Mozilla/5.0 Roan-agent", accept: "text/html,text/plain,application/rss+xml,*/*" },
      },
      (response) => {
        if (response.statusCode !== undefined && (response.statusCode < 200 || response.statusCode >= 300)) {
          response.resume();
          reject(new Error(`HTTP ${String(response.statusCode)}`));
          return;
        }
        let seen = 0;
        let body = "";
        let done = false;
        const finish = (): void => {
          if (done) return;
          done = true;
          response.destroy();
          resolve(body);
        };
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          seen += chunk.length;
          // Enough is enough: the first `limit` bytes are the page for us.
          // Destroying the request here used to surface as an "aborted" error,
          // which is why every real (larger) page failed to load.
          if (seen <= limitBytes) body += chunk;
          else finish();
        });
        response.on("end", finish);
        response.on("error", (error) => {
          if (!done) reject(error);
        });
      },
    );
    request.on("timeout", () => {
      request.destroy(new Error("request timed out"));
    });
    request.on("error", reject);
  });
}

function assertSafeUrl(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0) throw new Error("no url given");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`not a valid url: ${raw}`);
  }
  if (parsed.protocol !== "https:") throw new Error("only https is fetched");
  const host = parsed.hostname.toLowerCase();
  const blocked =
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "metadata.google.internal" ||
    /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
    host.endsWith(".local");
  if (blocked) throw new Error("private and loopback addresses are not fetched");
  return parsed.toString();
}

/**
 * Wikipedia's opensearch endpoint: the guaranteed fallback. It answers from
 * any network with real, citable links — a search that came back empty (a
 * bot-wall, a parse miss) is a search the agent cannot pretend succeeded.
 */
const WIKI_API = "https://LANG.wikipedia.org/w/api.php?action=opensearch&limit=6&format=json&redirects=resolve&search=";

export async function wikiSearch(query: string, lang: string): Promise<SearchHit[]> {
  const raw = await fetchText(`${WIKI_API.replace("LANG", lang)}${encodeURIComponent(query)}`, 20_000);
  return parseWikiOpenSearch(raw);
}

/** Wikipedia's opensearch answer is [question, titles, descriptions, urls]. */
export function parseWikiOpenSearch(raw: string): SearchHit[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed) || parsed.length < 4) return [];
  const titles = parsed[1];
  const descriptions = parsed[2];
  const urls = parsed[3];
  if (!Array.isArray(titles) || !Array.isArray(descriptions) || !Array.isArray(urls)) return [];
  const hits: SearchHit[] = [];
  for (let index = 0; index < titles.length && hits.length < RESULT_LIMIT; index += 1) {
    const title = titles[index];
    const url = urls[index];
    const snippet = descriptions[index];
    if (typeof title !== "string" || typeof url !== "string" || !url.startsWith("https://")) continue;
    hits.push({ title, url, snippet: typeof snippet === "string" ? snippet : "" });
  }
  return hits;
}

export const webSearch: Tool = {
  name: "web_search",
  description:
    "Search the live web. Use this for current facts, prices, versions, or anything you are " +
    "not sure about. Name the sources from the result in your own answer.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query, in the language of the answer" },
    },
    required: ["query"],
  },
  async run(args) {
    const query = typeof args["query"] === "string" ? args["query"].trim() : "";
    if (query.length === 0) throw new Error("empty search query");
    // Primary: Bing's RSS view — plain items, no cookies, no scripts.
    // DuckDuckGo lite is the second lane; Wikipedia the guaranteed floor.
    const encoded = encodeURIComponent(query);
    for (const lane of [BING_RSS, DDG_LITE]) {
      try {
        const body = await fetchText(`${lane}${encoded}`);
        const hits = lane === BING_RSS ? parseBingRss(body) : parseDuckDuckGoLite(body);
        if (hits.length > 0) return formatHits(hits);
      } catch {
        // A walled or broken lane falls through to the next one.
      }
    }
    for (const lang of ["en", "nl"]) {
      try {
        const hits = await wikiSearch(query, lang);
        if (hits.length > 0) {
          return `${formatHits(hits)}\n\n(Wikipedia — the open-web lanes returned nothing from this network.)`;
        }
      } catch {
        // Next language, then give up honestly.
      }
    }
    return "no results found";
  },
};

export const webFetch: Tool = {
  name: "web_fetch",
  description:
    "Read one https page and summarize its content. Use this after a search to read the most " +
    "important source. Name the url you read.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "Full https url" },
    },
    required: ["url"],
  },
  async run(args) {
    const url = assertSafeUrl(args["url"]);
    const html = await fetchText(url);
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
      .replace(/<[^>]*>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
    return text.length > 8_000 ? `${text.slice(0, 8_000)}\n…(cut)` : text.length > 0 ? text : "empty page";
  },
};
