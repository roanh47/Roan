import type { Tool } from "../types.js";
import type { WebProvider } from "../web/types.js";

/**
 * What a plugin gets on load: registries it may fill. The methods are
 * generated from one registrar table (see loader.ts), so adding a capability
 * is one row there — never an `if` on the plugin's name.
 */
export interface PluginContext {
  /** Adds a model-facing tool. A same-name registration replaces the old one. */
  registerTool(tool: Tool): void;
  /** Adds a web backend behind the web tools. */
  registerWebProvider(provider: WebProvider): void;
}

/** Every plugin — bundled or dropped into the home — has this shape. */
export interface RoanPlugin {
  readonly id: string;
  /** "web", "tools", "general": informational, shown in the plugin report. */
  readonly kind?: string;
  register(ctx: PluginContext): void;
}

/** What the loader found and what happened, for a settings screen later. */
export interface PluginReport {
  readonly id: string;
  readonly kind: string;
  readonly source: "bundled" | "home";
  readonly ok: boolean;
  readonly error?: string;
}
