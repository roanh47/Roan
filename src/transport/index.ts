/**
 * Peer transport: WebSocket links between nodes in the same chain.
 *
 * Server side: `startPeerServer`. Client side: `new PeerClient` + `frames()`.
 * The protocol types and the frame parser are here too, so both ends and any
 * future web client share one definition.
 */
export { CLOSE_CODES, PROTOCOL_VERSION, encodeFrame } from "./protocol.js";
export type {
  AppendFrame,
  Event,
  EventsFrame,
  Frame,
  HelloFrame,
  ParseOptions,
  ParseResult,
  ToolReqFrame,
  ToolResFrame,
} from "./protocol.js";

export {
  decodeFrameData,
  detectVersionMismatch,
  eventsBelongTo,
  frameChainMismatch,
  parseEvent,
  parseFrame,
} from "./parse.js";

export { startPeerServer } from "./server.js";
export type { Peer, PeerServer, PeerServerOptions } from "./server.js";

export { PeerClient } from "./client.js";
export type { ConnectionState, PeerClientOptions } from "./client.js";

export { TransportError } from "./errors.js";
export { createBackoff } from "./backoff.js";
export type { Backoff, BackoffOptions } from "./backoff.js";
export { createLogger, nullLogger } from "./logger.js";
export type { Logger, LogLevel } from "./logger.js";
