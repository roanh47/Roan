/**
 * The chain: one append-only list of events shared by every node.
 *
 * This file owns the wire format and the list. It knows nothing about React and
 * nothing about the host shell, so it can be exercised against a fake socket.
 *
 * Frames (JSON, one per WebSocket message):
 *   client → daemon  { t: "hello", v: 1, chain, node, haveSeq }
 *                    { t: "append", event }
 *   daemon → client  { t: "hello", v: 1, chain, node, haveSeq }
 *                    { t: "events", events }
 *                    { t: "append", event }
 *
 * `haveSeq` means "this is the last sequence number I hold". A client sends it
 * on every (re)connect; the daemon answers with hello (identity) and then the
 * events the client is missing, followed by live appends. Sequence numbers are
 * assigned by the daemon that runs the turn, never by this client: the event we
 * append carries `seq: 0` and is replaced by the daemon's copy, matched on `id`.
 */

export const KNOWN_EVENT_TYPES = [
  "message",
  "assistant",
  "tool_call",
  "tool_result",
  "error",
  "turn_start",
  "turn_end",
  "env",
] as const;

export type KnownEventType = (typeof KNOWN_EVENT_TYPES)[number];

/** Known types get completion; unknown ones are kept so an old client survives a new event. */
export type EventType = KnownEventType | (string & {});

export interface ChainEvent {
  v: 1;
  chain: string;
  seq: number;
  id: string;
  node: string;
  ts: number;
  type: EventType;
  data: unknown;
}

export interface HelloFrame {
  t: "hello";
  v: 1;
  chain: string;
  node: string;
  haveSeq: number;
}

export interface EventsFrame {
  t: "events";
  events: ChainEvent[];
}

export interface AppendFrame {
  t: "append";
  event: ChainEvent;
}

export type ServerFrame = HelloFrame | EventsFrame | AppendFrame;

export interface ClientHelloFrame {
  t: "hello";
  v: 1;
  chain: string;
  node: string;
  haveSeq: number;
}

export type ClientFrame = ClientHelloFrame | AppendFrame;

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "open"
  | "reconnecting"
  | "closed";

export interface PendingMessage {
  id: string;
  text: string;
  ts: number;
}

export interface ChainSnapshot {
  status: ConnectionStatus;
  /** Chain id from the daemon's hello; null until the first successful hello. */
  chain: string | null;
  /** This device's name, as sent in every event. */
  node: string;
  /** The daemon that answered, for display and debugging. */
  peer: string | null;
  events: readonly ChainEvent[];
  /** Messages appended locally and not yet echoed by the daemon. */
  pending: readonly PendingMessage[];
  lastSeq: number;
  error: string | null;
}

/** An open turn: a turn_start with no matching turn_end. */
export interface OpenTurn {
  owner: string;
  startId: string;
  since: number;
}

export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

export interface ChainClientOptions {
  url: string;
  node: string;
  /** Known chain id, if the shell has one from a previous run. */
  chain?: string | null;
  /** Injection point for tests. Defaults to the global WebSocket. */
  socketFactory?: (url: string) => SocketLike;
  /** Injection point for tests. */
  now?: () => number;
  /** Injection point for tests. */
  newId?: () => string;
  /** Reconnect backoff. `false` disables reconnecting (tests). */
  reconnect?: { minMs?: number; maxMs?: number } | false;
}

const OPEN = 1;
const DEFAULT_BACKOFF: { minMs: number; maxMs: number } = { minMs: 400, maxMs: 8_000 };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isChainEvent(value: unknown): value is ChainEvent {
  if (!isRecord(value)) return false;
  return (
    value.v === 1 &&
    typeof value.chain === "string" &&
    typeof value.seq === "number" &&
    Number.isFinite(value.seq) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.node === "string" &&
    typeof value.ts === "number" &&
    typeof value.type === "string" &&
    value.type.length > 0
  );
}

/** Parses one raw message into a frame, or null when it is not one we speak. */
export function parseFrame(raw: unknown): ServerFrame | null {
  if (typeof raw !== "string") return null;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value) || typeof value.t !== "string") return null;

  if (value.t === "hello") {
    if (value.v !== 1 || typeof value.chain !== "string") return null;
    if (typeof value.node !== "string" || typeof value.haveSeq !== "number") return null;
    return {
      t: "hello",
      v: 1,
      chain: value.chain,
      node: value.node,
      haveSeq: value.haveSeq,
    };
  }

  if (value.t === "events") {
    if (!Array.isArray(value.events)) return null;
    return { t: "events", events: value.events.filter(isChainEvent) };
  }

  if (value.t === "append") {
    if (!isChainEvent(value.event)) return null;
    return { t: "append", event: value.event };
  }

  return null;
}

/**
 * The turn currently open, if any. The first turn_start wins until that same
 * node sends turn_end; a turn_end from another node is not allowed to steal it.
 * This is the whole of the composer lock, so it lives beside the event type.
 */
export function openTurn(events: readonly ChainEvent[]): OpenTurn | null {
  let open: OpenTurn | null = null;
  for (const event of events) {
    if (event.type === "turn_start") {
      if (open === null) {
        open = { owner: event.node, startId: event.id, since: event.ts };
      }
    } else if (event.type === "turn_end" && open !== null && event.node === open.owner) {
      open = null;
    }
  }
  return open;
}

/** Inserts by seq, keeping equal seq values ordered by id so every node agrees. */
function insertSorted(events: readonly ChainEvent[], event: ChainEvent): ChainEvent[] {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    const current = events[mid];
    if (current === undefined) break;
    const before =
      current.seq < event.seq || (current.seq === event.seq && current.id < event.id);
    if (before) low = mid + 1;
    else high = mid;
  }
  return [...events.slice(0, low), event, ...events.slice(low)];
}

function defaultId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  // WebViews without a secure context still need ids. Not cryptographic.
  const random = Math.random().toString(36).slice(2, 10);
  return `local-${Date.now().toString(36)}-${random}`;
}

function normalizeBackoff(
  value: ChainClientOptions["reconnect"],
): { minMs: number; maxMs: number } | false {
  if (value === false) return false;
  const minMs = value?.minMs ?? DEFAULT_BACKOFF.minMs;
  const maxMs = value?.maxMs ?? DEFAULT_BACKOFF.maxMs;
  return { minMs, maxMs: Math.max(minMs, maxMs) };
}

function defaultSocketFactory(url: string): SocketLike {
  const Socket = globalThis.WebSocket;
  if (typeof Socket !== "function") {
    throw new Error("no WebSocket implementation in this host");
  }
  return new Socket(url) as unknown as SocketLike;
}

export class ChainClient {
  private readonly url: string;
  private readonly node: string;
  private readonly socketFactory: (url: string) => SocketLike;
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly backoff: { minMs: number; maxMs: number } | false;

  private socket: SocketLike | null = null;
  private stopped = true;
  private retryDelay: number;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly seen = new Set<string>();
  private events: readonly ChainEvent[];
  private pending: readonly PendingMessage[];
  private listeners = new Set<() => void>();
  private snapshot: ChainSnapshot;

  constructor(options: ChainClientOptions) {
    this.url = options.url;
    this.node = options.node;
    this.socketFactory = options.socketFactory ?? defaultSocketFactory;
    this.now = options.now ?? (() => Date.now());
    this.newId = options.newId ?? defaultId;
    this.backoff = normalizeBackoff(options.reconnect);
    this.retryDelay = this.backoff ? this.backoff.minMs : 0;
    this.events = [];
    this.pending = [];
    this.snapshot = {
      status: "idle",
      chain: options.chain ?? null,
      node: this.node,
      peer: null,
      events: this.events,
      pending: this.pending,
      lastSeq: 0,
      error: null,
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ChainSnapshot => this.snapshot;

  connect(): void {
    this.stopped = false;
    this.clearRetry();
    this.open();
  }

  disconnect(): void {
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
        socket.close(1000, "client closing");
      } catch {
        // Already closed; nothing to do.
      }
    }
    this.update({ status: "closed", peer: null });
  }

  /** Re-announces what we hold. Safe to call when already open. */
  resync(): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== OPEN) {
      this.connect();
      return;
    }
    this.send({ t: "hello", v: 1, chain: this.snapshot.chain ?? "", node: this.node, haveSeq: this.snapshot.lastSeq });
  }

  /**
   * Appends a user message. Throws rather than losing it: the composer is
   * disabled in these cases, so an exception here is a bug, not a flow.
   */
  sendMessage(text: string): PendingMessage {
    const body = text.trim();
    if (body.length === 0) throw new Error("cannot send an empty message");
    if (this.snapshot.status !== "open") {
      throw new Error(`cannot send while the chain is ${this.snapshot.status}`);
    }
    const turn = openTurn(this.events);
    if (turn) throw new Error(`turn owned by ${turn.owner} is still open`);

    const id = this.newId();
    const ts = this.now();
    const event: ChainEvent = {
      v: 1,
      chain: this.snapshot.chain ?? "",
      seq: 0,
      id,
      node: this.node,
      ts,
      type: "message",
      data: { text: body },
    };
    if (!this.send({ t: "append", event })) {
      throw new Error("socket is not open");
    }

    const pending: PendingMessage = { id, text: body, ts };
    this.pending = [...this.pending, pending];
    this.update({ pending: this.pending });
    return pending;
  }

  private open(): void {
    if (this.stopped) return;
    this.update({
      status: this.snapshot.chain === null && this.snapshot.events.length === 0 ? "connecting" : "reconnecting",
      error: null,
    });

    let socket: SocketLike;
    try {
      socket = this.socketFactory(this.url);
    } catch (error) {
      this.fail(error);
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.retryDelay = this.backoff ? this.backoff.minMs : 0;
      this.update({ status: "open", error: null });
      this.resync();
    };

    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      const frame = parseFrame(event.data);
      if (frame) this.receive(frame);
    };

    socket.onerror = () => {
      if (this.socket !== socket) return;
      this.update({ error: "the daemon connection reported an error" });
    };

    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.stopped) return;
      if (!this.backoff) {
        this.update({ status: "closed" });
        return;
      }
      this.update({ status: "reconnecting", peer: null });
      this.scheduleRetry();
    };
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retryTimer !== null || !this.backoff) return;
    const jitter = 0.8 + Math.random() * 0.4;
    const delay = Math.round(this.retryDelay * jitter);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, delay);
    this.retryDelay = Math.min(
      Math.max(this.retryDelay * 2, this.backoff.minMs),
      this.backoff.maxMs,
    );
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private receive(frame: ServerFrame): void {
    if (frame.t === "hello") {
      // Joining adopts the chain: if the daemon reports another chain, the old
      // transcript belongs to a session this app is no longer in.
      const changed = this.snapshot.chain !== null && this.snapshot.chain !== frame.chain;
      if (changed) {
        this.seen.clear();
        this.events = [];
        this.pending = [];
      }
      this.update({
        chain: frame.chain,
        peer: frame.node,
        error: null,
        ...(changed ? { events: this.events, pending: this.pending, lastSeq: 0 } : {}),
      });
      return;
    }

    if (frame.t === "events") {
      if (frame.events.length === 0) return;
      let next = this.events;
      for (const event of frame.events) {
        next = this.absorb(next, event);
      }
      this.commit(next);
      return;
    }

    this.commit(this.absorb(this.events, frame.event));
  }

  private absorb(
    events: readonly ChainEvent[],
    event: ChainEvent,
  ): readonly ChainEvent[] {
    if (this.seen.has(event.id)) return events;
    if (this.snapshot.chain !== null && event.chain !== this.snapshot.chain) return events;

    this.seen.add(event.id);
    this.pending = this.pending.filter((item) => item.id !== event.id);
    return insertSorted(events, event);
  }

  private commit(events: readonly ChainEvent[]): void {
    this.events = events;
    const last = events[events.length - 1];
    this.update({
      events,
      pending: this.pending,
      lastSeq: last ? last.seq : this.snapshot.lastSeq,
    });
  }

  private send(frame: ClientFrame): boolean {
    const socket = this.socket;
    if (!socket || socket.readyState !== OPEN) return false;
    try {
      socket.send(JSON.stringify(frame));
      return true;
    } catch (error) {
      this.update({ error: error instanceof Error ? error.message : "send failed" });
      return false;
    }
  }

  private fail(error: unknown): void {
    this.update({
      status: this.stopped ? "closed" : "reconnecting",
      error: error instanceof Error ? error.message : "could not connect",
    });
    if (!this.stopped) this.scheduleRetry();
  }

  private update(patch: Partial<ChainSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.publish();
  }

  private publish(): void {
    for (const listener of this.listeners) listener();
  }
}
