import { GenerationRegistry } from "./registry.js";
import type { GenerationPluginContext } from "./types.js";
import { register as registerComfyui } from "./plugins/comfyui/index.js";
import { register as registerOpenAiImages } from "./plugins/openai-images/index.js";

/**
 * The bundled generation plugins, in registration order — the order the
 * autodetect walk tries them. A new backend is a new directory under plugins/
 * plus one line here; nothing else changes.
 */
const BUNDLED = [registerOpenAiImages, registerComfyui] as const;

export function loadBundledGenerationPlugins(registry: GenerationRegistry): void {
  const ctx: GenerationPluginContext = {
    registerGenerationProvider: (provider) => registry.register(provider),
  };
  for (const register of BUNDLED) register(ctx);
}
