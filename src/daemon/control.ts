import { WebSocketServer, type WebSocket } from "ws";
import type { EventStore } from "../chain/store.js";
import { encodeFrame, PROTOCOL_VERSION, type Event, type TransportFrame } from "../protocol/index.js";

export interface ControlServerOptions {
  readonly store: EventStore;
  readonly chain: string;
  readonly node: string;
  readonly port: number;
  readonly host?: string;
  /** Runs a user message; the server does not care what it does. */
  readonly onMessage: (text: string) => void;
  readonly log?: (message: string) => void;
}

export interface ControlServer {
  readonly port: number;
  broadcast(frame: TransportFrame): void;
  close(): Promise<void>;
}

function helloFrame(store: EventStore, chain: string, node: string): TransportFrame {
  return { t: "hello", v: PROTOCOL_VERSION, chain, node, haveSeq: store.head(chain) };
}

/**
 * The socket the app talks to. Same frames as the peer transport, but it never
 * replicates: the app is a viewer and a sender, not a node.
 */
export function startControlServer(options: ControlServerOptions): Promise<ControlServer> {
  const { store, chain, node } = options;
  const server = new WebSocketServer({ host: options.host ?? "127.0.0.1", port: options.port });
  const clients = new Set<WebSocket>();

  const send = (socket: WebSocket, frame: TransportFrame): void => {
    if (socket.readyState === socket.OPEN) socket.send(encodeFrame(frame));
  };

  server.on("connection", (socket) => {
    clients.add(socket);
    send(socket, helloFrame(store, chain, node));

    const backlog = store.read(chain, 1, 10_000);
    if (backlog.length > 0) send(socket, { t: "events", events: backlog });

    socket.on("message", (raw) => {
      let frame: TransportFrame;
      try {
        frame = JSON.parse(String(raw)) as TransportFrame;
      } catch {
        return;
      }
      if (frame.t !== "append") return;
      const incoming = frame.event as Event;
      if (incoming.type !== "message") return;
      const data = incoming.data as { text?: unknown } | null;
      const text = data && typeof data.text === "string" ? data.text : "";
      if (!text.trim()) return;

      const stored = store.append(chain, { id: incoming.id, node, type: "message", data: { text } });
      broadcast({ t: "append", event: stored });
      options.onMessage(text);
    });

    socket.on("close", () => clients.delete(socket));
    socket.on("error", () => clients.delete(socket));
  });

  const broadcast = (frame: TransportFrame): void => {
    for (const client of clients) send(client, frame);
  };

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.once("listening", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : options.port;
      resolve({
        port,
        broadcast,
        close: () =>
          new Promise<void>((done) => {
            for (const client of clients) client.close();
            server.close(() => done());
          }),
      });
    });
  });
}