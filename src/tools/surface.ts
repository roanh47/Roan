import { MutableToolRegistry } from "./registry.js";

/**
 * The one surface every tool consumer reads: core tools register here at
 * import time, plugins when they load. Kept in its own module so the plugin
 * loader and the tool definitions can both reach it without an import cycle.
 */
export const toolSurface = new MutableToolRegistry({ tools: {}, workspace: process.cwd() });
