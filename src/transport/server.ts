import type { IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { CLOSE_CODES, PROTOCOL_VERSION, encodeFrame, type Frame, type HelloFrame } from "./protocol.js";
import { decodeFrameData, detectVersionMismatch, frameChainMismatch, parseFrame } from "./parse.js";
import { PeerConnection, presentedToken, tokenMatches, type Peer } from "./peer-connection.js";
import { nullLogger, type Logger } from "./logger.js";

const DEFAULT_MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_EVENTS_PER_FRAME = 1_000;
const SHUTDOWN_GRACE_MS = 2_000;

export type { Peer } from "./peer-connection.js";

export interface PeerServerOptions {
  /** This node's name, sent in hello and used to tag peers. */
  node: string;
  /** The chain this server belongs to. Anything else is refused. */
  chain: string;
  /** Shared chain token every peer must present. */
  token: string;
  host?: string;
  /** 0 (default) picks a free port; read it back from `PeerServer.port`. */
  port?: number;
  logger?: Logger;
  /** Last sequence number this node has for the chain, for hello. */
  getHaveSeq?: () => number;
  maxPayloadBytes?: number;
  maxBufferedBytes?: number;
  handshakeTimeoutMs?: number;
  maxEventsPerFrame?: number;
  onPeer?: (peer: Peer, hello: HelloFrame) => void;
  onFrame?: (peer: Peer, frame: Frame) => void;
  onPeerClose?: (peerId: string) => void;
}

export interface PeerServer {
  readonly host: string;
  readonly port: number;
  readonly peers: readonly Peer[];
  /** Send to every established peer. Returns how many accepted the frame. */
  broadcast(frame: Frame): number;
  close(): Promise<void>;
}

/**
 * Start listening for chain peers. Resolves once the socket is bound, so
 * `port` is the real port even when it was requested as 0.
 */
export function startPeerServer(options: PeerServerOptions): Promise<PeerServer> {
  if (options.node.trim() === "") throw new Error("peer server needs a node name");
  if (options.chain.trim() === "") throw new Error("peer server needs a chain id");
  if (options.token.trim() === "") throw new Error("peer server needs a chain token");

  const logger = options.logger ?? nullLogger;
  const host = options.host ?? "0.0.0.0";
  const requestedPort = options.port ?? 0;
  const maxPayload = options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
  const maxBuffered = options.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;
  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
  const maxEvents = options.maxEventsPerFrame ?? DEFAULT_MAX_EVENTS_PER_FRAME;
  const peers = new Map<string, PeerConnection>();
  const sockets = new Map<string, WebSocket>();
  let counter = 0;

  const wss = new WebSocketServer({
    host,
    port: requestedPort,
    maxPayload,
    perMessageDeflate: false,
  });

  const haveSeq = (): number => {
    if (options.getHaveSeq === undefined) return 0;
    try {
      return options.getHaveSeq();
    } catch (error) {
      logger.log("error", `getHaveSeq threw: ${error instanceof Error ? error.message : String(error)}`);
      return 0;
    }
  };

  wss.on("connection", (socket: WebSocket, request: IncomingMessage) => {
    try {
      handleConnection(socket, request);
    } catch (error) {
      // Nothing may escape the socket handler.
      logger.log("error", `connection setup failed: ${error instanceof Error ? error.message : String(error)}`);
      socket.terminate();
    }
  });

  function handleConnection(socket: WebSocket, request: IncomingMessage): void {
    const id = `${options.node}-${++counter}`;
    const remoteAddress = request.socket.remoteAddress;

    socket.on("error", (error: Error) => {
      logger.log("warn", `socket error on ${id}: ${error.message}`);
    });

    // Auth first: no frame of any kind goes out before the token checks out.
    if (!tokenMatches(presentedToken(request), options.token)) {
      logger.log("warn", `rejected ${remoteAddress ?? "unknown"}: bad or missing chain token`);
      socket.close(CLOSE_CODES.unauthorized, "unauthorized");
      return;
    }

    const peer = new PeerConnection(id, remoteAddress, socket, logger, maxBuffered);
    sockets.set(id, socket);

    let handshaken = false;
    const timer = setTimeout(() => {
      if (handshaken) return;
      logger.log("warn", `peer ${id} did not send hello within ${handshakeTimeoutMs}ms`);
      peer.close(CLOSE_CODES.handshakeTimeout, "handshake timeout");
    }, handshakeTimeoutMs);

    socket.send(
      encodeFrame({ t: "hello", v: PROTOCOL_VERSION, chain: options.chain, node: options.node, haveSeq: haveSeq() }),
    );

    socket.on("message", (data: unknown) => {
      try {
        const text = decodeFrameData(data);
        if (text === null) {
          peer.close(CLOSE_CODES.badFrame, "binary frame not supported");
          return;
        }
        const parsed = parseFrame(text, { maxEvents });
        if (!parsed.ok) {
          const version = detectVersionMismatch(text);
          logger.log("warn", `bad frame from ${id}: ${version ?? parsed.reason}`);
          peer.close(version === null ? CLOSE_CODES.badFrame : CLOSE_CODES.versionMismatch, version ?? parsed.reason);
          return;
        }
        const frame = parsed.frame;

        if (!handshaken) {
          if (frame.t !== "hello") {
            peer.close(CLOSE_CODES.badFrame, `expected hello, got ${frame.t}`);
            return;
          }
          if (frame.chain !== options.chain) {
            const message = `chain mismatch: server is on "${options.chain}", peer is on "${frame.chain}"`;
            logger.log("warn", `rejected ${id}: ${message}`);
            peer.close(CLOSE_CODES.chainMismatch, message);
            return;
          }
          handshaken = true;
          clearTimeout(timer);
          peer.node = frame.node;
          peer.haveSeq = frame.haveSeq;
          peers.set(id, peer);
          logger.log("info", `peer ${frame.node} (${id}) joined chain ${options.chain} at seq ${frame.haveSeq}`);
          options.onPeer?.(peer, frame);
          return;
        }

        if (frame.t === "hello") {
          peer.close(CLOSE_CODES.badFrame, "duplicate hello");
          return;
        }
        const mismatch = frameChainMismatch(frame, options.chain);
        if (mismatch !== null) {
          logger.log("warn", `chain mismatch on ${id}: ${mismatch}`);
          peer.close(CLOSE_CODES.chainMismatch, mismatch);
          return;
        }
        options.onFrame?.(peer, frame);
      } catch (error) {
        // A throwing consumer must not take the socket handler down with it.
        logger.log("error", `frame handling failed on ${id}: ${error instanceof Error ? error.message : String(error)}`);
        peer.close(1011, "internal error");
      }
    });

    socket.on("close", (code: number, reason: Buffer) => {
      clearTimeout(timer);
      const wasPeer = peers.delete(id);
      sockets.delete(id);
      if (wasPeer) {
        logger.log("info", `peer ${id} left (${code}${reason.length > 0 ? ` ${reason.toString("utf8")}` : ""})`);
        options.onPeerClose?.(id);
      }
    });
  }

  return new Promise<PeerServer>((resolve, reject) => {
    const onError = (error: Error): void => {
      reject(new Error(`peer server failed to listen on ${host}:${requestedPort}: ${error.message}`));
    };
    wss.once("error", onError);
    wss.once("listening", () => {
      wss.off("error", onError);
      wss.on("error", (error: Error) => logger.log("error", `peer server error: ${error.message}`));

      const address = wss.address();
      const boundPort = typeof address === "object" && address !== null ? address.port : requestedPort;

      resolve({
        host,
        port: boundPort,
        get peers(): readonly Peer[] {
          return [...peers.values()];
        },
        broadcast(frame: Frame): number {
          let accepted = 0;
          for (const peer of peers.values()) {
            if (peer.send(frame)) accepted += 1;
          }
          return accepted;
        },
        close(): Promise<void> {
          for (const socket of sockets.values()) {
            socket.close(1001, "server closing");
          }
          return new Promise<void>((done) => {
            const timer = setTimeout(() => {
              for (const socket of sockets.values()) socket.terminate();
            }, SHUTDOWN_GRACE_MS);
            wss.close(() => {
              clearTimeout(timer);
              sockets.clear();
              peers.clear();
              done();
            });
          });
        },
      });
    });
  });
}
