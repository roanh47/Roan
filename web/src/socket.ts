/**
 * The app's one socket to the daemon on this machine.
 *
 * Two protocols share the connection, because the daemon serves both on the
 * same port and never inspects the path:
 *
 *   control  app → daemon  { t: "state" | "create_chain" | "join_chain" | "peers" }
 *            daemon → app  { t: "state", data } | { t: "chain", chain, node, invite? }
 *                          | { t: "control_error", message }
 *
 *   chain    app → daemon  { t: "hello", v, chain, node, haveSeq } | { t: "append", event }
 *            daemon → app  { t: "hello", v, chain, node, haveSeq }
 *                          | { t: "events", events } | { t: "append", event }
 *
 * This module is the transport only: it owns the socket, the reconnect loop and
 * the outbox, and hands every frame to a typed callback. It keeps no chain
 * state and knows nothing about React, so it can be driven by a fake socket in
 * a test. `chain.ts` is the older, chain-only client; this file is the one the
 * app store builds on.
 *
 * Nothing here leaves the machine: the daemon binds loopback, there is no
 * token, and any local process that can open the port can speak this protocol.
 */

export const DEFAULT_SOCKET_URL = "ws://127.0.0.1:7411/ws";

/** Frames parked while the socket is down. Beyond this the oldest is dropped. */
export const DEFAULT_QUEUE_LIMIT = 128;

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_BACKOFF = { minMs: 400, maxMs: 8_000, factor: 2 } as const;
const READY_STATE_OPEN = 1;

/* -------------------------------------------------------------------------- */
/* Frames                                                                      */
/* -------------------------------------------------------------------------- */

export type KnownEventType =
  | "message"
  | "assistant"
  | "tool_call"
  | "tool_result"
  | "error"
  | "turn_start"
  | "turn_end"
  | "env";

/** Unknown types are kept so an old client survives a newer daemon. */
export type EventType = KnownEventType | (string & {});

/** One entry in a chain. `seq` is assigned by the daemon, never by this client. */
export interface ChainEvent {
  readonly v: 1;
  readonly chain: string;
  readonly seq: number;
  readonly id: string;
  readonly node: string;
  readonly ts: number;
  readonly type: EventType;
  readonly data: unknown;
}

export interface HelloFrame {
  readonly t: "hello";
  readonly v: 1;
  readonly chain: string;
  readonly node: string;
  readonly haveSeq: number;
}

export interface EventsFrame {
  readonly t: "events";
  readonly events: readonly ChainEvent[];
}

export interface AppendFrame {
  readonly t: "append";
  readonly event: ChainEvent;
}

export type ChainFrame = HelloFrame | EventsFrame | AppendFrame;

export interface StateRequest {
  readonly t: "state";
}

export interface CreateChainRequest {
  readonly t: "create_chain";
}

export interface JoinChainRequest {
  readonly t: "join_chain";
  /** The invite code the user pasted or scanned. Opaque to the app. */
  readonly code: string;
}

export interface PeersRequest {
  readonly t: "peers";
}

export type ControlRequest = StateRequest | CreateChainRequest | JoinChainRequest | PeersRequest;

export interface DaemonState {
  readonly onboarding: boolean;
  readonly chain: string | null;
  readonly node: string | null;
  readonly head: number;
  readonly peers: readonly string[];
}

export interface StateResponse {
  readonly t: "state";
  readonly data: DaemonState;
}

export interface ChainResponse {
  readonly t: "chain";
  readonly chain: string;
  readonly node: string;
  /** Present after creating a chain: hand this to the next machine. */
  readonly invite?: string;
}

export interface ControlErrorFrame {
  readonly t: "control_error";
  readonly message: string;
}

export type ControlResponse = StateResponse | ChainResponse | ControlErrorFrame;

/** Everything the app may write. */
export type ClientFrame = ControlRequest | HelloFrame | AppendFrame;

/** Everything the app may read. */
export type ServerFrame = ControlResponse | ChainFrame;

export type SocketStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export interface CloseInfo {
  readonly code: number;
  readonly reason: string;
  readonly wasClean: boolean;
}

/**
 * The callbacks the app hands in. Every one is optional; a frame nobody listens
 * for is simply not delivered.
 */
export interface SocketHandlers {
  /** Fired on every transition, with the status that was replaced. */
  readonly status?: (status: SocketStatus, previous: SocketStatus) => void;
  /** The socket is open and the outbox has been flushed. */
  readonly open?: () => void;
  /** The socket is down. A reconnect may already be scheduled. */
  readonly close?: (info: CloseInfo) => void;
  /** Transport-level trouble: a failed send, a WebSocket error event. */
  readonly error?: (message: string) => void;
  /** Every frame that parsed, before the per-kind callbacks. */
  readonly frame?: (frame: ServerFrame) => void;
  readonly hello?: (frame: HelloFrame) => void;
  readonly events?: (events: readonly ChainEvent[]) => void;
  readonly append?: (event: ChainEvent) => void;
  readonly state?: (state: DaemonState) => void;
  readonly chain?: (response: ChainResponse) => void;
  readonly controlError?: (message: string) => void;
  /** A queued frame was discarded because the outbox was full. */
  readonly frameDropped?: (frame: ClientFrame, reason: "queue-full" | "disconnected") => void;
}

/** Injection points for tests; production passes none of these. */
export interface AppSocketOptions {
  readonly url?: string;
  readonly handlers?: SocketHandlers;
  /** `false` disables reconnecting; an object tunes the backoff. */
  readonly reconnect?: boolean | ReconnectOptions;
  /** Outbox limit. Defaults to {@link DEFAULT_QUEUE_LIMIT}. */
  readonly queueLimit?: number;
  /** How long a control request may wait for its reply once written. */
  readonly requestTimeoutMs?: number;
  readonly socketFactory?: (url: string) => SocketLike;
  /** Source of jitter in [0, 1); a fixed value makes the backoff predictable. */
  readonly random?: () => number;
  readonly setTimeoutFn?: (handler: () => void, ms: number) => TimerHandle;
  readonly clearTimeoutFn?: (handle: TimerHandle) => void;
}

export interface ReconnectOptions {
  readonly minMs?: number;
  readonly maxMs?: number;
  /** Multiplier per failure. Defaults to 2. */
  readonly factor?: number;
}

/**
 * The slice of WebSocket this module uses. A server-side `ws` socket or a test
 * double is structurally the same, so no DOM types leak into the tests.
 */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { readonly data: unknown }) => void) | null;
}

type TimerHandle = ReturnType<typeof setTimeout>;

interface PendingRequest {
  readonly expected: "state" | "chain";
  readonly resolve: (response: ControlResponse) => void;
  readonly reject: (error: Error) => void;
  timer: TimerHandle | null;
}

interface OutboxEntry {
  readonly frame: ClientFrame;
  readonly request: PendingRequest | null;
}

/* -------------------------------------------------------------------------- */
/* Parsing                                                                     */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isChainEvent(value: unknown): value is ChainEvent {
  if (!isRecord(value)) return false;
  return (
    value["v"] === 1 &&
    typeof value["chain"] === "string" &&
    typeof value["seq"] === "number" &&
    Number.isFinite(value["seq"]) &&
    typeof value["id"] === "string" &&
    value["id"].length > 0 &&
    typeof value["node"] === "string" &&
    typeof value["ts"] === "number" &&
    Number.isFinite(value["ts"]) &&
    typeof value["type"] === "string" &&
    value["type"].length > 0 &&
    "data" in value
  );
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Parses one raw WebSocket payload. Returns null for anything this client does
 * not speak — a different version, a control frame from the future, garbage —
 * so an unknown frame can never take the connection down.
 */
export function parseServerFrame(raw: unknown): ServerFrame | null {
  if (typeof raw !== "string") return null;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const kind = value["t"];
  if (typeof kind !== "string") return null;

  if (kind === "hello") {
    if (
      value["v"] !== 1 ||
      typeof value["chain"] !== "string" ||
      typeof value["node"] !== "string" ||
      typeof value["haveSeq"] !== "number" ||
      !Number.isFinite(value["haveSeq"])
    ) {
      return null;
    }
    return {
      t: "hello",
      v: 1,
      chain: value["chain"],
      node: value["node"],
      haveSeq: value["haveSeq"],
    };
  }

  if (kind === "events") {
    const events = value["events"];
    if (!Array.isArray(events)) return null;
    return { t: "events", events: events.filter(isChainEvent) };
  }

  if (kind === "append") {
    if (!isChainEvent(value["event"])) return null;
    return { t: "append", event: value["event"] };
  }

  if (kind === "state") {
    const data = value["data"];
    if (!isRecord(data)) return null;
    const chain = data["chain"];
    const node = data["node"];
    const head = data["head"];
    const peers = data["peers"];
    if (typeof data["onboarding"] !== "boolean") return null;
    if (chain !== null && typeof chain !== "string") return null;
    if (node !== null && typeof node !== "string") return null;
    if (typeof head !== "number" || !Number.isFinite(head)) return null;
    if (!Array.isArray(peers)) return null;
    return {
      t: "state",
      data: {
        onboarding: data["onboarding"],
        chain,
        node,
        head,
        peers: peers.filter((peer): peer is string => typeof peer === "string"),
      },
    };
  }

  if (kind === "chain") {
    const chain = readString(value["chain"]);
    const node = readString(value["node"]);
    if (chain === null || node === null) return null;
    const invite = value["invite"];
    if (invite !== undefined && typeof invite !== "string") return null;
    return invite === undefined
      ? { t: "chain", chain, node }
      : { t: "chain", chain, node, invite };
  }

  if (kind === "control_error") {
    const message = readString(value["message"]);
    if (message === null) return null;
    return { t: "control_error", message };
  }

  return null;
}

function readCloseInfo(event: unknown): CloseInfo {
  if (!isRecord(event)) return { code: 1006, reason: "", wasClean: false };
  const code = event["code"];
  return {
    code: typeof code === "number" ? code : 1006,
    reason: typeof event["reason"] === "string" ? event["reason"] : "",
    wasClean: event["wasClean"] === true,
  };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

function normalizeBackoff(
  value: AppSocketOptions["reconnect"],
): { minMs: number; maxMs: number; factor: number } | false {
  if (value === false) return false;
  if (value === true || value === undefined) return { ...DEFAULT_BACKOFF };
  const minMs = value.minMs ?? DEFAULT_BACKOFF.minMs;
  const maxMs = Math.max(minMs, value.maxMs ?? DEFAULT_BACKOFF.maxMs);
  const factor = value.factor ?? DEFAULT_BACKOFF.factor;
  return { minMs, maxMs, factor: Math.max(1, factor) };
}

function defaultSocketFactory(url: string): SocketLike {
  const Socket = globalThis.WebSocket;
  if (typeof Socket !== "function") {
    throw new Error("no WebSocket implementation in this host");
  }
  return new Socket(url) as unknown as SocketLike;
}

/* -------------------------------------------------------------------------- */
/* The socket                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One daemon connection, with a bounded outbox and an exponential backoff.
 *
 * ```ts
 * const socket = new AppSocket({
 *   handlers: { events: (events) => store.merge(events), state: (s) => ... },
 * });
 * socket.connect();
 * await socket.request({ t: "create_chain" });
 * ```
 *
 * Frames written while the socket is down are queued, in order, up to
 * `queueLimit`; past that the oldest is dropped (and its promise rejected) so a
 * long outage cannot grow the queue without bound. Control requests time out
 * once they have been written; a request made offline waits for the connection
 * rather than failing on the way in.
 */
export class AppSocket {
  private readonly endpoint: string;
  private readonly handlers: SocketHandlers;
  private readonly backoff: { minMs: number; maxMs: number; factor: number } | false;
  private readonly queueLimit: number;
  private readonly requestTimeoutMs: number;
  private readonly socketFactory: (url: string) => SocketLike;
  private readonly random: () => number;
  private readonly setTimer: (handler: () => void, ms: number) => TimerHandle;
  private readonly clearTimer: (handle: TimerHandle) => void;

  private socket: SocketLike | null = null;
  private stopped = true;
  private everConnected = false;
  private attempts = 0;
  private retryDelay: number;
  private retryTimer: TimerHandle | null = null;
  private readonly outbox: OutboxEntry[] = [];
  private readonly pending: PendingRequest[] = [];
  private state: SocketStatus = "idle";

  constructor(options: AppSocketOptions = {}) {
    this.endpoint = options.url ?? DEFAULT_SOCKET_URL;
    this.handlers = options.handlers ?? {};
    this.backoff = normalizeBackoff(options.reconnect);
    this.queueLimit = Math.max(1, Math.floor(options.queueLimit ?? DEFAULT_QUEUE_LIMIT));
    this.requestTimeoutMs = Math.max(1, options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
    this.socketFactory = options.socketFactory ?? defaultSocketFactory;
    this.random = options.random ?? Math.random;
    this.setTimer = options.setTimeoutFn ?? ((handler, ms) => setTimeout(handler, ms));
    this.clearTimer = options.clearTimeoutFn ?? ((handle) => clearTimeout(handle));
    this.retryDelay = this.backoff ? this.backoff.minMs : 0;
  }

  get status(): SocketStatus {
    return this.state;
  }

  /** Number of frames parked until the socket opens. */
  get queued(): number {
    return this.outbox.length;
  }

  /** Failed connects since the last time the socket opened. */
  get reconnectAttempts(): number {
    return this.attempts;
  }

  /** The URL this socket dials. */
  get url(): string {
    return this.endpoint;
  }

  /** Idempotent: connecting an open or connecting socket does nothing. */
  connect(): void {
    this.stopped = false;
    this.clearRetry();
    if (this.socket !== null) return;
    this.openSocket();
  }

  /** Stops reconnecting, closes the socket and rejects anything still waiting. */
  disconnect(code = 1000, reason = "client closing"): void {
    this.stopped = true;
    this.clearRetry();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
      try {
        socket.close(code, reason);
      } catch {
        // Already closed; nothing to do.
      }
    }
    this.rejectAll(new Error(`socket closed: ${reason}`));
    this.setStatus("closed");
  }

  /**
   * Writes a frame now, or parks it in the outbox. Returns whether it went out
   * on the wire immediately; `false` means it is queued for the next open.
   */
  send(frame: ClientFrame): boolean {
    if (this.socket !== null && this.socket.readyState === READY_STATE_OPEN) {
      return this.write(frame);
    }
    this.enqueue(frame, null);
    return false;
  }

  /**
   * Sends a control request and resolves with the daemon's reply. The daemon
   * answers in order on one socket, so replies are matched FIFO by kind. A
   * `control_error` rejects the oldest request; it never hangs the caller.
   */
  request(frame: StateRequest, timeoutMs?: number): Promise<StateResponse>;
  request(frame: CreateChainRequest | JoinChainRequest, timeoutMs?: number): Promise<ChainResponse>;
  request(frame: PeersRequest, timeoutMs?: number): Promise<StateResponse>;
  request(frame: ControlRequest, timeoutMs?: number): Promise<ControlResponse>;
  request(frame: ControlRequest, timeoutMs = this.requestTimeoutMs): Promise<ControlResponse> {
    const expected = frame.t === "create_chain" || frame.t === "join_chain" ? "chain" : "state";
    return new Promise<ControlResponse>((resolve, reject) => {
      const pending: PendingRequest = { expected, resolve, reject, timer: null };
      if (this.socket !== null && this.socket.readyState === READY_STATE_OPEN) {
        this.pending.push(pending);
        this.startRequestTimer(pending, timeoutMs);
        if (!this.write(frame)) this.settleFailure(pending, "the request could not be written");
        return;
      }
      this.enqueue(frame, pending);
    });
  }

  /* ---------------------------------------------------------------------- */

  private openSocket(): void {
    if (this.stopped) return;

    this.setStatus(this.everConnected || this.attempts > 0 ? "reconnecting" : "connecting");

    let socket: SocketLike;
    try {
      socket = this.socketFactory(this.endpoint);
    } catch (error) {
      this.handlers.error?.(errorMessage(error, "could not open the daemon socket"));
      this.attempts += 1;
      this.scheduleRetry();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.attempts = 0;
      this.everConnected = true;
      if (this.backoff) this.retryDelay = this.backoff.minMs;
      this.setStatus("open");
      this.flush();
      this.handlers.open?.();
    };

    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      const frame = parseServerFrame(event.data);
      if (frame !== null) this.dispatch(frame);
    };

    socket.onerror = () => {
      if (this.socket !== socket) return;
      this.handlers.error?.("the daemon socket reported an error");
    };

    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      const info = readCloseInfo(event);
      if (this.stopped) {
        this.setStatus("closed");
        this.handlers.close?.(info);
        return;
      }
      this.attempts += 1;
      this.setStatus("reconnecting");
      this.handlers.close?.(info);
      this.scheduleRetry();
    };
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retryTimer !== null || !this.backoff) {
      if (!this.backoff && !this.stopped) this.setStatus("closed");
      return;
    }
    const jitter = 0.8 + this.random() * 0.4;
    const delay = Math.max(0, Math.round(this.retryDelay * jitter));
    this.retryTimer = this.setTimer(() => {
      this.retryTimer = null;
      this.openSocket();
    }, delay);
    this.retryDelay = Math.min(this.retryDelay * this.backoff.factor, this.backoff.maxMs);
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) {
      this.clearTimer(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private enqueue(frame: ClientFrame, request: PendingRequest | null): void {
    this.outbox.push({ frame, request });
    while (this.outbox.length > this.queueLimit) {
      const dropped = this.outbox.shift();
      if (!dropped) break;
      if (dropped.request) {
        this.settleFailure(dropped.request, "the outbox was full and the request was dropped");
      }
      this.handlers.frameDropped?.(dropped.frame, "queue-full");
    }
  }

  private flush(): void {
    while (this.outbox.length > 0) {
      const entry = this.outbox[0];
      if (!entry) return;
      if (!this.write(entry.frame)) return;
      this.outbox.shift();
      if (entry.request) {
        this.pending.push(entry.request);
        this.startRequestTimer(entry.request, this.requestTimeoutMs);
      }
    }
  }

  private write(frame: ClientFrame): boolean {
    const socket = this.socket;
    if (!socket || socket.readyState !== READY_STATE_OPEN) return false;
    try {
      socket.send(JSON.stringify(frame));
      return true;
    } catch (error) {
      this.handlers.error?.(errorMessage(error, "the frame could not be sent"));
      return false;
    }
  }

  private dispatch(frame: ServerFrame): void {
    this.handlers.frame?.(frame);

    if (frame.t === "hello") {
      this.handlers.hello?.(frame);
      return;
    }
    if (frame.t === "events") {
      this.handlers.events?.(frame.events);
      return;
    }
    if (frame.t === "append") {
      this.handlers.append?.(frame.event);
      return;
    }
    if (frame.t === "control_error") {
      const pending = this.shiftPending(null);
      if (pending) pending.reject(new Error(frame.message));
      else this.handlers.controlError?.(frame.message);
      return;
    }

    const pending = this.shiftPending(frame.t);
    if (pending) pending.resolve(frame);
    if (frame.t === "state") this.handlers.state?.(frame.data);
    else this.handlers.chain?.(frame);
  }

  /** Takes the oldest request waiting for this kind of reply, if any. */
  private shiftPending(expected: "state" | "chain" | null): PendingRequest | null {
    for (let index = 0; index < this.pending.length; index += 1) {
      const entry = this.pending[index];
      if (!entry) continue;
      if (expected === null || entry.expected === expected) {
        this.pending.splice(index, 1);
        if (entry.timer !== null) {
          this.clearTimer(entry.timer);
          entry.timer = null;
        }
        return entry;
      }
    }
    return null;
  }

  private startRequestTimer(pending: PendingRequest, timeoutMs: number): void {
    if (pending.timer !== null) return;
    pending.timer = this.setTimer(() => {
      pending.timer = null;
      const index = this.pending.indexOf(pending);
      if (index >= 0) this.pending.splice(index, 1);
      pending.reject(new Error("the daemon did not answer in time"));
    }, timeoutMs);
  }

  private settleFailure(pending: PendingRequest, message: string): void {
    if (pending.timer !== null) {
      this.clearTimer(pending.timer);
      pending.timer = null;
    }
    const index = this.pending.indexOf(pending);
    if (index >= 0) this.pending.splice(index, 1);
    pending.reject(new Error(message));
  }

  private rejectAll(error: Error): void {
    const pending = this.pending.splice(0, this.pending.length);
    for (const entry of pending) {
      if (entry.timer !== null) {
        this.clearTimer(entry.timer);
        entry.timer = null;
      }
      entry.reject(error);
    }
    const queued = this.outbox.splice(0, this.outbox.length);
    for (const entry of queued) {
      if (entry.request) entry.request.reject(error);
      this.handlers.frameDropped?.(entry.frame, "disconnected");
    }
  }

  private setStatus(next: SocketStatus): void {
    if (this.state === next) return;
    const previous = this.state;
    this.state = next;
    this.handlers.status?.(next, previous);
  }
}
