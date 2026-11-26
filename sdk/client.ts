/**
 * A typed client for the daemon's control port.
 *
 * The daemon serves one port on loopback (`127.0.0.1:6769`, or whatever
 * `ROAN_PORT` says; `ROAN_HOST` can move it on purpose). The control socket is
 * `/ws` on that port; `/peer` is peer sync. Two
 * protocols share that socket, told apart by their frames:
 *
 *   control  client → daemon  `{ t: "state" }`, `{ t: "create_chain" }`,
 *                             `{ t: "join_chain", code }`, `{ t: "append", event }`,
 *                             and one-shot requests `{ t: "<kind>", req, ... }`
 *            daemon → client  `{ t: "state", data }`, `{ t: "chain", ... }`,
 *                             `{ t: "control_error", message }`,
 *                             `{ t: "reply", id, data }`
 *
 *   chain    both ways carry chain frames (`hello`, `events`, `append`) encoded
 *            by `src/protocol`, which this client treats as notifications.
 *
 * `docs/api.md` is the full frame-by-frame reference; this file is the client
 * half of the subset an embedder needs: connect, read state, append a message,
 * export, and any other request kind through `request()`.
 *
 * Dependency-free on purpose: it uses the runtime's global `WebSocket` (Node
 * 22 ships one) and nothing else, so it can be copied into a plugin, a test or
 * another language's host without dragging `ws` along. There is no reconnect
 * loop and no queue: each call either answers or rejects with a
 * `ControlClientError` that says why.
 */

/** Milliseconds a request may wait for its reply before rejecting. */
export const DEFAULT_TIMEOUT_MS = 15_000;

/** The readyState value a WebSocket reports once the handshake is done. */
const OPEN = 1;

/* -------------------------------------------------------------------------- */
/* Frames                                                                     */
/* -------------------------------------------------------------------------- */

/** A state fact for one node, as the daemon's roster folds it. */
export interface DaemonNode {
  readonly node: string;
  readonly name: string;
  readonly host: string;
  readonly port: number;
  /** The local node while its daemon runs; a peer when connected or recently seen. */
  readonly live?: boolean;
}

export interface DaemonSession {
  readonly id: string;
  readonly title: string;
  readonly messages: number;
  /** Present on throwaway conversations the daemon does not list as history. */
  readonly ephemeral?: boolean;
}

/**
 * What `{ t: "state" }` answers with. Mirrors `DaemonState` in
 * `src/daemon/control-protocol.ts`; the optional fields are genuinely optional
 * there, so they stay optional here.
 */
export interface DaemonState {
  readonly onboarding: boolean;
  readonly chain: string | null;
  readonly node: string | null;
  readonly head: number;
  readonly peers: readonly string[];
  readonly nodes: readonly DaemonNode[];
  /** The code another device pastes in; null before there is a chain. */
  readonly invite: string | null;
  readonly model?: string;
  readonly provider?: string;
  readonly sessions?: readonly DaemonSession[];
  readonly activeSession?: string | null;
}

export interface StateFrame {
  readonly t: "state";
  readonly data: DaemonState;
}

export interface ChainFrame {
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

export interface ReplyFrame {
  readonly t: "reply";
  readonly id: string;
  readonly data: unknown;
}

/** One entry in a chain, as chain frames carry it. */
export interface ChainEvent {
  readonly v: 1;
  readonly chain: string;
  readonly seq: number;
  readonly id: string;
  readonly node: string;
  readonly ts: number;
  readonly type: string;
  readonly data: unknown;
}

/** What the app may write on the control port. */
export interface AppendPayload {
  readonly text: string;
  readonly session?: string;
  /** Base64 image body; the daemon refuses one 1.6 MB or larger. */
  readonly image?: { readonly mime: string; readonly data: string };
}

/**
 * An append body. Only `data.text` is required: the daemon writes the message
 * and assigns chain, seq, node and ts itself. `id` is the client's own event id
 * and comes back on the echo so a UI can drop its pending bubble.
 */
export interface AppendInput {
  readonly id?: string;
  readonly data: AppendPayload;
}

export interface ExportOk {
  readonly ok: true;
  readonly path: string;
  /** A second copy in the download window when the owner opened one. */
  readonly shared: string | null;
  /** Chain events for `"chain"`, files for a conversation with photos, else 1. */
  readonly count: number;
}

export interface ExportFailure {
  readonly ok: false;
  readonly error: string;
}

export type ExportReply = ExportOk | ExportFailure;

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

export type ControlClientErrorCode =
  | "connect_failed"
  | "timeout"
  | "closed"
  | "bad_reply";

/**
 * Every failure this client raises, with a machine-readable reason.
 *
 * - `connect_failed` — the handshake never completed; the daemon is not there.
 * - `timeout` — the frame went out but no reply arrived in time.
 * - `closed` — the socket went away (or `close()` was called) with work pending.
 * - `bad_reply` — the daemon answered a control_error, or sent something that is
 *   not JSON. A reply that names its own failure (`{ ok: false, error }`) is
 *   data, not an error, and is returned rather than thrown.
 */
export class ControlClientError extends Error {
  readonly code: ControlClientErrorCode;
  override readonly cause: unknown;

  constructor(message: string, code: ControlClientErrorCode, cause?: unknown) {
    super(message);
    this.name = "ControlClientError";
    this.code = code;
    this.cause = cause;
  }
}

/* -------------------------------------------------------------------------- */
/* Socket                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The slice of WebSocket this client uses. The DOM WebSocket, Node's built-in
 * one and a test double are structurally the same at this width.
 */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessage: ((event: { readonly data?: unknown }) => void) | null;
}

/** The constructor shape, so a test can pass a fake without a DOM. */
export type WebSocketFactory = (url: string) => WebSocketLike;

export interface ControlClientOptions {
  /** How long a request may wait for its reply once written. */
  readonly timeoutMs?: number;
  /**
   * Socket factory. Defaults to the runtime's global `WebSocket`; only tests
   * pass one.
   */
  readonly socket?: WebSocketFactory;
  /** Source of event ids; defaults to `crypto.randomUUID`. */
  readonly newId?: () => string;
}

interface Pending {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: ControlClientError) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

interface StateWaiter {
  readonly resolve: (state: DaemonState) => void;
  readonly reject: (error: ControlClientError) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** `data` from a message event as text, whatever the runtime wrapped it in. */
function textOf(data: unknown): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }
  return String(data);
}

function defaultSocket(url: string): WebSocketLike {
  const Ctor = (globalThis as { WebSocket?: new (url: string) => WebSocketLike }).WebSocket;
  if (Ctor === undefined) {
    throw new ControlClientError(
      "this runtime has no global WebSocket; pass options.socket",
      "connect_failed",
    );
  }
  return new Ctor(url);
}

function randomId(): string {
  const crypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (crypto?.randomUUID !== undefined) return crypto.randomUUID();
  return `evt-${String(Date.now())}-${String(Math.floor(Math.random() * 1e9))}`;
}

/* -------------------------------------------------------------------------- */
/* Client                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * One connection to one daemon. `connect()` returns immediately; the methods
 * wait for the handshake themselves, so a caller can fire `state()` right away.
 */
export class ControlClient {
  /** The url this client dials, as given. */
  readonly url: string;
  private readonly timeoutMs: number;
  private readonly newId: () => string;
  private readonly socket: WebSocketLike;
  private readonly opened: Promise<void>;
  private readonly pending = new Map<string, Pending>();
  private readonly stateQueue: (StateWaiter | null)[] = [];
  private closed = false;
  private counter = 0;
  /** Set once the socket is open; used to reject later writes with the reason. */
  private gone: ControlClientError | null = null;

  constructor(url: string, options: ControlClientOptions = {}) {
    this.url = url;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.newId = options.newId ?? randomId;
    const factory = options.socket ?? defaultSocket;
    this.socket = factory(url);

    this.opened = new Promise<void>((resolve, reject) => {
      let open = false;
      const timer = setTimeout(() => {
        const error = new ControlClientError(
          `no control port answered at ${url} within ${String(this.timeoutMs)}ms`,
          "connect_failed",
        );
        this.fail(error);
        reject(error);
        try {
          this.socket.close();
        } catch {
          // already closing; nothing to add.
        }
      }, this.timeoutMs);
      this.socket.onopen = () => {
        open = true;
        clearTimeout(timer);
        resolve();
      };
      this.socket.onmessage = (event) => this.receive(event.data);
      this.socket.onerror = () => {
        // A close event follows; this only makes sure the handshake fails now
        // (or, after the handshake, that the pending work hears about it).
        const error = new ControlClientError(
          open
            ? `the control port at ${url} reported an error`
            : `the control port at ${url} refused the connection`,
          open ? "closed" : "connect_failed",
        );
        clearTimeout(timer);
        this.fail(error);
        reject(error);
      };
      this.socket.onclose = () => {
        const error = new ControlClientError(`the control port at ${url} closed the connection`, "closed");
        clearTimeout(timer);
        this.fail(error);
        reject(error);
      };
    });
    // A caller that never awaits a method must not see an unhandled rejection.
    this.opened.catch(() => undefined);
  }

  /** The daemon's current view: onboarding, chain, roster, sessions, model. */
  async state(): Promise<DaemonState> {
    await this.ready();
    return new Promise<DaemonState>((resolve, reject) => {
      const waiter: StateWaiter = { resolve, reject, timer: null };
      // A slot, not just a waiter: a request that times out leaves its slot
      // behind, so the late state frame is dropped instead of answering the
      // next caller with a stale reading.
      const slot = this.stateQueue.push(waiter) - 1;
      waiter.timer = setTimeout(() => {
        if (this.stateQueue[slot] === waiter) this.stateQueue[slot] = null;
        reject(
          new ControlClientError(
            `the daemon did not answer a state request within ${String(this.timeoutMs)}ms`,
            "timeout",
          ),
        );
      }, this.timeoutMs);
      // Waiters are queued before the write so a reply cannot beat its slot.
      this.write({ t: "state" });
    });
  }

  /**
   * Appends one event. The daemon fills in chain, seq, node and ts, so the body
   * only needs `data`. Resolves with the event id that went on the wire (the
   * given one, or a fresh id) once the frame is written; the daemon's echo
   * arrives as a chain `append` frame nobody here consumes.
   */
  async append(event: AppendInput): Promise<string> {
    const text = event.data.text;
    if (typeof text !== "string" || text.trim().length === 0) {
      throw new ControlClientError("an append needs non-empty data.text", "bad_reply");
    }
    await this.ready();
    const id = event.id !== undefined && event.id.length > 0 ? event.id : this.newId();
    this.write({ t: "append", event: { id, data: event.data } });
    return id;
  }

  /** Shorthand for one user message, optionally into a named conversation. */
  async send(text: string, session?: string): Promise<string> {
    return this.append({
      data: session !== undefined && session.length > 0 ? { text, session } : { text },
    });
  }

  /**
   * Exports the chain (`"chain"`) or one conversation (its session id). The
   * daemon's own refusal — no chain yet, unknown conversation — comes back as
   * `{ ok: false, error }`, because that is an answer and not a transport fault.
   */
  async export(what: string): Promise<ExportReply> {
    const data = await this.request("export", { what });
    if (!isRecord(data) || typeof data["ok"] !== "boolean") {
      throw new ControlClientError("the daemon answered export with something that is not an export reply", "bad_reply");
    }
    return data as unknown as ExportReply;
  }

  /**
   * Any other one-shot request kind from `docs/api.md`
   * (`settings_save`, `take_shared`, `plan_mode`, `steer`, `goal`, `import_plan`,
   * `mcp_server_save`, …): one frame out, the `reply` with the same id back.
   *
   * The reply's `data` is returned untouched, including `{ ok: false, error }`
   * shapes: the daemon reports refusals as data.
   *
   * `correlation` is for the one kind whose request data *is* the correlation
   * id: `tool_approve` reads `req` as the approval it answers, so a client must
   * pass the approval id here as well. Every other kind can leave it out.
   */
  async request(
    kind: string,
    data: Record<string, unknown> = {},
    correlation?: string,
  ): Promise<unknown> {
    if (kind.length === 0) throw new ControlClientError("a request needs a kind", "bad_reply");
    if (kind === "state" || kind === "append") {
      throw new ControlClientError(
        `"${kind}" is not a request/reply kind; use state() or send()`,
        "bad_reply",
      );
    }
    if (correlation !== undefined && correlation.length === 0) {
      throw new ControlClientError("a correlation id cannot be empty", "bad_reply");
    }
    await this.ready();
    this.counter += 1;
    const id = correlation ?? `req-${String(this.counter)}-${this.newId()}`;
    return new Promise<unknown>((resolve, reject) => {
      const entry: Pending = { resolve, reject, timer: null };
      entry.timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new ControlClientError(
            `the daemon did not answer "${kind}" within ${String(this.timeoutMs)}ms`,
            "timeout",
          ),
        );
      }, this.timeoutMs);
      this.pending.set(id, entry);
      try {
        // `t` and `req` last: a data field of the same name must not become the
        // frame type or the reply address.
        this.write({ ...data, t: kind, req: id });
      } catch (error) {
        this.pending.delete(id);
        if (entry.timer !== null) clearTimeout(entry.timer);
        reject(error instanceof ControlClientError ? error : new ControlClientError(`could not write "${kind}"`, "closed", error));
      }
    });
  }

  /** Closes the socket; anything still waiting rejects with `closed`. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.fail(new ControlClientError("the control client was closed", "closed"));
    try {
      this.socket.close();
    } catch {
      // already gone.
    }
  }

  /* ------------------------------------------------------------------------ */

  private async ready(): Promise<void> {
    if (this.closed) throw new ControlClientError("the control client is closed", "closed");
    if (this.gone !== null) throw this.gone;
    await this.opened;
    if (this.gone !== null) throw this.gone;
  }

  private write(frame: Record<string, unknown>): void {
    if (this.gone !== null) throw this.gone;
    try {
      this.socket.send(JSON.stringify(frame));
    } catch (cause) {
      throw new ControlClientError(`could not write to the control port at ${this.url}`, "closed", cause);
    }
  }

  private receive(raw: unknown): void {
    let frame: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(textOf(raw));
      if (!isRecord(parsed)) {
        this.fail(new ControlClientError("the daemon sent a frame that is not a JSON object", "bad_reply"));
        return;
      }
      frame = parsed;
    } catch (cause) {
      this.fail(new ControlClientError("the daemon sent a frame that is not JSON", "bad_reply", cause));
      return;
    }

    const type = frame["t"];
    if (type === "state") {
      const data = frame["data"];
      if (!isRecord(data)) {
        this.fail(new ControlClientError("the daemon sent a state frame without data", "bad_reply"));
        return;
      }
      // A state frame nobody asked for is the greeting the daemon sends on
      // connect; only a frame that answers a queued request may resolve one.
      if (this.stateQueue.length === 0) return;
      const waiter = this.stateQueue.shift() ?? null;
      if (waiter === null) return; // the asker timed out; drop the late answer.
      if (waiter.timer !== null) clearTimeout(waiter.timer);
      waiter.resolve(data as unknown as DaemonState);
      return;
    }
    if (type === "reply") {
      const id = frame["id"];
      if (typeof id !== "string") {
        this.fail(new ControlClientError("the daemon sent a reply without an id", "bad_reply"));
        return;
      }
      const entry = this.pending.get(id);
      if (entry === undefined) return; // late or foreign; nobody is waiting.
      this.pending.delete(id);
      if (entry.timer !== null) clearTimeout(entry.timer);
      entry.resolve(frame["data"]);
      return;
    }
    if (type === "control_error") {
      // Only create_chain/join_chain are answered this way, and this client
      // sends neither; if one arrives, the daemon is refusing something an
      // embedder wrote by hand, so the waiters hear it instead of timing out.
      const message = typeof frame["message"] === "string" ? frame["message"] : "the daemon reported a control error";
      this.fail(new ControlClientError(message, "bad_reply"));
      return;
    }
    // Chain frames (`hello`, `events`, `append`) and `chain` replies are
    // notifications for whoever renders the chain; a request/reply client
    // ignores them on purpose.
  }

  /** Rejects everything in flight once; later calls see `gone`. */
  private fail(error: ControlClientError): void {
    if (this.gone === null) this.gone = error;
    for (const [id, entry] of [...this.pending]) {
      this.pending.delete(id);
      if (entry.timer !== null) clearTimeout(entry.timer);
      entry.reject(this.gone);
    }
    for (const waiter of this.stateQueue.splice(0)) {
      if (waiter === null) continue;
      if (waiter.timer !== null) clearTimeout(waiter.timer);
      waiter.reject(this.gone);
    }
  }
}

/**
 * Opens a control connection. Nothing is awaited here: the first method call
 * waits for the handshake, and rejects with `connect_failed` if the port is
 * not answering.
 */
export function connect(url: string, options: ControlClientOptions = {}): ControlClient {
  return new ControlClient(url, options);
}
