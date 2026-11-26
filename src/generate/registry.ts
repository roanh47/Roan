import { GENERATION_KINDS, type GenerationConfig, type GenerationKind, type GenerationProvider } from "./types.js";

/**
 * Where generation providers live and how one is chosen per kind. The rules
 * are the web registry's rules: an explicit pin is strict (a wrong pin is an
 * honest error, never a silent swap), otherwise the first available provider
 * of that kind wins, in registration order.
 */
export class GenerationRegistry {
  private readonly providers = new Map<string, GenerationProvider>();

  /** Registers a provider; a same-name registration replaces the old one. */
  register(provider: GenerationProvider): void {
    const name = provider.name?.trim() ?? "";
    if (name.length === 0) throw new Error("generation provider needs a name");
    if (!GENERATION_KINDS.includes(provider.kind)) {
      throw new Error(`generation provider "${name}" has unknown kind "${String(provider.kind)}"`);
    }
    if (typeof provider.isAvailable !== "function") {
      throw new Error(`generation provider "${name}" has no isAvailable()`);
    }
    if (typeof provider.generate !== "function") {
      throw new Error(`generation provider "${name}" has no generate()`);
    }
    this.providers.set(name, provider);
  }

  get(name: string): GenerationProvider | undefined {
    return this.providers.get(name);
  }

  /** Registered providers, in registration order. */
  list(): readonly GenerationProvider[] {
    return [...this.providers.values()];
  }

  /** The configured pin for one kind, per-kind key first. */
  private pinFor(kind: GenerationKind, config: GenerationConfig): string | undefined {
    const perKind =
      kind === "image" ? config.imageBackend : kind === "video" ? config.videoBackend : config.musicBackend;
    const chosen = perKind ?? config.backend;
    return chosen !== undefined && chosen.trim().length > 0 ? chosen.trim() : undefined;
  }

  /**
   * Usable providers for a kind, in the order they should be tried. A
   * configured pin narrows the list to exactly that provider (or reports a
   * problem as a value, so the tool can say it out loud).
   */
  candidates(kind: GenerationKind, config: GenerationConfig): { providers: readonly GenerationProvider[] } | { error: string } {
    const pin = this.pinFor(kind, config);

    if (pin !== undefined) {
      const provider = this.providers.get(pin);
      if (provider === undefined) {
        return { error: `${configKey(kind)} is "${pin}", but no provider with that name is installed` };
      }
      if (provider.kind !== kind) {
        return { error: `${configKey(kind)} is "${pin}", but that provider generates ${provider.kind}, not ${kind}` };
      }
      if (!provider.isAvailable(config)) {
        return { error: `${configKey(kind)} is "${pin}", but that provider is not configured (missing url or key)` };
      }
      return { providers: [provider] };
    }

    const available = this.list().filter((provider) => provider.kind === kind && provider.isAvailable(config));
    if (available.length === 0) {
      return { error: `no ${kind} generation provider is available; pick one in Settings` };
    }
    return { providers: available };
  }
}

/** The config key a pin came from, for an error a user can act on. */
function configKey(kind: GenerationKind): string {
  return `generate.${kind}Backend`;
}

/** The one-line answer a settings screen shows: what would make an image now. */
export function describeGeneration(config: GenerationConfig, registry: GenerationRegistry, kind: GenerationKind): string {
  const picked = registry.candidates(kind, config);
  if ("error" in picked) return picked.error;
  return picked.providers.map((provider) => provider.displayName ?? provider.name).join(" → ");
}
