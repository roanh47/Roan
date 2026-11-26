import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { startFakeCdp, wait, type FakeCdpServer } from "../testing/fake-cdp.js";
import {
  BROWSER_CDP_ENV,
  browserAvailability,
  browserParameters,
  browserTool,
  defineBrowserTool,
  openBrowserPage,
  runBrowserAction,
  type BrowserSession,
} from "./provider.js";

const LOCAL = "ws://127.0.0.1:9222/devtools/page/1";
const FROM_ENV = "ws://localhost:9333/devtools/page/2";

/** Serves the two expressions the read action sends, plus a screenshot. */
function servePage(server: FakeCdpServer): void {
  server.handle("Page.navigate", () => ({ frameId: "frame-1" }));
  server.handle("Runtime.evaluate", (params) => {
    const expression = String(params["expression"] ?? "");
    if (expression.includes("document.body === null")) {
      return { result: { type: "string", value: "Inbox: 2 unread" } };
    }
    if (expression.includes("document.querySelector")) return { result: { type: "boolean", value: true } };
    return { result: { type: "undefined" } };
  });
  server.handle("Page.captureScreenshot", () => ({ data: "iVBORw0KGgo=" }));
}

async function withSession(run: (session: BrowserSession, server: FakeCdpServer) => Promise<void>): Promise<void> {
  const server = await startFakeCdp();
  servePage(server);
  const session = await openBrowserPage({ url: server.url, timeoutMs: 1_000 });
  try {
    await run(session, server);
  } finally {
    session.close();
    await server.close();
  }
}

describe("browser availability", () => {
  it("refuses without an endpoint, and says how to set one", () => {
    const availability = browserAvailability({ env: {} });
    assert.equal(availability.available, false);
    assert.equal(availability.url, undefined);
    assert.match(availability.reason ?? "", new RegExp(`browser: no CDP endpoint; set ${BROWSER_CDP_ENV} or pass a url`));
  });

  it("reads BROWSER_CDP_URL from the environment", () => {
    const availability = browserAvailability({ env: { [BROWSER_CDP_ENV]: FROM_ENV } });
    assert.deepEqual(availability, { available: true, url: FROM_ENV });
  });

  it("lets a passed url win over the environment", () => {
    const availability = browserAvailability({ url: LOCAL, env: { [BROWSER_CDP_ENV]: FROM_ENV } });
    assert.equal(availability.available, true);
    assert.equal(availability.url, LOCAL);
  });

  it("accepts loopback by name and by address", () => {
    for (const url of [LOCAL, FROM_ENV, "ws://[::1]:9222/devtools/page/1", "wss://127.0.0.1:9222/x"]) {
      assert.equal(browserAvailability({ url, env: {} }).available, true, url);
    }
  });

  it("refuses a browser on another machine, with the reason", () => {
    const availability = browserAvailability({ url: "ws://192.168.1.20:9222/devtools/page/1", env: {} });
    assert.equal(availability.available, false);
    assert.match(availability.reason ?? "", /browser: ws:\/\/192\.168\.1\.20:9222\/devtools\/page\/1 is not local; browser control is local-only/);
  });

  it("refuses an address that is not a websocket or not a url", () => {
    assert.match(browserAvailability({ url: "http://127.0.0.1:9222/json", env: {} }).reason ?? "", /is not a websocket url/);
    assert.match(browserAvailability({ url: "not a url", env: {} }).reason ?? "", /is not a url/);
  });

  it("treats a blank setting as no setting", () => {
    assert.equal(browserAvailability({ env: { [BROWSER_CDP_ENV]: "   " } }).available, false);
    assert.equal(browserAvailability({ url: "  ", env: { [BROWSER_CDP_ENV]: FROM_ENV } }).url, FROM_ENV);
  });
});

describe("browser tool surface", () => {
  it("is one tool named browser with the four actions", () => {
    assert.equal(browserTool.name, "browser");
    assert.deepEqual(
      browserTool.actions.map((action) => action.name),
      ["navigate", "read", "click", "screenshot"],
    );
    assert.notEqual(browserTool.summary.trim(), "");
    for (const action of browserTool.actions) {
      assert.equal(typeof action.parameters, "object");
      assert.equal(Array.isArray((action.parameters as { required?: unknown }).required), true);
    }
  });

  it("requires url for navigate and selector for click", () => {
    const parameters = browserParameters() as {
      properties: Record<string, { enum?: string[] }>;
      required: string[];
    };
    assert.deepEqual(parameters.required, ["action"]);
    assert.deepEqual(parameters.properties["action"]?.enum, ["navigate", "read", "click", "screenshot"]);

    const navigate = browserTool.actions.find((action) => action.name === "navigate");
    const click = browserTool.actions.find((action) => action.name === "click");
    assert.deepEqual((navigate?.parameters as { required: string[] }).required, ["action", "url"]);
    assert.deepEqual((click?.parameters as { required: string[] }).required, ["action", "selector"]);
  });
});

describe("browser session", () => {
  it("refuses to open without an endpoint instead of guessing one", async () => {
    await assert.rejects(openBrowserPage({ env: {} }), /browser: no CDP endpoint/);
    await assert.rejects(openBrowserPage({ url: "ws://10.0.0.9:9222/x", env: {} }), /is not local; browser control is local-only/);
  });

  it("runs navigate, read, click and screenshot against the endpoint", async () => {
    await withSession(async (session, server) => {
      assert.equal(await runBrowserAction(session.page, { action: "navigate", url: "https://example.test/" }), "navigated to https://example.test/");
      assert.deepEqual(server.lastRequest("Page.navigate")?.params, { url: "https://example.test/" });
      assert.equal(await runBrowserAction(session.page, { action: "read" }), "Inbox: 2 unread");
      assert.equal(await runBrowserAction(session.page, { action: "click", selector: "#compose" }), 'clicked "#compose"');
      assert.equal(await runBrowserAction(session.page, { action: "screenshot" }), "iVBORw0KGgo=");
    });
  });

  it("refuses an unknown action with the list of real ones", async () => {
    await withSession(async (session) => {
      await assert.rejects(
        runBrowserAction(session.page, { action: "open" }),
        /browser: unknown action "open"; use one of navigate, read, click, screenshot/,
      );
      await assert.rejects(runBrowserAction(session.page, { action: "" }), /browser: no action given; use one of/);
    });
  });

  it("refuses a navigate without a url and a click without a selector", async () => {
    await withSession(async (session, server) => {
      await assert.rejects(runBrowserAction(session.page, { action: "navigate" }), /browser: navigate needs a url/);
      await assert.rejects(runBrowserAction(session.page, { action: "click" }), /browser: click needs a selector/);
      assert.equal(server.lastRequest("Page.navigate"), undefined);
      assert.equal(server.lastRequest("Runtime.evaluate"), undefined);
    });
  });

  it("reports a page error through the action instead of an empty result", async () => {
    await withSession(async (session, server) => {
      server.handle("Runtime.evaluate", () => ({
        result: { type: "object", subtype: "null", value: null },
        exceptionDetails: { text: "Uncaught TypeError: document is not defined" },
      }));
      await assert.rejects(
        runBrowserAction(session.page, { action: "read" }),
        /browser: readText failed in the page: Uncaught TypeError: document is not defined/,
      );
    });
  });
});

describe("browser tool definition", () => {
  it("is a Tool whose name and schema match the surface", () => {
    const tool = defineBrowserTool({ env: {} });
    assert.equal(tool.name, "browser");
    assert.equal(tool.description, browserTool.summary);
    assert.deepEqual(tool.parameters, browserParameters());
  });

  it("refuses with the endpoint reason when no browser is named", async () => {
    const tool = defineBrowserTool({ env: {} });
    await assert.rejects(tool.run({ action: "read" }, { cwd: "." }), /browser: no CDP endpoint/);
  });

  it("runs one action per call over its own socket", async () => {
    const server = await startFakeCdp();
    servePage(server);
    try {
      const tool = defineBrowserTool({ url: server.url, env: {}, timeoutMs: 1_000 });
      assert.equal(await tool.run({ action: "read" }, { cwd: "." }), "Inbox: 2 unread");
      assert.equal(await tool.run({ action: "navigate", url: "https://example.test/" }, { cwd: "." }), "navigated to https://example.test/");
      assert.equal(server.connections, 2, "each call closes its socket; the next call opens a new one");
    } finally {
      await server.close();
    }
  });

  it("refuses a bad action before it opens a socket", async () => {
    const server = await startFakeCdp();
    servePage(server);
    try {
      const tool = defineBrowserTool({ url: server.url, env: {} });
      await assert.rejects(tool.run({ action: "open" }, { cwd: "." }), /browser: unknown action "open"/);
      await wait(20);
      assert.equal(server.connections, 0);
    } finally {
      await server.close();
    }
  });
});
