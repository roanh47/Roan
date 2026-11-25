import type { Tool } from "../../types.js";
import { runExtract, runSearch } from "../../web/runtime.js";
import type { SearchHit } from "../../web/types.js";

function formatHits(hits: SearchHit[]): string {
  return hits
    .map((hit, index) => `${String(index + 1)}. ${hit.title}\n   ${hit.url}\n   ${hit.snippet}`)
    .join("\n\n");
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
    return formatHits(await runSearch(query, 6));
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
    const url = typeof args["url"] === "string" ? args["url"] : "";
    return runExtract(url);
  },
};
