import type { SttPluginContext } from "./provider.js";
import { SttRegistry } from "./registry.js";
import { register as registerOpenAiCompat } from "./plugins/openai-compat/index.js";

/**
 * The bundled speech-to-text plugins, in registration order — the order the
 * picker tries them. A new backend is a new directory under plugins/ plus one
 * line here; nothing else changes.
 */
const BUNDLED = [registerOpenAiCompat] as const;

export function loadBundledSttPlugins(registry: SttRegistry): void {
  const ctx: SttPluginContext = { registerSttProvider: (provider) => registry.register(provider) };
  for (const register of BUNDLED) register(ctx);
}

/** A registry with exactly the bundled providers, as the app starts with. */
export function createSttRegistry(): SttRegistry {
  const registry = new SttRegistry();
  loadBundledSttPlugins(registry);
  return registry;
}
