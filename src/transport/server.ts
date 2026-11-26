import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { WebSocketServer, WebSocket } from "ws";
import { CLOSE_CODES, PROTOCOL_VERSION, encodeFrame, type DeviceReqFrame, type Frame, type HelloFrame } from "./protocol.js";
import { decodeFrameData, detectVersionMismatch, frameChainMismatch, parseFrame } from "./parse.js";
import { PeerConnection, presentedToken, tokenMatches, type Peer } from "./peer-connection.js";
import { nullLogger, type Logger } from "./logger.js";
import {
  executeRequest,
  grantsFromEvents,
  parseRequest,
  type DeviceRunner,
} from "../sync/device-control.js";
import type { Event, NodeStore } from "../sync/types.js";

const DEFAULT_MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_EVENTS_PER_FRAME = 1_000;
const SHUTDOWN_GRACE_MS = 2_000;
/** A device command is one read-only allowlisted program; it may not hang. */
const DEVICE_COMMAND_TIMEOUT_MS = 10_000;
/** Output beyond this is killed by execFile, not buffered without bound. */
const DEVICE_COMMAND_MAX_BYTES = 1 << 20;

export type { Peer } from "./peer-connection.js";

/**
 * Device control as a receiver offers it: the chain to read grants from and to
 * write results into, plus the runner.
 *
 * `run` exists so tests never spawn anything; production omits it and gets
 * `execFile`. Either way the runner is only reached after `executeRequest` has
 * found an enabled grant for the addressed node, and only ever with the argv of
 * an allowlisted command.
 */
export interface DeviceControlOptions {
  /** Chain events: grants are read here and `device_result` is appended here. */
  readonly store: NodeStore;
  /** Injected runner; omit to run the allowlisted program with `execFile`. */
  readonly run?: DeviceRunner;
  /** Output cap in characters; defaults to the `device-control` default. */
  readonly maxOutputChars?: number;
}

/** What `receiveDeviceRequest` needs beyond `DeviceControlOptions`. */
export interface DeviceReceiveOptions extends DeviceControlOptions {
  /** This node's id; a request addressed to any other node is refused. */
  readonly self: string;
  /** Chain of this connection; it must be the store's chain. */
  readonly chain: string;
  readonly logger?: Logger;
  /** Clock and id source, injectable so a test can pin the result event. */
  readonly now?: () => number;
  readonly nextId?: () => string;
}

/** Payload of a `device_result` event. A refusal is a result too. */
export interface DeviceResultPayload {
  /** Node the request was addressed to. */
  readonly node: string;
  /** Command as the frame named it. */
  readonly command: string;
  readonly accepted: boolean;
  /** Runner output, only when `accepted` is true. */
  readonly output?: string;
  /** Why it was refused, only when `accepted` is false. */
  readonly reason?: string;
}

const execFile = promisify(execFileCallback);

/** The only runner production uses. Never called without a grant. */
async function runLocalCommand(argv: readonly string[]): Promise<string> {
  const [file, ...args] = argv;
  if (file === undefined || file.length === 0) {
    throw new Error("device control: empty argv");
  }
  const { stdout } = await execFile(file, args, {
    timeout: DEVICE_COMMAND_TIMEOUT_MS,
    maxBuffer: DEVICE_COMMAND_MAX_BYTES,
    windowsHide: true,
    encoding: "utf8",
  });
  return typeof stdout === "string" ? stdout : String(stdout);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Handle one `device_req` frame: parse it again, look up the grant for the
 * addressed node in the chain, execute only when that grant is enabled, and
 * record the outcome (accepted or refused) as a `device_result` event.
 *
 * Never throws. A bad frame, a disabled or missing grant, a request for
 * another node and a failing runner all end as a result event; the runner is
 * not called on any refusal path.
 */
export async function receiveDeviceRequest(
  frame: DeviceReqFrame,
  options: DeviceReceiveOptions,
): Promise<void> {
  const logger = options.logger ?? nullLogger;
  try {
    const parsed = parseRequest(frame);
    const command = typeof frame.command === "string" ? frame.command.trim() : "";
    const node = parsed.ok ? parsed.request.node : options.self;

    let payload: DeviceResultPayload;
    if (!parsed.ok) {
      payload = { node, command, accepted: false, reason: parsed.reason };
    } else {
      const grant = grantsFromEvents(options.store.since(1)).get(parsed.request.node);
      const result = await executeRequest(parsed.request, options.run ?? runLocalCommand, {
        grant,
        self: options.self,
        chain: options.chain,
        maxOutputChars: options.maxOutputChars,
      });
      payload = result.accepted
        ? { node, command: parsed.request.command, accepted: true, output: result.output }
        : { node, command: parsed.request.command, accepted: false, reason: result.reason };
    }

    appendDeviceResult(options, payload, logger);
  } catch (error: unknown) {
    // The socket handler calls this fire-and-forget; nothing may escape.
    logger.log("error", `device_req handling failed: ${messageOf(error)}`);
  }
}

/** Append one `device_result` at the store's head + 1. */
function appendDeviceResult(
  options: DeviceReceiveOptions,
  payload: DeviceResultPayload,
  logger: Logger,
): void {
  const store = options.store;
  const nextId = options.nextId ?? ((): string => `device-${randomUUID()}`);
  const now = options.now ?? Date.now;
  const event: Event = {
    v: 1,
    chain: store.chain,
    seq: store.head() + 1,
    id: nextId(),
    node: store.nodeId,
    ts: now(),
    type: "device_result",
    data: payload,
  };
  const outcome = store.append(event);
  if (outcome.status !== "appended") {
    logger.log(
      "warn",
      `device_result for ${payload.command} was not written: store said "${outcome.status}"`,
    );
  }
}

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
  /**
   * Listen on `host:port` (the default). `false` binds nothing: the caller
   * mounts `PeerServer.upgrade` on an HTTP server it already runs, so peers
   * share the app's port instead of opening one of their own.
   */
  listen?: boolean;
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
  /**
   * Answer `device_req` frames from peers. Absent means device control is off:
   * such a frame is logged and ignored, never executed.
   */
  device?: DeviceControlOptions;
}

export interface PeerServer {
  readonly host: string;
  readonly port: number;
  readonly peers: readonly Peer[];
  /**
   * Handles one HTTP upgrade for a peer socket. Used when the server was
   * created with `listen: false` and the caller routes `/peer` on its own
   * HTTP server.
   */
  readonly upgrade: (req: IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) => void;
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

  const standalone = options.listen !== false;
  const wss = new WebSocketServer(
    standalone
      ? { host, port: requestedPort, maxPayload, perMessageDeflate: false }
      : { noServer: true, maxPayload, perMessageDeflate: false },
  );

  /** One upgrade handed over by the caller's HTTP server; it routed the path. */
  const upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    wss.handleUpgrade(request, socket, head, (client) => wss.emit("connection", client, request));
  };

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

        if (frame.t === "device_req") {
          const device = options.device;
          if (device === undefined) {
            // Not configured is not an error: the frame is simply not for this
            // node's abilities, and nothing runs.
            logger.log("warn", `ignored device_req on ${id}: device control is not enabled on this node`);
            return;
          }
          void receiveDeviceRequest(frame, {
            store: device.store,
            chain: options.chain,
            self: options.node,
            run: device.run,
            maxOutputChars: device.maxOutputChars,
            logger,
          }).catch((error: unknown) => {
            logger.log("error", `device_req on ${id} failed: ${messageOf(error)}`);
          });
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

  const facade = (boundPort: number): PeerServer => ({
    host,
    port: boundPort,
    get peers(): readonly Peer[] {
      return [...peers.values()];
    },
    upgrade,
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

  // Shared-port mode: nothing to bind and nothing to wait for. The caller holds
  // the HTTP server and calls `upgrade` for the peer path.
  if (!standalone) return Promise.resolve(facade(0));

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
      resolve(facade(boundPort));
    });
  });
}
