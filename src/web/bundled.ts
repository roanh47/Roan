import type { WebPluginContext } from "./types.js";
import type { WebRegistry } from "./registry.js";
import { register as registerBing } from "./plugins/bing-rss/index.js";
import { register as registerDdg } from "./plugins/ddg-lite/index.js";
import { register as registerWikipedia } from "./plugins/wikipedia/index.js";
import { register as registerSearxng } from "./plugins/searxng/index.js";
import { register as registerPage } from "./plugins/page/index.js";

/**
 * The bundled web plugins, in registration order — the order the autodetect
 * walk tries them. A new backend is a new directory under plugins/ plus one
 * line here; nothing else changes.
 */
const BUNDLED = [registerBing, registerDdg, registerWikipedia, registerSearxng, registerPage] as const;

export function loadBundledWebPlugins(registry: WebRegistry): void {
  const ctx: WebPluginContext = { registerWebProvider: (provider) => registry.register(provider) };
  for (const register of BUNDLED) register(ctx);
}
