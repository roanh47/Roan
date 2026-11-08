/**
 * The frozen wire contract for the Roan chain.
 *
 * An event is one entry in the append-only chain. A transport frame is what
 * nodes exchange on the wire. Both are plain JSON; `codec.ts` is the only
 * place that turns them into text and back.
 *
 * Versioning: `Event.v` and `HelloFrame.v` are the only versioned surfaces on
 * the wire. Frames that carry events inherit the event version; `tool_req`
 * and `tool_res` are deliberately unversioned and only live for one turn.
 */

export const PROTOCOL_VERSION = 1 as const;

export type ProtocolVersion = typeof PROTOCOL_VERSION;

/** Every kind of entry the chain can hold. */
export type EventType =
  | "message"
  | "assistant"
  | "tool_call"
  | "tool_result"
  | "error"
  | "turn_start"
  | "turn_end"
  | "env";

/**
 * One entry in the append-only chain.
 *
 * `seq` is assigned by the single writer of the current turn and is
 * monotonically increasing within a chain. `data` is opaque to the transport:
 * its shape is decided by `type` and by the reducer, never by this layer.
 */
export interface Event {
  readonly v: ProtocolVersion;
  readonly chain: string;
  readonly seq: number;
  readonly id: string;
  readonly node: string;
  readonly ts: number;
  readonly type: EventType;
  readonly data: unknown;
}

/** A request from one node for another node to run one tool. */
export interface ToolRequest {
  /** Correlation id; the matching `ToolResult.call` must carry the same value. */
  readonly call: string;
  /** Node that should run the tool. */
  readonly node: string;
  readonly tool: string;
  readonly args: Readonly<Record<string, unknown>>;
}

/** The outcome of one tool request, sent back to the requesting node. */
export interface ToolResult {
  readonly call: string;
  readonly ok: boolean;
  readonly output: string;
}

/** Opening frame: who is here and how far its chain reaches. */
export interface HelloFrame {
  readonly t: "hello";
  readonly v: ProtocolVersion;
  readonly chain: string;
  readonly node: string;
  /** Highest sequence number this node already has; `0` means nothing yet. */
  readonly haveSeq: number;
}

/** A batch of chain events, used for catch-up and live fan-out. */
export interface EventsFrame {
  readonly t: "events";
  readonly events: readonly Event[];
}

/** One newly appended event. */
export interface AppendFrame {
  readonly t: "append";
  readonly event: Event;
}

export interface ToolRequestFrame extends ToolRequest {
  readonly t: "tool_req";
}

export interface ToolResultFrame extends ToolResult {
  readonly t: "tool_res";
}

/**
 * Everything that can cross the wire between nodes.
 *
 * Adding a member here is intentionally a compile error in every exhaustive
 * switch that handles frames (see `validate.ts` and `codec.ts`).
 */
export type TransportFrame =
  | HelloFrame
  | EventsFrame
  | AppendFrame
  | ToolRequestFrame
  | ToolResultFrame;

export type FrameType = TransportFrame["t"];
