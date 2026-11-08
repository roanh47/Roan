import { WebSocket } from "ws";
import { CLOSE_CODES, PROTOCOL_VERSION, encodeFrame, type Frame, type HelloFrame } from "./protocol.js";
import { decodeFrameData, detectVersionMismatch, parseFrame } from "./parse.js";
import { TransportError } from "./errors.js";
import type { Logger } from "./logger.js";

/** One socket, one handshake, no reconnect. `PeerClient` owns the retries. */
export interface PeerSessionOptions {
  endpoint: string;
  token: string;
  chain: string;
  node: string;
  haveSeq: () => number;
  logger: Logger;
  connectTimeoutMs: number;
  handshakeTimeoutMs: number;
  maxPayloadBytes: number;
  maxBufferedBytes: number;
  maxEventsPerFrame: number;
  /** Called for every validated frame after hello. */
  onFrame: (frame: Frame) => void;
}

function closeErrorMessage(code: number, reason: string, endpoint: string): string {
  const suffix = reason === "" ? "" : ` (${reason})`;
  switch (code) {
    case CLOSE_CODES.unauthorized:
      return `authentication rejected by ${endpoint}: wrong or missing chain token${suffix}`;
    case CLOSE_CODES.chainMismatch:
      return `chain mismatch reported by ${endpoint}${suffix}`;
    case CLOSE_CODES.versionMismatch:
      return `version mismatch reported by ${endpoint}${suffix}`;
    case CLOSE_CODES.badFrame:
      return `peer ${endpoint} rejected a frame${suffix}`;
    default:
      return `peer closed connection to ${endpoint}: ${code}${suffix}`;
  }
}

function isTerminalClose(code: number): boolean {
  return (
    code === CLOSE_CODES.unauthorized ||
    code === CLOSE_CODES.chainMismatch ||
    code === CLOSE_CODES.versionMismatch ||
    code === CLOSE_CODES.badFrame
  );
}

export class PeerSession {
  /** Set when the socket carried a protocol violation after the handshake. */
  protocolError: TransportError | null = null;
  /** Resolves when the socket is fully closed. */
  readonly closed: Promise<void>;

  private constructor(
    private readonly socket: WebSocket,
    readonly peerNode: string,
    closed: Promise<void>,
    private readonly logger: Logger,
    private readonly endpoint: string,
    private readonly maxBufferedBytes: number,
  ) {
    this.closed = closed;
  }

  /** Connect, exchange hello, validate version and chain. */
  static open(options: PeerSessionOptions): Promise<PeerSession> {
    return new Promise<PeerSession>((resolve, reject) => {
      const socket = new WebSocket(options.endpoint, {
        headers: { authorization: `Bearer ${options.token}` },
        handshakeTimeout: options.connectTimeoutMs,
        maxPayload: options.maxPayloadBytes,
        perMessageDeflate: false,
      });

      let settleClosed: () => void = () => undefined;
      const closed = new Promise<void>((done) => {
        settleClosed = done;
      });

      let settled = false;
      let handshakeTimer: NodeJS.Timeout | null = null;
      let session: PeerSession | null = null;

      const failHandshake = (error: TransportError): void => {
        if (settled) return;
        settled = true;
        if (handshakeTimer !== null) clearTimeout(handshakeTimer);
        reject(error);
      };

      const succeed = (hello: HelloFrame): void => {
        if (settled) return;
        settled = true;
        if (handshakeTimer !== null) clearTimeout(handshakeTimer);
        session = new PeerSession(
          socket,
          hello.node,
          closed,
          options.logger,
          options.endpoint,
          options.maxBufferedBytes,
        );
        resolve(session);
      };

      const violation = (message: string, code: number): void => {
        const error = new TransportError(message, false);
        if (session !== null) session.protocolError = error;
        if (!settled) failHandshake(error);
        socket.close(code, message.slice(0, 120));
      };

      socket.on("open", () => {
        let seq = 0;
        try {
          seq = options.haveSeq();
        } catch (error) {
          options.logger.log("warn", `haveSeq threw: ${error instanceof Error ? error.message : String(error)}`);
        }
        socket.send(
          encodeHello({ chain: options.chain, node: options.node, haveSeq: seq }),
        );
        handshakeTimer = setTimeout(() => {
          failHandshake(
            new TransportError(
              `handshake with ${options.endpoint} timed out after ${options.handshakeTimeoutMs}ms`,
              true,
            ),
          );
          socket.close(CLOSE_CODES.handshakeTimeout, "handshake timeout");
        }, options.handshakeTimeoutMs);
      });

      socket.on("message", (data: unknown) => {
        const text = decodeFrameData(data);
        const parsed =
          text === null
            ? { ok: false as const, reason: "unsupported binary frame" }
            : parseFrame(text, { maxEvents: options.maxEventsPerFrame });

        if (!parsed.ok) {
          const version = text === null ? null : detectVersionMismatch(text);
          violation(
            version ?? `malformed frame from ${options.endpoint}: ${parsed.reason}`,
            version === null ? CLOSE_CODES.badFrame : CLOSE_CODES.versionMismatch,
          );
          return;
        }

        const frame = parsed.frame;
        if (!settled) {
          if (frame.t !== "hello") {
            violation(`peer sent ${frame.t} before hello`, CLOSE_CODES.badFrame);
            return;
          }
          if (frame.chain !== options.chain) {
            violation(
              `chain mismatch: client is on "${options.chain}", peer is on "${frame.chain}"`,
              CLOSE_CODES.chainMismatch,
            );
            return;
          }
          succeed(frame);
          return;
        }

        if (options.onFrame !== undefined) options.onFrame(frame);
      });

      socket.on("close", (code: number, reason: Buffer) => {
        const open = settled;
        settled = true;
        if (handshakeTimer !== null) clearTimeout(handshakeTimer);
        settleClosed();
        const message = closeErrorMessage(code, reason.toString("utf8"), options.endpoint);
        options.logger.log("debug", message);
        if (!open) reject(new TransportError(message, !isTerminalClose(code)));
      });

      socket.on("error", (error: Error) => {
        if (!settled) {
          failHandshake(new TransportError(`socket error for ${options.endpoint}: ${error.message}`, true));
        } else {
          options.logger.log("warn", `socket error for ${options.endpoint}: ${error.message}`);
        }
      });
    });
  }

  send(frame: Frame): boolean {
    if (this.socket.readyState !== WebSocket.OPEN) return false;
    if (this.socket.bufferedAmount > this.maxBufferedBytes) {
      this.logger.log("warn", `send buffer to ${this.endpoint} is full; dropped ${frame.t} frame`);
      return false;
    }
    this.socket.send(encodeFrame(frame));
    return true;
  }

  close(code = 1000, reason = ""): void {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    this.socket.close(code, reason.slice(0, 120));
  }
}

function encodeHello(parts: { chain: string; node: string; haveSeq: number }): string {
  const hello: HelloFrame = { t: "hello", v: PROTOCOL_VERSION, chain: parts.chain, node: parts.node, haveSeq: parts.haveSeq };
  return JSON.stringify(hello);
}
