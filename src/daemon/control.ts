import { WebSocketServer, type WebSocket } from "ws";
import type { EventStore } from "../chain/store.js";
import { encodeFrame, PROTOCOL_VERSION, type TransportFrame } from "../protocol/index.js";
import type { ChainResponse, ControlRequest, DaemonState } from "./control-protocol.js";

export interface ControlServerOptions {
  readonly port: number;
  readonly host?: string;
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
  /** Push a chain event to every connected app window. */
  broadcast(frame: TransportFrame): void;
  /** Push a whole-state reply (used after create/join). */
  sendState(): void;
  close(): Promise<void>;
}

/**
 * The socket the app talks to on the same machine. Chain frames for viewing and
 * sending; control requests for onboarding. It never replicates.
 */
export function startControlServer(options: ControlServerOptions): Promise<ControlServer> {
  const server = new WebSocketServer({ host: options.host ?? "127.0.0.1", port: options.port });
  const clients = new Set<WebSocket>();

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

  server.on("connection", (socket) => {
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
    });

    socket.on("close", () => clients.delete(socket));
    socket.on("error", () => clients.delete(socket));
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.once("listening", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : options.port;
      resolve({
        port,
        broadcast,
        sendState,
        close: () =>
          new Promise<void>((done) => {
            for (const client of clients) client.close();
            server.close(() => done());
          }),
      });
    });
  });
}
