import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { WebConfig } from "./types.js";

/**
 * The web section is non-secret and lives per machine in `<home>/web.json`:
 * which provider to use for search and extract, plus the SearXNG url. Keys
 * (when a provider needs one) go to `secrets/`, never here and never the chain.
 */
export async function loadWebConfig(home: string): Promise<WebConfig> {
  let raw: string;
  try {
    raw = await readFile(join(home, "web.json"), "utf8");
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const pick = (key: string): string | undefined => {
      const value = parsed[key];
      return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
    };
    return {
      backend: pick("backend"),
      searchBackend: pick("searchBackend"),
      extractBackend: pick("extractBackend"),
      searxngUrl: pick("searxngUrl"),
    };
  } catch {
    return {};
  }
}

let source: () => Promise<WebConfig> = async () => ({});

/** The daemon points this at the real home; tests and the CLI keep the empty one. */
export function setWebConfigSource(read: () => Promise<WebConfig>): void {
  source = read;
}

export function readWebConfig(): Promise<WebConfig> {
  return source();
}
