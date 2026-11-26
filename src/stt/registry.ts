import type { SpeechAudio, SttConfig, SttProvider } from "./provider.js";

/**
 * Where speech-to-text providers live and how one is chosen. The rules are the
 * web registry's rules: an explicit pin is strict (a wrong pin is an honest
 * error, never a silent swap), otherwise the first available provider wins, in
 * registration order.
 */
export class SttRegistry {
  private readonly providers = new Map<string, SttProvider>();

  /** Registers a provider; a same-name registration replaces the old one. */
  register(provider: SttProvider): void {
    const name = provider.name?.trim() ?? "";
    if (name.length === 0) throw new Error("stt provider needs a name");
    if (typeof provider.transcribe !== "function") {
      throw new Error(`stt provider "${name}" has no transcribe()`);
    }
    this.providers.set(name, provider);
  }

  get(name: string): SttProvider | undefined {
    return this.providers.get(name);
  }

  /** Registered providers, in registration order. */
  list(): readonly SttProvider[] {
    return [...this.providers.values()];
  }

  /** Usable providers, in the order they should be tried. */
  available(config: SttConfig): readonly SttProvider[] {
    return this.list().filter((provider) => provider.isAvailable(config));
  }

  /**
   * Who would transcribe now. A configured pin narrows the list to exactly that
   * provider (and reports a problem as a value, so the UI can say it out loud).
   */
  candidates(config: SttConfig): { providers: readonly SttProvider[] } | { error: string } {
    const pin = config.backend?.trim() ?? "";
    if (pin.length > 0) {
      const provider = this.providers.get(pin);
      if (provider === undefined) {
        return { error: `stt.backend is "${pin}", but no speech-to-text provider with that name is installed` };
      }
      if (!provider.isAvailable(config)) {
        return { error: `stt.backend is "${pin}", but that provider is not configured (missing url or model)` };
      }
      return { providers: [provider] };
    }

    const available = this.available(config);
    if (available.length === 0) {
      return {
        error:
          "no speech-to-text provider is available; set one up in Settings (a local OpenAI-compatible server needs a url and a model)",
      };
    }
    return { providers: available };
  }

}

/** The one-line answer a settings screen shows: what would transcribe now. */
export function describeStt(config: SttConfig, registry: SttRegistry): string {
  const picked = registry.candidates(config);
  if ("error" in picked) return picked.error;
  return picked.providers.map((provider) => provider.displayName ?? provider.name).join(" → ");
}

export type { SpeechAudio };
