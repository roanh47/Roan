import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { startFakeCdp, type FakeCdpServer } from "../testing/fake-cdp.js";
import { connect } from "./cdp.js";
import { createPage, type BrowserPage } from "./page.js";

/**
 * A fake page: the server answers `Runtime.evaluate` the way Chrome would for
 * the two expressions this client sends, so the round trip is the thing under
 * test — not a mock of `BrowserPage`.
 */
interface FakeDom {
  readonly text: string;
  readonly hasBody: boolean;
  readonly elements: readonly string[];
  readonly clicks: string[];
}

const SELECTOR = /document\.querySelector\(("(?:[^"\\]|\\.)*")\)/;

function serveDom(server: FakeCdpServer, dom: FakeDom): void {
  server.handle("Page.navigate", (params) => {
    const url = String(params["url"] ?? "");
    if (url.startsWith("http://broken.test")) {
      return { frameId: "frame-1", errorText: "net::ERR_NAME_NOT_RESOLVED" };
    }
    return { frameId: "frame-1", loaderId: "loader-1" };
  });
  server.handle("Runtime.evaluate", (params) => {
    const expression = String(params["expression"] ?? "");
    if (expression.includes("document.body === null")) {
      return { result: { type: dom.hasBody ? "string" : "object", value: dom.hasBody ? dom.text : null } };
    }
    const match = SELECTOR.exec(expression);
    if (match === null) return { result: { type: "undefined" } };
    const raw = match[1];
    if (raw === undefined) return { result: { type: "undefined" } };
    const selector = String(JSON.parse(raw));
    if (!dom.elements.includes(selector)) return { result: { type: "object", subtype: "null", value: null } };
    dom.clicks.push(selector);
    return { result: { type: "boolean", value: true } };
  });
  server.handle("Page.captureScreenshot", () => ({ data: "iVBORw0KGgo=" }));
}

async function withPage(
  dom: FakeDom,
  run: (page: BrowserPage, server: FakeCdpServer) => Promise<void>,
): Promise<void> {
  const server = await startFakeCdp();
  const client = await connect(server.url, { timeoutMs: 1_000 });
  try {
    serveDom(server, dom);
    await run(createPage(client), server);
  } finally {
    client.close();
    await server.close();
  }
}

function dom(overrides: Partial<FakeDom> = {}): FakeDom {
  return { text: "", hasBody: true, elements: [], clicks: [], ...overrides };
}

describe("browser page", () => {
  it("navigates and returns the frame Chrome reports", async () => {
    await withPage(dom(), async (page, server) => {
      const loaded = await page.navigate(" https://example.test/inbox ");
      assert.deepEqual(loaded, { frameId: "frame-1" });
      assert.deepEqual(server.lastRequest("Page.navigate")?.params, { url: "https://example.test/inbox" });
    });
  });

  it("refuses an empty url before it talks to the browser", async () => {
    await withPage(dom(), async (page, server) => {
      await assert.rejects(page.navigate("   "), /browser: navigate needs a url/);
      assert.equal(server.lastRequest("Page.navigate"), undefined);
    });
  });

  it("reports the load error Chrome gave instead of pretending it worked", async () => {
    await withPage(dom(), async (page) => {
      await assert.rejects(
        page.navigate("http://broken.test/"),
        /browser: cannot navigate to http:\/\/broken\.test\/: net::ERR_NAME_NOT_RESOLVED/,
      );
    });
  });

  it("reads document.body.innerText", async () => {
    await withPage(dom({ text: "Inbox\n2 unread" }), async (page) => {
      assert.equal(await page.readText(), "Inbox\n2 unread");
    });
  });

  it("says so when the page has no body to read", async () => {
    await withPage(dom({ hasBody: false }), async (page) => {
      await assert.rejects(page.readText(), /browser: the page has no body to read/);
    });
  });

  it("surfaces a page script that threw", async () => {
    await withPage(dom(), async (page, server) => {
      server.handle("Runtime.evaluate", () => ({
        result: { type: "object", subtype: "error" },
        exceptionDetails: { text: "Uncaught SyntaxError: Invalid selector" },
      }));
      await assert.rejects(page.readText(), /browser: readText failed in the page: Uncaught SyntaxError: Invalid selector/);
    });
  });

  it("clicks the matching element", async () => {
    const state = dom({ elements: ["button.send"] });
    await withPage(state, async (page, server) => {
      await page.click("button.send");
      assert.deepEqual(state.clicks, ["button.send"]);
      const expression = String(server.lastRequest("Runtime.evaluate")?.params["expression"] ?? "");
      assert.equal(expression.includes("document.querySelector"), true);
      assert.equal(expression.includes(".click()"), true);
    });
  });

  it("is honest when no element matches the selector", async () => {
    await withPage(dom({ elements: ["button.send"] }), async (page) => {
      await assert.rejects(page.click("#pay-now"), /browser: no element matches "#pay-now"/);
      await assert.rejects(page.click("  "), /browser: click needs a selector/);
    });
  });

  it("returns the base64 screenshot Chrome captured", async () => {
    await withPage(dom(), async (page, server) => {
      assert.equal(await page.screenshot(), "iVBORw0KGgo=");
      assert.deepEqual(server.lastRequest("Page.captureScreenshot")?.params, { format: "png" });
    });
  });

  it("fails when the screenshot has no data", async () => {
    await withPage(dom(), async (page, server) => {
      server.handle("Page.captureScreenshot", () => ({}));
      await assert.rejects(page.screenshot(), /browser: screenshot returned no image data/);
    });
  });
});
