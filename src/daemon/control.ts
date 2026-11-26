import { createServer, type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import type { EventStore } from "../chain/store.js";
import { encodeFrame, PROTOCOL_VERSION, type TransportFrame } from "../protocol/index.js";
import type { ChainResponse, ControlRequest, DaemonState } from "./control-protocol.js";
import { createWebHandler, defaultWebDist, isLoopbackAddress, isTailnetAddress } from "./control-http.js";

/** One WebSocket protocol on the shared port. Same shape `ws` hands to `upgrade`. */
export type UpgradeHandler = (req: IncomingMessage, socket: Duplex, head: Buffer) => void;

/** What the control socket needs to know about a removal: done, or why not. */
export type RemoveOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export interface ControlServerOptions {
  readonly port: number;
  readonly host?: string;
  /**
   * Where the built UI lives. Defaults to `ROAN_WEB_DIST`, then `web/dist`
   * next to the package root. A missing directory is not an error: the socket
   * still works and the page says the UI was not built.
   */
  readonly webDist?: string;
  /** The daemon's own output, served as text/plain at `/log` on this port. */
  readonly logText?: () => string;
  /**
   * Whether this address may open the control socket. Loopback by default:
   * the app runs on the same machine as the daemon it talks to. A wider bind
   * (`ROAN_HOST`) makes the UI reachable; the socket stays closed unless the
   * caller is local or the operator set `ROAN_ALLOW_REMOTE_CONTROL=1`.
   */
  readonly isLocal?: (address: string | undefined) => boolean;
  /** null until a chain exists on this machine. */
  readonly store: () => EventStore | null;
  readonly state: () => DaemonState;
  onMessage: (
    text: string,
    session?: string,
    echoId?: string,
    image?: { mime: string; data: string },
  ) => void;
  /** Starts a new conversation without touching the old one. */
  readonly onNewSession?: (title?: string) => string | null;
  /** Names a conversation differently; appended, never rewriting history. */
  readonly onRenameSession?: (session: string, title: string) => void;
  /**
   * Leaves the chain this node is in. The daemon archives the identity and the
   * chain and comes back up in onboarding; the connection the frame came in
   * on will drop on the way out.
   */
  readonly onLeaveChain?: () => void;
  /** Names a node differently; a fresh announcement, so it rides the chain. */
  readonly onRenameNode?: (node: string, name: string) => void;
  /**
   * Takes another device out of the chain: one `node_remove` event that every
   * device folds. The device itself is never removable from here — a machine
   * that is running is not a ghost, and its own announcement would put it back
   * on the next fold. A refusal is returned rather than thrown, because the app
   * shows the reason.
   */
  readonly onRemoveNode?: (node: string) => RemoveOutcome;
  /** Marks a point in the current conversation you can come back to. */
  readonly onCheckpoint?: (label?: string) => void;
  /** Starts a new conversation from an earlier point; nothing is deleted. */
  readonly onRewind?: (seq: number) => void;
  /**
   * Everything the app can ask that is not a chain action: list files, save a
   * schedule, change the model. The handler answers with one value, which goes
   * back as a reply frame with the same id.
   */
  readonly onRequest?: (
    kind: string,
    data: Record<string, unknown>,
    reply: (value: unknown) => void,
  ) => void;
  readonly onCreate: () => Promise<ChainResponse>;
  readonly onJoin: (code: string) => Promise<ChainResponse>;
  readonly log?: (message: string) => void;
}

export interface ControlServer {
  readonly port: number;
  /** `http://host:port`, the address to open in a browser. */
  readonly url: string;
  /**
   * Routes another WebSocket protocol on this same HTTP server — peer sync
   * lives on `/peer` that way, so a machine exposes one port and not three.
   * Returns the unmount, which removes the route if it is still the one there.
   */
  mountUpgrade(path: string, handler: UpgradeHandler): () => void;
  /** Push a chain event to every connected app window. */
  broadcast(frame: TransportFrame): void;
  /** Push a whole-state reply (used after create/join). */
  sendState(): void;
  close(): Promise<void>;
}

/** A polite refusal on a socket that was about to become a WebSocket. */
function refuseUpgrade(socket: Duplex, status: number, reason: string, body: string): void {
  if (socket.destroyed) return;
  socket.write(
    "HTTP/1.1 " +
      String(status) +
      " " +
      reason +
      "\r\nconnection: close\r\ncontent-type: text/plain; charset=utf-8\r\ncontent-length: " +
      String(Buffer.byteLength(body)) +
      "\r\n\r\n" +
      body,
  );
  socket.destroy();
}

/**
 * A peer authenticates with the chain token, in the `Authorization` header or a
 * `?token=` parameter. The control socket takes neither, so a request that
 * carries one is a peer that dialed the wrong path.
 */
function presentsChainToken(req: IncomingMessage): boolean {
  const header = req.headers["authorization"];
  if (typeof header === "string" && /^bearer\s/i.test(header)) return true;
  try {
    return new URL(req.url ?? "/", "http://localhost").searchParams.has("token");
  } catch {
    return false;
  }
}

/**
 * The one port the app talks to: the built UI over HTTP, the chain frames on
 * `/ws`, and whatever else a sibling mounts (`/peer` for sync). Chain frames
 * for viewing and sending; control requests for onboarding. It never
 * replicates.
 */
export function startControlServer(options: ControlServerOptions): Promise<ControlServer> {
  const host = options.host ?? "127.0.0.1";
  const isLocal = options.isLocal ?? ((address: string | undefined) => isLoopbackAddress(address) || isTailnetAddress(address));
  const mounts = new Map<string, UpgradeHandler>();
  const clients = new Set<WebSocket>();

  const dist = options.webDist ?? process.env["ROAN_WEB_DIST"] ?? defaultWebDist();
  const server = createServer(createWebHandler({ dist, ...(options.logText === undefined ? {} : { log: options.logText }) }));
  const wss = new WebSocketServer({ noServer: true });

  const log = (message: string): void => options.log?.(message);

  server.on("upgrade", (req, socket, head) => {
    let pathname: string;
    try {
      pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    } catch {
      refuseUpgrade(socket, 400, "Bad Request", "bad request\n");
      return;
    }

    const mounted = mounts.get(pathname);
    if (mounted !== undefined) {
      mounted(req, socket, head);
      return;
    }

    // `/` is the legacy path the app connected to before `/ws` existed; both
    // speak the same frames.
    if (pathname !== "/ws" && pathname !== "/") {
      refuseUpgrade(socket, 404, "Not Found", "no websocket on " + pathname + "\n");
      return;
    }
    if (presentsChainToken(req)) {
      log("control: refused a peer token on " + pathname + " (peers live on /peer)");
      refuseUpgrade(socket, 403, "Forbidden", "the control socket takes no chain token; peers connect on /peer\n");
      return;
    }
    if (!isLocal(req.socket.remoteAddress)) {
      log(
        "control: refused " +
          (req.socket.remoteAddress ?? "unknown") +
          " on " +
          pathname +
          " (loopback only; set ROAN_ALLOW_REMOTE_CONTROL=1 to allow it)",
      );
      refuseUpgrade(
        socket,
        403,
        "Forbidden",
        "the control socket is loopback only; set ROAN_ALLOW_REMOTE_CONTROL=1 on the daemon to allow remote control\n",
      );
      return;
    }

    wss.handleUpgrade(req, socket, head, (client) => wss.emit("connection", client, req));
  });

  const send = (socket: WebSocket, payload: unknown): void => {
    if (socket.readyState === socket.OPEN) socket.send(typeof payload === "string" ? payload : JSON.stringify(payload));
  };

  const greet = (socket: WebSocket): void => {
    const store = options.store();
    if (!store) {
      send(socket, { t: "state", data: options.state() });
      return;
    }
    const st = options.state();
    send(socket, encodeFrame({ t: "hello", v: PROTOCOL_VERSION, chain: st.chain ?? "", node: st.node ?? "", haveSeq: st.head }));
    send(socket, { t: "state", data: st });
    const backlog = store.read(st.chain ?? "", 1, 10_000);
    if (backlog.length > 0) send(socket, encodeFrame({ t: "events", events: backlog }));
  };

  const broadcast = (frame: TransportFrame): void => {
    const text = encodeFrame(frame);
    for (const client of clients) if (client.readyState === client.OPEN) client.send(text);
  };

  const sendState = (): void => {
    const payload = { t: "state", data: options.state() };
    for (const client of clients) send(client, payload);
  };

  wss.on("connection", (socket) => {
    clients.add(socket);
    greet(socket);

    socket.on("message", (raw) => {
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(String(raw)) as Record<string, unknown>;
      } catch {
        return;
      }

      const type = frame["t"];
      if (type === "hello") {
        // Two different handshakes reach this branch, and only one of them is
        // a peer: a peer hello carries the chain token and belongs on `/peer`.
        // The app's own client sends a tokenless hello on `/ws` — answering it
        // with 1008 is what made every client look disconnected while the
        // daemon was running perfectly well.
        if (typeof frame["token"] === "string") {
          log("control: refused a peer hello on /ws (peers connect on /peer)");
          socket.close(1008, "peer protocol lives on /peer");
          clients.delete(socket);
          return;
        }
        const current = options.state();
        send(socket, {
          t: "hello",
          v: 1,
          chain: current.chain,
          node: current.node,
          haveSeq: current.head,
        });
        send(socket, { t: "state", data: current });
        return;
      }
      if (type === "state") {
        send(socket, { t: "state", data: options.state() });
        return;
      }
      if (type === "create_chain" || type === "join_chain") {
        const code = typeof frame["code"] === "string" ? frame["code"] : "";
        const run = async (): Promise<void> => {
          try {
            const response = type === "create_chain" ? await options.onCreate() : await options.onJoin(code);
            send(socket, response);
            greet(socket);
          } catch (err) {
            send(socket, { t: "control_error", message: err instanceof Error ? err.message : String(err) });
          }
        };
        void run();
        return;
      }
      if (type === "append") {
        const event = frame["event"] as { id?: unknown; data?: unknown } | undefined;
        const data = event?.data as { text?: unknown; session?: unknown; image?: unknown } | null | undefined;
        const text = data && typeof data.text === "string" ? data.text : "";
        if (!text.trim()) return;
        // The daemon writes the message, because only it can decide which
        // session it belongs to and keep that decision in the same order. The
        // client's event id travels along: the app drops its pending bubble
        // when the echo with the same id arrives, so the sent message never
        // shows up twice.
        const session = data && typeof data.session === "string" ? data.session : undefined;
        const rawImage = data?.image;
        const image =
          typeof rawImage === "object" &&
          rawImage !== null &&
          typeof (rawImage as { mime?: unknown }).mime === "string" &&
          typeof (rawImage as { data?: unknown }).data === "string" &&
          ((rawImage as { data?: unknown }).data as string).length > 0 &&
          ((rawImage as { data?: unknown }).data as string).length < 1_600_000
            ? {
                mime: (rawImage as { mime: string }).mime,
                data: (rawImage as { data: string }).data,
              }
            : undefined;
        const echoId =
          event !== undefined && typeof event.id === "string" && event.id.length > 0
            ? event.id
            : undefined;
        options.onMessage(text, session, echoId, image);
      }
      if (type === "checkpoint") {
        options.onCheckpoint?.(typeof frame["label"] === "string" ? frame["label"] : undefined);
      }
      if (type === "rewind") {
        if (typeof frame["seq"] === "number") options.onRewind?.(frame["seq"]);
      }
      // Anything the app asks that is not a chain action: files, schedules,
      // models. One request, one reply carrying the same id.
      if (
        options.onRequest !== undefined &&
        typeof type === "string" &&
        type !== "state" &&
        type !== "append" &&
        type !== "new_session" &&
        type !== "rename_session" &&
        type !== "leave_chain" &&
        type !== "rename_node" &&
        type !== "node_remove" &&
        type !== "checkpoint" &&
        type !== "rewind"
      ) {
        // Correlation rides on `req`: `id` belongs to the request data (a
        // provider account id, for instance) and must not double as the reply
        // address.
        const id = typeof frame["req"] === "string" ? frame["req"] : null;
        let answered = false;
        // Sent straight back to the socket that asked: a reply is not part of
        // the chain protocol, so it must not go through the peer encoder.
        void Promise.resolve(
          options.onRequest(type, frame as Record<string, unknown>, (value) => {
            if (answered || id === null) return;
            answered = true;
            send(socket, { t: "reply", id, data: value });
          }),
        );
        return;
      }
      if (type === "new_session") {
        const title = typeof frame["title"] === "string" ? frame["title"] : undefined;
        // Tell the caller which conversation it just opened: without the id the
        // client keeps showing whatever it guessed was the newest one.
        const session = options.onNewSession?.(title) ?? null;
        send(socket, { t: "new_session", ...(session !== null ? { session } : {}) });
      }
      if (type === "rename_session") {
        const session = typeof frame["session"] === "string" ? frame["session"] : "";
        const title = typeof frame["title"] === "string" ? frame["title"].trim() : "";
        if (session.length > 0 && title.length > 0) options.onRenameSession?.(session, title);
      }
      if (type === "leave_chain") {
        options.onLeaveChain?.();
      }
      if (type === "rename_node") {
        const node = typeof frame["node"] === "string" ? frame["node"] : "";
        const name = typeof frame["name"] === "string" ? frame["name"].trim() : "";
        if (node.length > 0 && name.length > 0) options.onRenameNode?.(node, name);
      }
      if (type === "node_remove") {
        const wanted = typeof frame["node"] === "string" ? frame["node"].trim() : "";
        if (wanted.length === 0) {
          send(socket, {
            t: "control_error",
            message: "node_remove needs the id of the device to remove",
          });
          return;
        }
        const result = options.onRemoveNode?.(wanted) ?? {
          ok: false,
          message: "this daemon cannot remove devices",
        };
        // Only a refusal says anything: on success the chain itself is the
        // answer, and the app sees it as the usual append plus state push.
        if (!result.ok) send(socket, { t: "control_error", message: result.message });
      }
    });

    socket.on("close", () => clients.delete(socket));
    socket.on("error", () => clients.delete(socket));
  });

  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once("error", onError);
    server.listen(options.port, host, () => {
      server.off("error", onError);
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : options.port;
      resolve({
        port,
        url: "http://" + host + ":" + String(port),
        mountUpgrade(path: string, handler: UpgradeHandler): () => void {
          mounts.set(path, handler);
          return () => {
            if (mounts.get(path) === handler) mounts.delete(path);
          };
        },
        broadcast,
        sendState,
        close: () =>
          new Promise<void>((done) => {
            for (const client of clients) client.close();
            wss.close();
            // Keep-alive HTTP sockets (the page and its assets) would otherwise
            // hold the close open until they time out.
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
}
