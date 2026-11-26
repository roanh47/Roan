import type { AddressInfo } from "node:net";
import { WebSocketServer, WebSocket } from "ws";

/**
 * A fake DevTools endpoint for tests: a real websocket server that speaks just
 * enough JSON-RPC to answer commands by method name.
 *
 * It is a server, not a mock of our client: the client's framing, id
 * correlation, timeouts and close handling are exercised over a real socket on
 * 127.0.0.1. Handlers decide what a method answers, so tests can be wrong on
 * purpose — slow, silent, or an error.
 */

/** A protocol error a handler can throw to answer with `error` instead of `result`. */
export class FakeCdpFault extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = "FakeCdpFault";
    this.code = code;
  }
}

export interface FakeCdpRequest {
  readonly id?: number;
  readonly method: string;
  readonly params: Record<string, unknown>;
  readonly sessionId?: string;
}

export type FakeCdpHandler = (params: Record<string, unknown>) => unknown;

export interface FakeCdpServer {
  /** A `ws://127.0.0.1:<port>/devtools/page/fake` address. */
  readonly url: string;
  /** Every frame a client sent, in order. */
  readonly requests: readonly FakeCdpRequest[];
  /** How many sockets were opened; a client that reconnects raises this. */
  readonly connections: number;
  /** Answers `method` with whatever the handler returns. */
  handle(method: string, handler: FakeCdpHandler): void;
  /** Never answers `method`, so the caller's timeout is the only way out. */
  ignore(method: string): void;
  /** Resolves once a client socket is open, so an event has somewhere to go. */
  connected(): Promise<void>;
  /** Pushes a protocol event to every open socket. */
  emit(method: string, params?: Record<string, unknown>, sessionId?: string): void;
  /** The last request for `method`, for asserting what went over the wire. */
  lastRequest(method: string): FakeCdpRequest | undefined;
  close(): Promise<void>;
}

export async function startFakeCdp(): Promise<FakeCdpServer> {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve, reject) => {
    wss.once("listening", resolve);
    wss.once("error", reject);
  });
  const address = wss.address();
  if (typeof address === "string" || address === null) {
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    throw new Error("fake cdp: server did not get a tcp address");
  }
  const url = `ws://127.0.0.1:${(address as AddressInfo).port}/devtools/page/fake`;

  const requests: FakeCdpRequest[] = [];
  const handlers = new Map<string, FakeCdpHandler>();
  const silent = new Set<string>();
  const sockets = new Set<WebSocket>();
  let connections = 0;
  let closed = false;
  const waiters: Array<() => void> = [];

  const send = (socket: WebSocket, body: Record<string, unknown>): void => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(body));
  };

  wss.on("connection", (socket: WebSocket) => {
    connections += 1;
    sockets.add(socket);
    while (waiters.length > 0) waiters.shift()?.();
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => sockets.delete(socket));
    socket.on("message", (data: unknown) => {
      const text = typeof data === "string" ? data : Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
      let frame: unknown;
      try {
        frame = JSON.parse(text);
      } catch {
        return;
      }
      if (typeof frame !== "object" || frame === null) return;
      const record = frame as Record<string, unknown>;
      const method = record["method"];
      if (typeof method !== "string") return;
      const id = typeof record["id"] === "number" ? record["id"] : undefined;
      const params =
        typeof record["params"] === "object" && record["params"] !== null
          ? (record["params"] as Record<string, unknown>)
          : {};
      const sessionId = typeof record["sessionId"] === "string" ? record["sessionId"] : undefined;
      requests.push({
        ...(id !== undefined ? { id } : {}),
        method,
        params,
        ...(sessionId !== undefined ? { sessionId } : {}),
      });
      if (id === undefined || silent.has(method)) return;
      const handler = handlers.get(method);
      if (handler === undefined) {
        send(socket, { id, error: { code: -32601, message: `method not found: ${method}` } });
        return;
      }
      let answer: unknown;
      try {
        answer = handler(params);
      } catch (error) {
        if (error instanceof FakeCdpFault) {
          send(socket, { id, error: { code: error.code, message: error.message } });
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        send(socket, { id, error: { code: -32000, message } });
        return;
      }
      void Promise.resolve(answer).then(
        (value) => send(socket, { id, result: value === undefined ? {} : value }),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          send(socket, { id, error: { code: -32000, message } });
        },
      );
    });
  });

  return {
    url,
    requests,
    get connections(): number {
      return connections;
    },
    handle(method: string, handler: FakeCdpHandler): void {
      handlers.set(method, handler);
      silent.delete(method);
    },
    ignore(method: string): void {
      handlers.delete(method);
      silent.add(method);
    },
    connected(): Promise<void> {
      if (connections > 0) return Promise.resolve();
      return new Promise((resolve) => waiters.push(resolve));
    },
    emit(method: string, params: Record<string, unknown> = {}, sessionId?: string): void {
      const body: Record<string, unknown> = { method, params };
      if (sessionId !== undefined) body["sessionId"] = sessionId;
      for (const socket of [...sockets]) send(socket, body);
    },
    lastRequest(method: string): FakeCdpRequest | undefined {
      for (let index = requests.length - 1; index >= 0; index -= 1) {
        const request = requests[index];
        if (request !== undefined && request.method === method) return request;
      }
      return undefined;
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      for (const socket of [...sockets]) socket.terminate();
      sockets.clear();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}

/** Waits `ms`; the only thing tests use it for is letting a frame cross. */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
