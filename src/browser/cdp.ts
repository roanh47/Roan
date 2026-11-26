import { WebSocket } from "ws";

/**
 * A minimal Chrome DevTools Protocol client over one websocket.
 *
 * Scope is deliberately small: `send` correlates a request with its answer by
 * id, `on` subscribes to protocol events, `close` ends the session. There is no
 * reconnection, no session discovery and no `Runtime.enable` dance — a dropped
 * socket is reported to the caller, who decides what to do next. A tool that
 * silently reconnects would answer about a different page than the one the
 * model was looking at.
 */

/** How long one call may wait for its answer before it fails. */
export const CDP_TIMEOUT_MS = 10_000;

/** How long a connect may wait for the socket to open. */
export const CDP_CONNECT_MS = 5_000;

export type CdpParams = Record<string, unknown>;

/** An event subscriber; `sessionId` is set for events of a flattened session. */
export type CdpHandler = (params: CdpParams, sessionId?: string) => void;

export interface CdpClient {
  /** The websocket this client speaks on. */
  readonly url: string;
  /** True after `close()` or after the socket went away. */
  readonly closed: boolean;
  /**
   * Sends one command and resolves with its `result`.
   *
   * Rejects with a message naming the method when the socket is closed, when
   * the server answers with an error, or when no answer arrives in time.
   */
  send(method: string, params?: CdpParams, sessionId?: string): Promise<unknown>;
  /**
   * Subscribes to protocol events by method name, e.g. `Page.loadEventFired`.
   * The reserved name `close` fires with `{ reason }` when the socket ends.
   * Returns an unsubscribe function.
   */
  on(method: string, handler: CdpHandler): () => void;
  /** Ends the socket and rejects every call still in flight. */
  close(): void;
}

export interface CdpOptions {
  /** Per-call timeout in milliseconds. */
  readonly timeoutMs?: number;
  /** Connect timeout in milliseconds. */
  readonly connectTimeoutMs?: number;
}

interface Pending {
  readonly method: string;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

/** Turns a websocket frame into text, whatever shape `ws` handed us. */
function textOf(data: unknown): string {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data as Buffer[]).toString("utf8");
  return String(data);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/** One line for a protocol error, including the method that failed. */
function protocolError(method: string, error: unknown): string {
  const record = asRecord(error);
  const message = typeof record["message"] === "string" ? record["message"] : JSON.stringify(error);
  const code = typeof record["code"] === "number" ? ` (code ${record["code"]})` : "";
  return `cdp: ${method} failed: ${message}${code}`;
}

/**
 * Opens a CDP websocket and resolves with a client for it.
 *
 * The url must be a `ws://` or `wss://` address. Refusing anything else here
 * keeps a typo from looking like a dead browser.
 */
export function connect(wsUrl: string, options: CdpOptions = {}): Promise<CdpClient> {
  const trimmed = typeof wsUrl === "string" ? wsUrl.trim() : "";
  if (!/^wss?:\/\//i.test(trimmed)) {
    return Promise.reject(new Error(`cdp: not a websocket url: ${JSON.stringify(wsUrl)}`));
  }
  const url = trimmed;
  const timeoutMs = options.timeoutMs ?? CDP_TIMEOUT_MS;
  const connectTimeoutMs = options.connectTimeoutMs ?? CDP_CONNECT_MS;

  let socket: WebSocket;
  try {
    socket = new WebSocket(url);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return Promise.reject(new Error(`cdp: cannot connect to ${url}: ${reason}`));
  }

  return new Promise<CdpClient>((resolve, reject) => {
    const pending = new Map<number, Pending>();
    const handlers = new Map<string, Set<CdpHandler>>();
    let nextId = 0;
    let closed = false;
    let opened = false;
    let connectSettled = false;

    const connectTimer = setTimeout(() => {
      if (connectSettled) return;
      connectSettled = true;
      socket.terminate();
      reject(new Error(`cdp: connect to ${url} timed out after ${connectTimeoutMs}ms`));
    }, connectTimeoutMs);

    const rejectInFlight = (reason: string): void => {
      for (const [id, entry] of pending) {
        clearTimeout(entry.timer);
        pending.delete(id);
        entry.reject(new Error(`cdp: ${reason} before ${entry.method} answered`));
      }
    };

    const finish = (reason: string): void => {
      if (closed) return;
      closed = true;
      rejectInFlight(reason);
      const closeHandlers = handlers.get("close");
      if (closeHandlers !== undefined) {
        for (const handler of [...closeHandlers]) handler({ reason });
      }
    };

    const client: CdpClient = {
      url,
      get closed(): boolean {
        return closed;
      },
      send(method: string, params: CdpParams = {}, sessionId?: string): Promise<unknown> {
        if (closed) return Promise.reject(new Error(`cdp: socket is closed (${method})`));
        if (typeof method !== "string" || method.trim() === "") {
          return Promise.reject(new Error(`cdp: send needs a method name, got ${JSON.stringify(method)}`));
        }
        const id = ++nextId;
        return new Promise<unknown>((callResolve, callReject) => {
          const timer = setTimeout(() => {
            if (!pending.delete(id)) return;
            callReject(new Error(`cdp: ${method} timed out after ${timeoutMs}ms`));
          }, timeoutMs);
          pending.set(id, { method, resolve: callResolve, reject: callReject, timer });
          const message: Record<string, unknown> = { id, method, params };
          if (sessionId !== undefined) message["sessionId"] = sessionId;
          try {
            socket.send(JSON.stringify(message));
          } catch (error) {
            clearTimeout(timer);
            pending.delete(id);
            const reason = error instanceof Error ? error.message : String(error);
            callReject(new Error(`cdp: cannot send ${method}: ${reason}`));
          }
        });
      },
      on(method: string, handler: CdpHandler): () => void {
        const set = handlers.get(method) ?? new Set<CdpHandler>();
        set.add(handler);
        handlers.set(method, set);
        return () => {
          set.delete(handler);
          if (set.size === 0) handlers.delete(method);
        };
      },
      close(): void {
        finish("connection closed");
        socket.close();
      },
    };

    socket.on("open", () => {
      if (connectSettled) return;
      connectSettled = true;
      opened = true;
      clearTimeout(connectTimer);
      resolve(client);
    });

    socket.on("message", (data: unknown) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(textOf(data));
      } catch {
        return; // a frame we cannot read is not an answer; the call times out.
      }
      const record = asRecord(parsed);
      const id = record["id"];
      if (typeof id === "number") {
        const entry = pending.get(id);
        if (entry === undefined) return; // a late answer after a timeout is not an error.
        pending.delete(id);
        clearTimeout(entry.timer);
        if (record["error"] !== undefined) {
          entry.reject(new Error(protocolError(entry.method, record["error"])));
          return;
        }
        entry.resolve(record["result"] ?? null);
        return;
      }
      const method = record["method"];
      if (typeof method !== "string") return;
      const subscribers = handlers.get(method);
      if (subscribers === undefined) return;
      const params = asRecord(record["params"]);
      const sessionId = typeof record["sessionId"] === "string" ? record["sessionId"] : undefined;
      for (const handler of [...subscribers]) handler(params, sessionId);
    });

    socket.on("error", (error: Error) => {
      if (!connectSettled) {
        connectSettled = true;
        clearTimeout(connectTimer);
        socket.terminate();
        reject(new Error(`cdp: cannot connect to ${url}: ${error.message}`));
        return;
      }
      finish(`connection error: ${error.message}`);
    });

    socket.on("close", () => {
      if (!connectSettled) {
        connectSettled = true;
        clearTimeout(connectTimer);
        reject(new Error(`cdp: connection to ${url} closed before it opened`));
        return;
      }
      if (!opened) return;
      finish("connection closed");
    });
  });
}
