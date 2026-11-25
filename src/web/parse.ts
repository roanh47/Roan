import type { SearchHit } from "./types.js";

export const RESULT_LIMIT = 6;

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

/** Parses a SearXNG JSON answer (`?format=json`) into plain hits. */
export function parseSearxng(raw: string, limit = RESULT_LIMIT): SearchHit[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const results = (parsed as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  const hits: SearchHit[] = [];
  for (const entry of results) {
    if (hits.length >= limit) break;
    if (typeof entry !== "object" || entry === null) continue;
    const item = entry as { title?: unknown; url?: unknown; content?: unknown };
    if (typeof item.title !== "string" || typeof item.url !== "string") continue;
    if (!item.url.startsWith("https://")) continue;
    hits.push({ title: item.title, url: item.url, snippet: typeof item.content === "string" ? item.content : "" });
  }
  return hits;
}
