import type { Tool } from "../types.js";
import type { WebProvider } from "../web/types.js";
import { webRegistry } from "../web/runtime.js";
import type { PluginContext, RoanPlugin } from "./context.js";

/** Tools and providers a plugin contributed, keyed by name. */
export class PluginRegistry {
  private readonly tools = new Map<string, Tool>();

  registerTool(tool: Tool): void {
    const name = tool.name?.trim() ?? "";
    if (name.length === 0) throw new Error("plugin tool needs a name");
    this.tools.set(name, tool);
  }

  toolList(): Tool[] {
    return [...this.tools.values()];
  }

  load(plugins: readonly RoanPlugin[]): void {
    const ctx: PluginContext = {
      registerTool: (tool) => this.registerTool(tool),
      registerWebProvider: (provider: WebProvider) => webRegistry.register(provider),
    };
    for (const plugin of plugins) plugin.register(ctx);
  }
}
