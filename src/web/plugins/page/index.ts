import { assertSafeUrl, fetchText, htmlToText } from "../../http.js";
import type { WebPluginContext, WebProvider } from "../../types.js";

/** The plain page extractor: one https page, stripped to readable text. */
export const page: WebProvider = {
  name: "page",
  displayName: "Page reader",
  supportsSearch: () => false,
  supportsExtract: () => true,
  isAvailable: () => true,
  async extract(url: string): Promise<string> {
    const text = htmlToText(await fetchText(assertSafeUrl(url)));
    return text.length > 8_000 ? `${text.slice(0, 8_000)}\n…(cut)` : text.length > 0 ? text : "empty page";
  },
};

export function register(ctx: WebPluginContext): void {
  ctx.registerWebProvider(page);
}
