import type { PluginContext, RoanPlugin } from "../context.js";
import type { WebPluginContext } from "../../web/types.js";
import { register as registerBing } from "../../web/plugins/bing-rss/index.js";
import { register as registerDdg } from "../../web/plugins/ddg-lite/index.js";
import { register as registerWikipedia } from "../../web/plugins/wikipedia/index.js";
import { register as registerSearxng } from "../../web/plugins/searxng/index.js";
import { register as registerPage } from "../../web/plugins/page/index.js";
import { webFetch, webSearch } from "./tools.js";

/**
 * The web plugin: it brings both halves — the tools the model calls and the
 * backends that answer them. Adding a lane is one directory under
 * `src/web/plugins/` and one line here; core stays untouched.
 */
export const webPlugin: RoanPlugin = {
  id: "web",
  register(ctx: PluginContext): void {
    ctx.registerTool(webSearch);
    ctx.registerTool(webFetch);
    const webCtx: WebPluginContext = { registerWebProvider: (provider) => ctx.registerWebProvider(provider) };
    for (const register of [registerBing, registerDdg, registerWikipedia, registerSearxng, registerPage]) {
      register(webCtx);
    }
  },
};
