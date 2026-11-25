/**
 * The contract every web backend implements — the same shape Hermes uses:
 * one ABC, a registry, and thin tools that never contain vendor code.
 *
 * A provider answers with plain data; the tool wrapper owns formatting.
 */
export interface WebConfig {
  /** Shared choice for both capabilities, like `web.backend` in Hermes. */
  readonly backend?: string;
  /** Search-only choice, wins over the shared one. */
  readonly searchBackend?: string;
  /** Extract-only choice, wins over the shared one. */
  readonly extractBackend?: string;
  /** Self-hosted SearXNG base url, when that provider is in use. */
  readonly searxngUrl?: string;
}

export interface SearchHit {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}

export interface WebProvider {
  /** Stable id used by the config keys. Lowercase, hyphens allowed. */
  readonly name: string;
  /** Human label for settings screens; falls back to `name`. */
  readonly displayName?: string;
  supportsSearch(): boolean;
  supportsExtract(): boolean;
  /** Cheap availability gate: a url or key is present. Never network. */
  isAvailable(config: WebConfig): boolean;
  /** Required when `supportsSearch()` is true. */
  search?(query: string, limit: number, config: WebConfig): Promise<SearchHit[]>;
  /** Required when `supportsExtract()` is true. */
  extract?(url: string, config: WebConfig): Promise<string>;
}

/** What a plugin's `register()` gets: one method, like `PluginContext` in Hermes. */
export interface WebPluginContext {
  registerWebProvider(provider: WebProvider): void;
}
