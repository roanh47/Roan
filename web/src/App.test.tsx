// @vitest-environment jsdom

/**
 * The two things a reader notices about the window, checked end to end against
 * the app itself: a daemon that is down is a banner (never a chat message),
 * and "New chat" opens an empty conversation with the caret in it and its row
 * marked in the rail. The socket is a double, so the daemon's side of the
 * protocol is played by the test exactly as the daemon sends it.
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import App from "./App.js";
import { ChainClient } from "./chain.js";
import type { SocketLike } from "./chain.js";
import { RAIL_EXPANDED_KEY } from "./rail.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Frame = Record<string, unknown>;

/** The smallest socket that behaves like the daemon's side of the wire. */
class FakeSocket implements SocketLike {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: Frame[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Frame);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.({});
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  receive(frame: Frame): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

function newClient(): ChainClient {
  return new ChainClient({
    url: "ws://test/ws",
    node: "phone",
    socketFactory: (url) => new FakeSocket(url),
    reconnect: false,
  });
}

const STATE = {
  chain: "chain-1",
  node: "phone",
  invite: null,
  peers: [],
  nodes: [],
  sessions: [{ id: "s1", title: "Poortvraag", messages: 2 }],
  activeSession: "s1",
  model: "test-model",
  provider: "test-provider",
};

let container: HTMLDivElement;
let root: Root;
let client: ChainClient;

beforeEach(() => {
  localStorage.clear();
  FakeSocket.instances = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  client = newClient();
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

async function mount(): Promise<void> {
  await act(async () => {
    root.render(<App client={client} />);
  });
}

function socket(): FakeSocket {
  const last = FakeSocket.instances.at(-1);
  if (last === undefined) throw new Error("the app opened no socket");
  return last;
}

/** What the daemon does on a good day: accept, name the chain, then state. */
async function connect(state: typeof STATE = STATE): Promise<void> {
  await act(async () => {
    socket().open();
  });
  await act(async () => {
    socket().receive({ t: "hello", v: 1, chain: state.chain, node: "daemon", haveSeq: 0 });
  });
  await act(async () => {
    socket().receive({ t: "state", data: state });
  });
}

function query<T extends Element>(selector: string): T {
  const element = container.querySelector<T>(selector);
  if (element === null) throw new Error(`no ${selector} in the window`);
  return element;
}

async function click(selector: string): Promise<void> {
  await act(async () => {
    (query(selector) as HTMLElement).click();
  });
}

describe("the daemon's state in the window", () => {
  it("is a top banner while the socket is down, and gone once it opens", async () => {
    await mount();
    expect(query(".connbanner").textContent).toContain("Daemon not connected");

    await connect();
    expect(container.querySelector(".connbanner")).toBeNull();

    await act(async () => {
      socket().close();
    });
    expect(query(".connbanner").textContent).toContain("the connection to the daemon closed");
    expect(query(".connbanner__retry").textContent).toBe("Retry");
  });

  it("retries from the banner by opening a fresh socket", async () => {
    await mount();
    await connect();
    await act(async () => {
      socket().close();
    });
    const before = FakeSocket.instances.length;
    await click(".connbanner__retry");
    expect(FakeSocket.instances.length).toBe(before + 1);
  });

  it("keeps the composer and transcript looking like chat, not like a connection", async () => {
    await mount();
    await connect();
    // The daemon goes away after the conversation was already on screen.
    await act(async () => {
      socket().close();
    });
    expect(query<HTMLTextAreaElement>("#composer-input").placeholder).toBe("Message Roan");
    expect(container.textContent).not.toMatch(/waiting for the daemon/i);
    expect(container.textContent).not.toMatch(/connecting to the daemon/i);
  });
});

describe("New chat", () => {
  it("opens an empty conversation, marks its rail row and focuses the composer", async () => {
    await mount();
    await connect();

    await click(".rail__new");
    expect(socket().sent.some((frame) => frame.t === "new_session")).toBe(true);

    // The daemon answers with the id it just opened. Its named summary follows
    // in a later state frame; until then the rail still marks the row.
    await act(async () => {
      socket().receive({ t: "new_session", session: "s2" });
    });

    const active = query(".rail__row--active");
    expect(active.textContent).toContain("New chat");
    expect(active.querySelector('[aria-current="true"]')).not.toBeNull();
    expect(query(".empty__title").textContent).toBe("Where should we start?");
    expect(document.activeElement).toBe(query("#composer-input"));

    // The daemon's own summary takes the row over without losing the mark.
    await act(async () => {
      socket().receive({
        t: "state",
        data: {
          ...STATE,
          sessions: [
            { id: "s1", title: "Poortvraag", messages: 2 },
            { id: "s2", title: "Gesprek 2", messages: 0 },
          ],
          activeSession: "s2",
        },
      });
    });
    expect(query(".rail__row--active").textContent).toContain("Gesprek 2");

    // The chain also records the session marker; it is history, not content,
    // so the invitation stays on an otherwise empty conversation.
    await act(async () => {
      socket().receive({
        t: "append",
        event: {
          v: 1,
          chain: "chain-1",
          seq: 1,
          id: "e-s2",
          node: "phone",
          ts: 1,
          type: "session",
          data: { id: "s2", title: "Gesprek 2" },
        },
      });
    });
    expect(query(".empty__title").textContent).toBe("Where should we start?");
    expect(container.querySelector(".chatmeta")).toBeNull();
  });
});

describe("the rail at a wide width", () => {
  it("starts open and remembers being folded", async () => {
    await mount();
    await connect();

    const app = query(".app");
    expect(app.classList.contains("app--rail-collapsed")).toBe(false);
    expect(query(".titlebar__railtoggle").getAttribute("aria-expanded")).toBe("true");

    await click(".titlebar__railtoggle");
    expect(query(".app").classList.contains("app--rail-collapsed")).toBe(true);
    expect(query(".titlebar__railtoggle").getAttribute("aria-label")).toBe("Show sidebar");
    expect(localStorage.getItem(RAIL_EXPANDED_KEY)).toBe("0");

    // A reload: a fresh window, the same preference.
    await act(async () => {
      root.unmount();
    });
    container.remove();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    client = newClient();
    await mount();
    await connect();

    expect(query(".app").classList.contains("app--rail-collapsed")).toBe(true);
    expect(query(".titlebar__railtoggle").getAttribute("aria-expanded")).toBe("false");
  });
});
