import { CLOSE_CODES, type Frame } from "./protocol.js";
import { frameChainMismatch } from "./parse.js";
import { createBackoff, type BackoffOptions } from "./backoff.js";
import { BoundedFrameQueue } from "./frame-queue.js";
import { PeerSession } from "./client-session.js";
import { TransportError } from "./errors.js";
import { nullLogger, type Logger } from "./logger.js";

const DEFAULT_MAX_QUEUE = 512;
const DEFAULT_MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 5_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_EVENTS_PER_FRAME = 1_000;

export type ConnectionState = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export interface PeerClientOptions {
  /** ws:// or wss:// endpoint of the peer. */
  url: string;
  /** Chain token, sent as a bearer header on the upgrade request. */
  token: string;
  /** The only chain this client will talk to. */
  chain: string;
  /** This node's name. */
  node: string;
  /** Last sequence number this node has, sent in hello. */
  haveSeq?: () => number;
  logger?: Logger;
  connectTimeoutMs?: number;
  handshakeTimeoutMs?: number;
  /** Inbound frames buffered while the consumer is slow. Exceeding it drops the link. */
  maxQueue?: number;
  maxPayloadBytes?: number;
  maxBufferedBytes?: number;
  maxEventsPerFrame?: number;
  backoff?: BackoffOptions;
  /** Consecutive failed attempts before giving up. Default: retry forever. */
  maxAttempts?: number;
}

function toEndpoint(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`peer url is not a valid URL: ${raw}`);
  }
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error(`peer url must use ws:// or wss://, got ${url.protocol}`);
  }
  return url.toString();
}

function asTransportError(error: unknown): TransportError {
  if (error instanceof TransportError) return error;
  if (error instanceof Error) return new TransportError(error.message, true);
  return new TransportError(String(error), true);
}

/**
 * A peer connection that maintains itself: connect, hello, validate, then
 * reconnect with exponential backoff until `close()` is called. Frames arrive
 * through a single bounded async iterator.
 */
export class PeerClient {
  readonly chain: string;
  readonly node: string;

  private readonly endpoint: string;
  private readonly token: string;
  private readonly logger: Logger;
  private readonly handshakeTimeoutMs: number;
  private readonly connectTimeoutMs: number;
  private readonly maxPayloadBytes: number;
  private readonly maxBufferedBytes: number;
  private readonly maxEventsPerFrame: number;
  private readonly maxAttempts: number;
  private readonly haveSeq: () => number;
  private readonly backoff: ReturnType<typeof createBackoff>;
  private readonly queue: BoundedFrameQueue<Frame>;
  private readonly loop: Promise<void>;

  private stateValue: ConnectionState = "idle";
  private session: PeerSession | null = null;
  private handshaken = false;
  private closing = false;
  private peerNodeValue: string | null = null;
  private closeError: TransportError | null = null;
  private lastError: string | null = null;
  private queueTaken = false;
  private overflowing = false;
  private sleepTimer: NodeJS.Timeout | null = null;
  private sleepResolve: (() => void) | null = null;
  private closePromise: Promise<void> | null = null;

  constructor(options: PeerClientOptions) {
    if (options.chain.trim() === "") throw new Error("peer client needs a chain id");
    if (options.node.trim() === "") throw new Error("peer client needs a node name");
    if (options.token.trim() === "") throw new Error("peer client needs a chain token");

    this.chain = options.chain;
    this.node = options.node;
    this.endpoint = toEndpoint(options.url);
    this.token = options.token;
    this.logger = options.logger ?? nullLogger;
    this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
    this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this.maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
    this.maxBufferedBytes = options.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;
    this.maxEventsPerFrame = options.maxEventsPerFrame ?? DEFAULT_MAX_EVENTS_PER_FRAME;
    this.maxAttempts = options.maxAttempts ?? Number.POSITIVE_INFINITY;
    this.haveSeq = options.haveSeq ?? (() => 0);
    this.backoff = createBackoff(options.backoff);

    const maxQueue = options.maxQueue ?? DEFAULT_MAX_QUEUE;
    this.queue = new BoundedFrameQueue<Frame>(maxQueue, () => this.onQueueOverflow(maxQueue));
    this.loop = this.run();
  }

  get state(): ConnectionState {
    return this.stateValue;
  }

  /** True only while a validated handshake is live. */
  get connected(): boolean {
    return this.handshaken;
  }

  /** Remote node name from the last accepted hello, if any. */
  get peerNode(): string | null {
    return this.peerNodeValue;
  }

  /**
   * Send a frame. False means it was not sent: no live connection or a full
   * send buffer. A frame whose chain does not match throws, because that is a
   * caller bug rather than a transient condition.
   */
  send(frame: Frame): boolean {
    const mismatch = frameChainMismatch(frame, this.chain);
    if (mismatch !== null) {
      throw new Error(`refusing to send frame on the wrong chain: ${mismatch}`);
    }
    if (!this.handshaken) return false;
    return this.session?.send(frame) ?? false;
  }

  /** The single consumer of inbound frames. Call once, keep the iterator. */
  frames(): AsyncIterableIterator<Frame> {
    if (this.queueTaken) {
      throw new Error("frames() may only be consumed once per client; keep the first iterator");
    }
    this.queueTaken = true;
    return this.queue;
  }

  async close(): Promise<void> {
    if (this.closePromise !== null) return this.closePromise;
    this.closing = true;
    this.wakeSleep();
    this.session?.close(1000, "client closing");
    this.closePromise = this.loop;
    return this.closePromise;
  }

  private async run(): Promise<void> {
    try {
      while (!this.closing) {
        this.setState(this.backoff.attempt === 0 ? "connecting" : "reconnecting");
        try {
          const session = await PeerSession.open({
            endpoint: this.endpoint,
            token: this.token,
            chain: this.chain,
            node: this.node,
            haveSeq: this.haveSeq,
            logger: this.logger,
            connectTimeoutMs: this.connectTimeoutMs,
            handshakeTimeoutMs: this.handshakeTimeoutMs,
            maxPayloadBytes: this.maxPayloadBytes,
            maxBufferedBytes: this.maxBufferedBytes,
            maxEventsPerFrame: this.maxEventsPerFrame,
            onFrame: (frame) => this.onFrame(frame),
          });

          this.session = session;
          this.handshaken = true;
          this.peerNodeValue = session.peerNode;
          this.backoff.reset();
          this.lastError = null;
          this.setState("open");
          this.logger.log("info", `connected to ${this.endpoint}; peer ${session.peerNode}`);

          await session.closed;
          this.handshaken = false;
          this.session = null;
          if (session.protocolError !== null) {
            this.fail(session.protocolError);
            return;
          }
        } catch (error) {
          this.handshaken = false;
          this.session = null;
          const failure = asTransportError(error);
          this.lastError = failure.message;
          if (!failure.retryable) {
            this.fail(failure);
            return;
          }
          this.logger.log("warn", `connection to ${this.endpoint} failed: ${failure.message}`);
        }

        if (this.closing) break;

        const closeError = this.closeError;
        this.closeError = null;
        if (closeError !== null && !closeError.retryable) {
          this.fail(closeError);
          return;
        }
        if (this.backoff.attempt >= this.maxAttempts) {
          this.fail(
            new TransportError(
              `gave up on ${this.endpoint} after ${this.maxAttempts} attempts: ${this.lastError ?? "unknown error"}`,
              false,
            ),
          );
          return;
        }
        const delay = this.backoff.next();
        this.logger.log("debug", `reconnecting to ${this.endpoint} in ${delay}ms`);
        await this.sleep(delay);
      }
    } finally {
      this.handshaken = false;
      this.session = null;
      this.setState("closed");
      this.queue.close();
    }
  }

  /** Frames that pass validation after the handshake. */
  private onFrame(frame: Frame): void {
    if (!this.handshaken) return;

    if (frame.t === "hello") {
      this.rejectFrame("peer sent a duplicate hello", CLOSE_CODES.badFrame);
      return;
    }
    const mismatch = frameChainMismatch(frame, this.chain);
    if (mismatch !== null) {
      this.rejectFrame(`chain mismatch: ${mismatch}`, CLOSE_CODES.chainMismatch);
      return;
    }
    if (!this.queue.push(frame)) {
      this.logger.log("debug", `inbound frame not queued (${frame.t})`);
    }
  }

  private rejectFrame(message: string, code: number): void {
    this.closeError = new TransportError(message, false);
    this.logger.log("warn", `${this.endpoint}: ${message}`);
    this.session?.close(code, message);
  }

  private onQueueOverflow(capacity: number): void {
    if (this.overflowing) return;
    this.overflowing = true;
    this.logger.log("warn", `inbound queue full (${capacity}); disconnecting from ${this.endpoint}`);
    this.session?.close(CLOSE_CODES.tooSlow, "client not draining");
  }

  private fail(error: TransportError): void {
    this.logger.log("error", `peer client ${this.node} stopped: ${error.message}`);
    this.queue.fail(error);
  }

  private setState(next: ConnectionState): void {
    if (this.stateValue === next) return;
    this.stateValue = next;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      this.sleepResolve = resolve;
      this.sleepTimer = setTimeout(() => {
        this.sleepTimer = null;
        this.sleepResolve = null;
        resolve();
      }, ms);
    });
  }

  private wakeSleep(): void {
    if (this.sleepTimer !== null) {
      clearTimeout(this.sleepTimer);
      this.sleepTimer = null;
    }
    const resolve = this.sleepResolve;
    this.sleepResolve = null;
    resolve?.();
  }
}
