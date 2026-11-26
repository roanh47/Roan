import type { Tool } from "../types.js";
import { connect, type CdpClient } from "./cdp.js";
import { createPage, type BrowserPage } from "./page.js";
import { actionProblem, browserParameters, browserTool } from "./surface.js";

/**
 * The browser tool's edge: is there a browser to talk to, and what does the
 * model get to call?
 *
 * "Local only" is a rule, not a default. A CDP endpoint is full control of a
 * logged-in browser, so the only endpoints accepted are a loopback address —
 * naming a host on the LAN is refused with a reason instead of being dialled.
 */

export { browserParameters, browserTool } from "./surface.js";
export type { BrowserAction, BrowserToolSurface } from "./surface.js";

/** Environment variable that names the local DevTools endpoint. */
export const BROWSER_CDP_ENV = "BROWSER_CDP_URL";

export interface BrowserAvailability {
  /** True when `url` names a usable local endpoint. */
  readonly available: boolean;
  /** The endpoint that would be used, when one was named. */
  readonly url?: string;
  /** Why the browser is not usable. Set whenever `available` is false. */
  readonly reason?: string;
}

export interface BrowserTargetOptions {
  /** An explicit endpoint; wins over the environment. */
  readonly url?: string;
  /** Environment to read `BROWSER_CDP_URL` from; defaults to `process.env`. */
  readonly env?: Record<string, string | undefined>;
}

/** Explains why `url` is not a local CDP endpoint, or undefined when it is. */
function localProblem(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `${JSON.stringify(url)} is not a url`;
  }
  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    return `${url} is not a websocket url`;
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const loopback = host === "localhost" || host.endsWith(".localhost") || host === "::1" || /^127\./.test(host);
  if (!loopback) return `${url} is not local; browser control is local-only`;
  return undefined;
}

/**
 * Decides whether the browser tool can run.
 *
 * Never throws: a missing endpoint is a refusal the model should read, not an
 * exception in the turn. The reason is always present when unavailable.
 */
export function browserAvailability(options: BrowserTargetOptions = {}): BrowserAvailability {
  const explicit = typeof options.url === "string" && options.url.trim() !== "" ? options.url.trim() : undefined;
  const env = options.env ?? process.env;
  const configured = env[BROWSER_CDP_ENV];
  const fromEnv = typeof configured === "string" && configured.trim() !== "" ? configured.trim() : undefined;
  const url = explicit ?? fromEnv;
  if (url === undefined) {
    return { available: false, reason: `browser: no CDP endpoint; set ${BROWSER_CDP_ENV} or pass a url` };
  }
  const problem = localProblem(url);
  if (problem !== undefined) return { available: false, url, reason: `browser: ${problem}` };
  return { available: true, url };
}

export interface OpenBrowserOptions extends BrowserTargetOptions {
  /** Per-call timeout in milliseconds. */
  readonly timeoutMs?: number;
  /** Connect timeout in milliseconds. */
  readonly connectTimeoutMs?: number;
}

/** A connected browser: the page actions plus the socket that owns them. */
export interface BrowserSession {
  readonly client: CdpClient;
  readonly page: BrowserPage;
  close(): void;
}

/**
 * Connects to the local browser, or refuses with the availability reason.
 *
 * The caller owns the session and must `close()` it; nothing here keeps a
 * browser alive in the background.
 */
export async function openBrowserPage(options: OpenBrowserOptions = {}): Promise<BrowserSession> {
  const availability = browserAvailability(options);
  if (!availability.available || availability.url === undefined) {
    throw new Error(availability.reason ?? "browser: no CDP endpoint");
  }
  const client = await connect(availability.url, {
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.connectTimeoutMs !== undefined ? { connectTimeoutMs: options.connectTimeoutMs } : {}),
  });
  const page = createPage(client);
  return {
    client,
    page,
    close(): void {
      client.close();
    },
  };
}

/** What the model hands `runBrowserAction`: a flat action plus its arguments. */
export interface BrowserActionInput {
  readonly action: string;
  readonly url?: unknown;
  readonly selector?: unknown;
}

/**
 * Runs one action and returns the text the model sees.
 *
 * Refusals name the missing part and, for an unknown action, the ones that
 * exist — a model that guessed "open" should learn the real name in one turn.
 */
export async function runBrowserAction(page: BrowserPage, input: BrowserActionInput): Promise<string> {
  const action = typeof input.action === "string" ? input.action.trim() : "";
  const problem = actionProblem(action);
  if (problem !== undefined) throw new Error(problem);
  switch (action) {
    case "navigate": {
      if (typeof input.url !== "string" || input.url.trim() === "") {
        throw new Error(`browser: navigate needs a url, got ${JSON.stringify(input.url ?? null)}`);
      }
      await page.navigate(input.url);
      return `navigated to ${input.url.trim()}`;
    }
    case "read":
      return page.readText();
    case "click": {
      if (typeof input.selector !== "string" || input.selector.trim() === "") {
        throw new Error(`browser: click needs a selector, got ${JSON.stringify(input.selector ?? null)}`);
      }
      await page.click(input.selector);
      return `clicked ${JSON.stringify(input.selector.trim())}`;
    }
    case "screenshot":
      return page.screenshot();
    default:
      throw new Error(`browser: unknown action ${JSON.stringify(action)}; use one of ${browserTool.actions.map((entry) => entry.name).join(", ")}`);
  }
}

/**
 * The `Tool` a registry can hold, for callers that do not build their own.
 *
 * One call is one action: the socket is opened for that action and closed
 * again, so a browser that went away cannot leave a stale session behind. The
 * action is checked before dialling, so a typo never costs a connection.
 */
export function defineBrowserTool(options: OpenBrowserOptions = {}): Tool {
  return {
    name: browserTool.name,
    description: browserTool.summary,
    parameters: browserParameters(),
    async run(args: Record<string, unknown>): Promise<string> {
      const action = typeof args["action"] === "string" ? args["action"].trim() : "";
      const problem = actionProblem(action);
      if (problem !== undefined) throw new Error(problem);
      const session = await openBrowserPage(options);
      try {
        return await runBrowserAction(session.page, {
          action,
          url: args["url"],
          selector: args["selector"],
        });
      } finally {
        session.close();
      }
    },
  };
}
