import { get as httpsGet } from "node:https";
import type { Tool } from "../types.js";

/**
 * Two hands for the agent, both https-only: search the web and read a page.
 *
 * Both tools answer as *citations*: a list of sources with a one-line snippet
 * each, never a wall of text. The parsers are pure on injected HTML so the
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
  if (hits.length === 0) return "geen resultaten gevonden";
  return hits
    .map((hit, index) => `${String(index + 1)}. ${hit.title}\n   ${hit.url}\n   ${hit.snippet}`)
    .join("\n\n");
}

function fetchText(url: string, limitBytes = FETCH_LIMIT_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = httpsGet(
      url,
      { timeout: TIMEOUT_MS, headers: { "user-agent": "Mozilla/5.0 Roan-agent", accept: "text/html,text/plain,*/*" } },
      (response) => {
        if (response.statusCode !== undefined && (response.statusCode < 200 || response.statusCode >= 300)) {
          response.resume();
          reject(new Error(`HTTP ${String(response.statusCode)}`));
          return;
        }
        let seen = 0;
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          seen += chunk.length;
          if (seen <= limitBytes) body += chunk;
          else request.destroy();
        });
        response.on("end", () => resolve(body));
        response.on("error", reject);
      },
    );
    request.on("timeout", () => request.destroy());
    request.on("error", reject);
  });
}

function assertSafeUrl(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0) throw new Error("geen url opgegeven");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`geen geldige url: ${raw}`);
  }
  if (parsed.protocol !== "https:") throw new Error("alleen https wordt opgehaald");
  const host = parsed.hostname.toLowerCase();
  const blocked =
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "metadata.google.internal" ||
    /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
    host.endsWith(".local");
  if (blocked) throw new Error("privé- en loopback-adressen worden niet opgehaald");
  return parsed.toString();
}

export const webSearch: Tool = {
  name: "web_search",
  description:
    "Zoek live op het web. Gebruik dit voor actuele feiten, prijzen, versies of iets wat je " +
    "niet zeker weet. Noem de bronnen uit het antwoord in je eigen antwoord.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "De zoekvraag, in de taal van het antwoord" },
    },
    required: ["query"],
  },
  async run(args) {
    const query = typeof args["query"] === "string" ? args["query"].trim() : "";
    if (query.length === 0) throw new Error("lege zoekvraag");
    const html = await fetchText(`${DDG_LITE}${encodeURIComponent(query)}`);
    return formatHits(parseDuckDuckGoLite(html));
  },
};

export const webFetch: Tool = {
  name: "web_fetch",
  description:
    "Lees één https-pagina en vat de inhoud samen. Gebruik dit na een zoekopdracht om de " +
    "belangrijkste bron te lezen. Noem de url die je las.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "Volledige https-url" },
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
    return text.length > 8_000 ? `${text.slice(0, 8_000)}\n…(afgekapt)` : text.length > 0 ? text : "lege pagina";
  },
};
