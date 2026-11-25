import { ensureBundledPlugins, loadHomePlugins, pluginReports } from "./loader.js";
import type { PluginReport } from "./context.js";

export type { PluginContext, RoanPlugin, PluginReport } from "./context.js";
export { ensureBundledPlugins, loadHomePlugins, pluginReports };

/** Boot helper: bundled now, home plugins when a home is known. */
export async function loadPlugins(home?: string): Promise<readonly PluginReport[]> {
  ensureBundledPlugins();
  if (home !== undefined) await loadHomePlugins(home);
  return pluginReports();
}
