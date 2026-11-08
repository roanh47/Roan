/**
 * Wire protocol for the Roan chain transport.
 *
 * Every frame is JSON. `Event` is the unit that travels between nodes; the
 * `Frame` union is how it travels. The version is part of every hello so a
 * peer speaking a different protocol is refused instead of guessed at.
 *
 * Parsing lives in `parse.ts`; this file is types and constants only.
 */

export const PROTOCOL_VERSION = 1 as const;

/** Close codes in the private-use range. They are part of the contract. */
export const CLOSE_CODES = {
  /** Frame was not valid JSON or did not match the protocol shape. */
  badFrame: 4400,
  /** Missing or wrong chain token. */
  unauthorized: 4401,
  /** Peer speaks a different chain. */
  chainMismatch: 4403,
  /** Peer did not say hello in time. */
  handshakeTimeout: 4408,
  /** Peer speaks a different protocol version. */
  versionMismatch: 4426,
  /** Receiver is not draining its queue fast enough. */
  tooSlow: 4429,
} as const;

export interface Event {
  v: 1;
  chain: string;
  seq: number;
  id: string;
  node: string;
  ts: number;
  type: string;
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
  events: Event[];
}

export interface AppendFrame {
  t: "append";
  event: Event;
}

export interface ToolReqFrame {
  t: "tool_req";
  call: string;
  node: string;
  tool: string;
  args: unknown;
}

export interface ToolResFrame {
  t: "tool_res";
  call: string;
  ok: boolean;
  output: string;
}

export type Frame = HelloFrame | EventsFrame | AppendFrame | ToolReqFrame | ToolResFrame;

export type ParseResult =
  | { ok: true; frame: Frame }
  | { ok: false; reason: string };

export interface ParseOptions {
  /** Upper bound on the number of events accepted in one `events` frame. */
  maxEvents?: number;
}

/** Serialise a frame. The only place frames become bytes. */
export function encodeFrame(frame: Frame): string {
  return JSON.stringify(frame);
}
