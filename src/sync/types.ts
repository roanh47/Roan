/**
 * Wire protocol and the minimal store interface that replication needs.
 *
 * The store is the single source of truth for the chain: it knows the highest
 * seq, the id per seq and the events themselves. Replication never writes to
 * the chain itself and expects `append` to only add: never overwrite, never
 * fill holes with anything other than the event that belongs on that seq.
 */

/** One immutable event in the chain. */
export interface Event {
  /** Protocol version of the event itself. */
  v: 1;
  /** Name of the chain; events from different chains are never mixed. */
  chain: string;
  /** Position in the chain, 1-based and contiguous. */
  seq: number;
  /** Globally unique id of this event. Two events with the same seq should have the same id. */
  id: string;
  /** Node that created the event. */
  node: string;
  /** Unix time in ms. */
  ts: number;
  /** Kind of event, freely chosen by the layer above. */
  type: string;
  /** Payload; replication does not look inside it. */
  data: unknown;
}

/** Handshake: "this is me, this is how much I have". */
export interface HelloFrame {
  t: "hello";
  v: 1;
  chain: string;
  node: string;
  /** Highest seq the sender has; 0 means an empty chain. */
  haveSeq: number;
}

/** Batch of events, ascending by seq. */
export interface EventsFrame {
  t: "events";
  events: Event[];
}

/** One live event. */
export interface AppendFrame {
  t: "append";
  event: Event;
}

/** Frames that replication itself sends or understands. */
export type Frame = HelloFrame | EventsFrame | AppendFrame;

/** Outcome of an append attempt; the store decides, not replication. */
export type AppendOutcome =
  | { status: "appended" }
  | { status: "duplicate" }
  | { status: "conflict"; existingId: string };

export type Unsubscribe = () => void;

/**
 * What replication expects from storage.
 *
 * Invariants the implementation must guard:
 * - `append` only writes at `head() + 1` and refuses anything outside that.
 * - `append` never overwrites an existing event; same seq + different id is a conflict.
 * - `subscribe` reports every successful append synchronously, in seq order.
 */
export interface NodeStore {
  /** Id of this node, used in hello and in conflict reports. */
  readonly nodeId: string;
  /** Name of the chain this store keeps. */
  readonly chain: string;
  /** Highest seq in the chain, 0 if the chain is empty. */
  head(): number;
  /** Id of the event at `seq`, or undefined if that seq does not exist. */
  idAt(seq: number): string | undefined;
  /** Whether this event id is already in the chain (anywhere). */
  has(id: string): boolean;
  /** Events with seq >= `from`, ascending. `since(0)` returns the whole chain. */
  since(from: number): Event[];
  /** Appends; see the invariants above. */
  append(event: Event): AppendOutcome;
  /** Listens for local appends; returns a function to stop. */
  subscribe(listener: (event: Event) => void): Unsubscribe;
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Hard conflict: the same seq, a different id. Both sides already have their
 * own event in their chain. Nothing is chosen; the session stops.
 */
export interface ConflictReport {
  kind: "seq-id-mismatch";
  chain: string;
  seq: number;
  localNode: string;
  remoteNode: string;
  localId: string;
  remoteId: string;
}

/**
 * Transport to one peer. The implementation serialises itself (JSON) and hands
 * incoming text to `onMessage`. Replication knows no sockets.
 */
export interface PeerTransport {
  /** Readable name for logs, for example "ws://host:1234". */
  readonly label: string;
  send(frame: Frame): void;
  close(reason?: string): void;
  onMessage(handler: (raw: string) => void): void;
  onClose(handler: (reason?: string) => void): void;
}
