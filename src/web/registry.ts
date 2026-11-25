import type { SearchHit, WebConfig, WebProvider } from "./types.js";

/**
 * Where providers live and how one is chosen. The rules are Hermes's rules:
 * an explicit pin is strict (a wrong pin is an honest error, never a silent
 * swap), otherwise the first available provider that supports the capability
 * wins, in registration order.
 */
export class WebRegistry {
  private readonly providers = new Map<string, WebProvider>();

  /** Registers a provider; a same-name registration replaces the old one. */
  register(provider: WebProvider): void {
    const name = provider.name?.trim() ?? "";
    if (name.length === 0) throw new Error("web provider needs a name");
    const searches = provider.supportsSearch();
    const extracts = provider.supportsExtract();
    if (!searches && !extracts) {
      throw new Error(`web provider "${name}" supports neither search nor extract`);
    }
    if (searches && typeof provider.search !== "function") {
      throw new Error(`web provider "${name}" says it searches but has no search()`);
    }
    if (extracts && typeof provider.extract !== "function") {
      throw new Error(`web provider "${name}" says it extracts but has no extract()`);
    }
    this.providers.set(name, provider);
  }

  get(name: string): WebProvider | undefined {
    return this.providers.get(name);
  }

  /** Registered providers, in registration order. */
  list(): readonly WebProvider[] {
    return [...this.providers.values()];
  }

  /**
   * Usable providers for a capability, in the order they should be tried.
   * A configured pin narrows the list to exactly that provider (and reports a
   * problem as a value, so the tool can say it out loud).
   */
  candidates(capability: "search" | "extract", config: WebConfig): { providers: readonly WebProvider[] } | { error: string } {
    const pin = capability === "search" ? (config.searchBackend ?? config.backend) : (config.extractBackend ?? config.backend);
    const supports = (provider: WebProvider): boolean =>
      capability === "search" ? provider.supportsSearch() : provider.supportsExtract();

    if (pin !== undefined && pin.trim().length > 0) {
      const provider = this.providers.get(pin.trim());
      if (provider === undefined) {
        return { error: `web.${capability}Backend is "${pin}", but no provider with that name is installed` };
      }
      if (!supports(provider)) {
        return { error: `web.${capability}Backend is "${pin}", but that provider does not support ${capability}` };
      }
      if (!provider.isAvailable(config)) {
        return { error: `web.${capability}Backend is "${pin}", but that provider is not configured (missing url or key)` };
      }
      return { providers: [provider] };
    }

    const available = this.list().filter((provider) => supports(provider) && provider.isAvailable(config));
    if (available.length === 0) {
      return { error: `no web ${capability} provider is available; pick one in Settings` };
    }
    return { providers: available };
  }
}

/** The one-line answer a settings screen shows: what would handle a search now. */
export function describeWeb(config: WebConfig, registry: WebRegistry): string {
  const picked = registry.candidates("search", config);
  if ("error" in picked) return picked.error;
  return picked.providers.map((provider) => provider.displayName ?? provider.name).join(" → ");
}

export type { SearchHit };
