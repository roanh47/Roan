/**
 * The CLI's side of the control port.
 *
 * Everything that has a request/reply shape goes through `sdk/client.ts`, which
 * is the same client an embedder uses: this file adds nothing to the protocol,
 * it only names the handful of things the CLI does.
 *
 * One exception, on purpose. `new_session` is a *fire-and-forget* frame — the
 * daemon starts a conversation and sends no reply — and the sdk models requests
 * and replies only. Rather than wait out the sdk's timeout for an answer that
 * will never come, `openLink` creates the socket itself, hands that one socket
 * to `ControlClient`, and writes the frame on it. When the sdk grows a
 * `notify()`, this can be deleted; until then it is the one place in the CLI
 * that touches a socket directly.
 */

import {
  connect,
  ControlClientError,
  type DaemonState,
  type ExportReply,
  type WebSocketFactory,
  type WebSocketLike,
} from "../sdk/client.js";

export interface LinkOptions {
  /** Milliseconds a request may wait before the link gives up. */
  readonly timeoutMs?: number;
  /** Socket factory; defaults to the runtime's global WebSocket. Tests inject one. */
  readonly socket?: WebSocketFactory;
}

export interface Link {
  /** The daemon's current view: chain, node, head, roster, sessions, model. */
  state(): Promise<DaemonState>;
  /** Appends one message; resolves with the event id that went on the wire. */
  send(text: string, session?: string): Promise<string>;
  /** Starts a conversation. The daemon answers with a pushed state frame, not a reply. */
  newSession(title?: string): Promise<void>;
  /** Exports `"chain"` or one conversation; a refusal comes back as `{ ok: false }`. */
  export(what: string): Promise<ExportReply>;
  close(): void;
}

function runtimeSocket(url: string): WebSocketLike {
  const Ctor = (globalThis as { WebSocket?: new (url: string) => WebSocketLike }).WebSocket;
  if (Ctor === undefined) {
    throw new ControlClientError(
      "this runtime has no global WebSocket (Node 22 or newer ships one)",
      "connect_failed",
    );
  }
  return new Ctor(url);
}

/**
 * Opens one link. Nothing is awaited: the first call dials, so a caller can
 * fire `state()` immediately and the failure surfaces there with the sdk's own
 * reason (`connect_failed`, `timeout`, `closed`, `bad_reply`).
 */
export function openLink(url: string, options: LinkOptions = {}): Link {
  let socket: WebSocketLike | null = null;
  let opened = false;

  const client = connect(url, {
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    // Built here rather than left to the sdk so `newSession` has the socket;
    // the sdk still owns the handshake, framing and every reply.
    socket: (target) => {
      const made = options.socket !== undefined ? options.socket(target) : runtimeSocket(target);
      socket = made;
      return made;
    },
  });

  async function state(): Promise<DaemonState> {
    const current = await client.state();
    opened = true;
    return current;
  }

  return {
    state,
    async send(text: string, session?: string): Promise<string> {
      const id = await client.send(text, session);
      opened = true;
      return id;
    },
    async newSession(title?: string): Promise<void> {
      // The handshake is the sdk's, so wait for it by asking for state once.
      if (!opened) await state();
      if (socket === null) {
        throw new ControlClientError("the control link never opened a socket", "connect_failed");
      }
      socket.send(
        JSON.stringify({ t: "new_session", ...(title !== undefined && title.length > 0 ? { title } : {}) }),
      );
    },
    async export(what: string): Promise<ExportReply> {
      const reply = await client.export(what);
      opened = true;
      return reply;
    },
    close(): void {
      client.close();
    },
  };
}
