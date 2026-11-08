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
  readonly onMessage: (text: string) => void;
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
        const store = options.store();
        if (!store) return;
        const event = frame["event"] as { id?: unknown; type?: unknown; data?: unknown } | undefined;
        if (!event || event.type !== "message") return;
        const data = event.data as { text?: unknown } | null;
        const text = data && typeof data.text === "string" ? data.text : "";
        if (!text.trim()) return;
        const st = options.state();
        const id = typeof event.id === "string" ? event.id : `${st.node}-${Date.now()}`;
        const stored = store.append(st.chain ?? "", { id, node: st.node ?? "app", type: "message", data: { text } });
        broadcast({ t: "append", event: stored });
        options.onMessage(text);
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
