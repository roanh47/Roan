import type { TtsPluginContext } from "./tts.js";
import { TtsRegistry } from "./registry.js";
import { register as registerOpenAiCompat } from "./plugins/openai-compat/index.js";

/**
 * The bundled text-to-speech plugins, in registration order — the order the
 * picker tries them. A new backend is a new directory under plugins/ plus one
 * line here; nothing else changes.
 */
const BUNDLED = [registerOpenAiCompat] as const;

export function loadBundledTtsPlugins(registry: TtsRegistry): void {
  const ctx: TtsPluginContext = { registerTtsProvider: (provider) => registry.register(provider) };
  for (const register of BUNDLED) register(ctx);
}

/** A registry with exactly the bundled providers, as the app starts with. */
export function createTtsRegistry(): TtsRegistry {
  const registry = new TtsRegistry();
  loadBundledTtsPlugins(registry);
  return registry;
}
