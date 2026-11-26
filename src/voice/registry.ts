import type { TtsConfig, TtsProvider } from "./tts.js";

/**
 * Where text-to-speech providers live and how one is chosen. Same rules as the
 * stt and web registries: an explicit pin is strict (a wrong pin is an honest
 * error, never a silent swap), otherwise the first available provider wins, in
 * registration order.
 */
export class TtsRegistry {
  private readonly providers = new Map<string, TtsProvider>();

  /** Registers a provider; a same-name registration replaces the old one. */
  register(provider: TtsProvider): void {
    const name = provider.name?.trim() ?? "";
    if (name.length === 0) throw new Error("tts provider needs a name");
    if (typeof provider.speak !== "function") {
      throw new Error(`tts provider "${name}" has no speak()`);
    }
    this.providers.set(name, provider);
  }

  get(name: string): TtsProvider | undefined {
    return this.providers.get(name);
  }

  /** Registered providers, in registration order. */
  list(): readonly TtsProvider[] {
    return [...this.providers.values()];
  }

  /** Usable providers, in the order they should be tried. */
  available(config: TtsConfig): readonly TtsProvider[] {
    return this.list().filter((provider) => provider.isAvailable(config));
  }

  /**
   * Who would speak now. A configured pin narrows the list to exactly that
   * provider (and reports a problem as a value, so the UI can say it out loud).
   */
  candidates(config: TtsConfig): { providers: readonly TtsProvider[] } | { error: string } {
    const pin = config.backend?.trim() ?? "";
    if (pin.length > 0) {
      const provider = this.providers.get(pin);
      if (provider === undefined) {
        return { error: `tts.backend is "${pin}", but no text-to-speech provider with that name is installed` };
      }
      if (!provider.isAvailable(config)) {
        return { error: `tts.backend is "${pin}", but that provider is not configured (missing url or model)` };
      }
      return { providers: [provider] };
    }

    const available = this.available(config);
    if (available.length === 0) {
      return {
        error:
          "no text-to-speech provider is available; set one up in Settings (a local OpenAI-compatible server needs a url and a model)",
      };
    }
    return { providers: available };
  }
}

/** The one-line answer a settings screen shows: what would speak now. */
export function describeTts(config: TtsConfig, registry: TtsRegistry): string {
  const picked = registry.candidates(config);
  if ("error" in picked) return picked.error;
  return picked.providers.map((provider) => provider.displayName ?? provider.name).join(" → ");
}
