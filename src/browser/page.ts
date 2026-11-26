import type { CdpClient } from "./cdp.js";

/**
 * The four page actions a model actually needs: go somewhere, read what is
 * there, press one thing, look at the result.
 *
 * Every action reports honestly. "No element matches #pay" is a real answer the
 * model can act on; a silent `undefined` or a thrown TypeError from a made-up
 * return shape is not. Nothing here retries: a page that did not answer is a
 * fact the caller has to see.
 */

export interface PageLoad {
  /** The frame Chrome navigated; absent when a fake or old server omits it. */
  readonly frameId?: string;
}

export interface BrowserPage {
  readonly client: CdpClient;
  /** Loads `url` in the current tab. Rejects when Chrome reports a load error. */
  navigate(url: string): Promise<PageLoad>;
  /** The rendered text of the document, `document.body.innerText`. */
  readText(): Promise<string>;
  /** Clicks the first element matching `selector`. */
  click(selector: string): Promise<void>;
  /** Captures the visible page as a base64 PNG. */
  screenshot(): Promise<string>;
}

/** Reads `document.body.innerText`, or null when the document has no body. */
const READ_TEXT = "(() => { if (document.body === null) return null; return document.body.innerText; })()";

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/** The most useful sentence inside `exceptionDetails`. */
function exceptionText(details: unknown): string {
  const record = asRecord(details);
  if (typeof record["text"] === "string") return record["text"];
  const exception = asRecord(record["exception"]);
  if (typeof exception["description"] === "string") return exception["description"];
  return JSON.stringify(details);
}

/**
 * Runs one expression in the page and returns its `value`.
 *
 * A script that threw is a failure of the action, not an empty result: the
 * error names the action so the model can tell "nothing matched" from "the
 * page broke".
 */
async function evaluate(client: CdpClient, action: string, expression: string): Promise<unknown> {
  const answer = asRecord(
    await client.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }),
  );
  const details = answer["exceptionDetails"];
  if (details !== undefined && details !== null) {
    throw new Error(`browser: ${action} failed in the page: ${exceptionText(details)}`);
  }
  const raw = answer["result"];
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`browser: ${action} got no result from the page`);
  }
  return asRecord(raw)["value"];
}

export function createPage(client: CdpClient): BrowserPage {
  return {
    client,

    async navigate(url) {
      const target = typeof url === "string" ? url.trim() : "";
      if (target === "") throw new Error(`browser: navigate needs a url, got ${JSON.stringify(url)}`);
      const answer = asRecord(await client.send("Page.navigate", { url: target }));
      const errorText = answer["errorText"];
      if (typeof errorText === "string" && errorText !== "") {
        throw new Error(`browser: cannot navigate to ${target}: ${errorText}`);
      }
      const frameId = answer["frameId"];
      return typeof frameId === "string" ? { frameId } : {};
    },

    async readText() {
      const value = await evaluate(client, "readText", READ_TEXT);
      if (value === null) throw new Error("browser: the page has no body to read");
      if (typeof value !== "string") {
        const kind = value === undefined ? "no value" : typeof value;
        throw new Error(`browser: readText expected text from the page, got ${kind}`);
      }
      return value;
    },

    async click(selector) {
      const target = typeof selector === "string" ? selector.trim() : "";
      if (target === "") throw new Error(`browser: click needs a selector, got ${JSON.stringify(selector)}`);
      const expression =
        `(() => { const element = document.querySelector(${JSON.stringify(target)}); ` +
        "if (element === null) return null; element.click(); return true; })()";
      const value = await evaluate(client, "click", expression);
      if (value !== true) throw new Error(`browser: no element matches ${JSON.stringify(target)}`);
    },

    async screenshot() {
      const answer = asRecord(await client.send("Page.captureScreenshot", { format: "png" }));
      const data = answer["data"];
      if (typeof data !== "string" || data === "") {
        throw new Error("browser: screenshot returned no image data");
      }
      return data;
    },
  };
}
