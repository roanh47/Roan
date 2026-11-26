import { compareBranches } from "./order.js";
import type {
  AppendOutcome,
  ConflictReport,
  Event,
  Frame,
  Logger,
  NodeStore,
  PeerTransport,
} from "./types.js";

/** Events per `events`-frame; keeps frames manageable on a slow line. */
const SEND_BATCH = 200;
/** How many ids received from peers we remember to dampen echoes. */
const ECHO_MEMORY = 2048;
/** Upper bound on events waiting for a missing seq. */
const MAX_PENDING = 10_000;

export type ReplicationStatus = "idle" | "live" | "conflicted" | "failed" | "closed";

export type SyncErrorCode =
  | "bad-frame"
  | "chain-mismatch"
  | "version-mismatch"
  | "invalid-event"
  | "store-hole";

export class SyncError extends Error {
  constructor(
    readonly code: SyncErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SyncError";
  }
}

export interface ReplicateOptions {
  store: NodeStore;
  transport: PeerTransport;
  logger: Logger;
  /** Called once on the first hard conflict. */
  onConflict?: (report: ConflictReport) => void;
  /** Protocol errors that are not about content (wrong chain, broken frame). */
  onError?: (error: SyncError) => void;
}

type Parsed =
  | { kind: "frame"; frame: Frame }
  | { kind: "foreign"; t: string }
  | { kind: "bad"; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEvent(value: unknown): value is Event {
  if (!isRecord(value)) return false;
  const seq = value["seq"];
  return (
    value["v"] === 1 &&
    typeof value["chain"] === "string" &&
    typeof seq === "number" &&
    Number.isInteger(seq) &&
    seq >= 1 &&
    typeof value["id"] === "string" &&
    value["id"].length > 0 &&
    typeof value["node"] === "string" &&
    typeof value["ts"] === "number" &&
    typeof value["type"] === "string"
  );
}

function parseFrame(raw: string): Parsed {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { kind: "bad", reason: "not valid JSON" };
  }
  if (!isRecord(value)) return { kind: "bad", reason: "frame is not an object" };

  const t = value["t"];
  if (t === "hello") {
    const chain = value["chain"];
    const node = value["node"];
    const haveSeq = value["haveSeq"];
    if (value["v"] !== 1) return { kind: "bad", reason: "hello with unknown version" };
    if (typeof chain !== "string" || typeof node !== "string") {
      return { kind: "bad", reason: "hello without chain or node" };
    }
    if (typeof haveSeq !== "number" || !Number.isInteger(haveSeq) || haveSeq < 0) {
      return { kind: "bad", reason: "hello with invalid haveSeq" };
    }
    return { kind: "frame", frame: { t: "hello", v: 1, chain, node, haveSeq } };
  }

  if (t === "events") {
    const events = value["events"];
    if (!Array.isArray(events)) return { kind: "bad", reason: "events without a list" };
    const parsed: Event[] = [];
    for (const rawEvent of events) {
      const item: unknown = rawEvent;
      if (!isEvent(item)) return { kind: "bad", reason: "events contains an invalid event" };
      parsed.push(item);
    }
    return { kind: "frame", frame: { t: "events", events: parsed } };
  }

  if (t === "append") {
    const event = value["event"];
    if (!isEvent(event)) return { kind: "bad", reason: "append without a valid event" };
    return { kind: "frame", frame: { t: "append", event } };
  }

  if (typeof t === "string") return { kind: "foreign", t };
  return { kind: "bad", reason: "frame without a type" };
}

/**
 * Replication of one chain to one peer.
 *
 * How it works:
 * 1. On start both sides send a `hello` with their highest seq.
 * 2. Whoever is behind says so by sending a `hello` (again); whoever is ahead
 *    answers with the events the other is missing. An explicit request frame
 *    is therefore unnecessary: the hello is the request.
 * 3. At equal seq the leading side sends one overlap event (the anchor). If
 *    the other has a different id there, the chain has two branches.
 * 4. Loose `append` frames keep the live flow going after that.
 *
 * Two writers may take the same seq. Nothing is dropped and nothing is
 * rewritten: the local branch stays where it is and the other is rebased
 * behind it. A local event that no longer fits the peer's seq space (because
 * the peer is ahead, or because that seq is already someone else's) is sent
 * as it is — the peer rebases it — instead of being skipped by a catch-up
 * that had nothing left to send.
 *
 * Siblings that arrive together, before the gap below them is closed, are
 * placed with `compareBranches` from `order.ts`, so the placement does not
 * depend on which frame happened to arrive first.
 */
export class ReplicationSession {
  private statusValue: ReplicationStatus = "idle";
  private peerNode: string | undefined;
  /** Highest seq we know the peer has. */
  private lastSentSeq = 0;
  /** Events waiting for a missing seq, grouped: two writers may share one seq. */
  private readonly pending = new Map<number, Event[]>();
  /** Ids we received from this peer; prevents sending them back. */
  private readonly remoteIds = new Set<string>();
  private readonly requested = new Set<string>();
  private readonly conflictList: ConflictReport[] = [];
  /**
   * True once this peer's seq space diverged from ours: two writers picked
   * the same seq. From then on this peer's seq numbers are ordering hints
   * inside its own stream, not positions in our chain — every unknown
   * incoming event is rebased onto our head. Both sides do the same, so
   * both branches survive everywhere instead of the link freezing.
   */
  private mergeMode = false;
  private readonly unsubscribe: () => void;
  private closed = false;

  constructor(private readonly opts: ReplicateOptions) {
    this.unsubscribe = opts.store.subscribe((event) => this.onLocalEvent(event));
    opts.transport.onMessage((raw) => this.handleRaw(raw));
    opts.transport.onClose((reason) => this.handleClose(reason));
  }

  get status(): ReplicationStatus {
    return this.statusValue;
  }

  get conflicts(): readonly ConflictReport[] {
    return this.conflictList;
  }

  /** Number of events waiting for a missing seq. */
  get buffered(): number {
    let count = 0;
    for (const group of this.pending.values()) count += group.length;
    return count;
  }

  /** Sends the first hello. Idempotent; calling it again is a new request. */
  start(): this {
    this.sendHello("start");
    return this;
  }

  close(reason = "local"): void {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
    this.pending.clear();
    if (this.statusValue !== "conflicted") this.statusValue = "closed";
    this.opts.transport.close(reason);
  }

  // --- incoming ---------------------------------------------------------

  private handleRaw(raw: string): void {
    if (this.statusValue === "conflicted" || this.statusValue === "failed" || this.closed) return;

    const parsed = parseFrame(raw);
    if (parsed.kind === "bad") {
      this.fail(new SyncError("bad-frame", `invalid frame from ${this.opts.transport.label}: ${parsed.reason}`));
      return;
    }
    if (parsed.kind === "foreign") {
      // tool_req/tool_res and anything that is not replication we leave alone.
      this.opts.logger.debug("ignored foreign frame", { t: parsed.t, peer: this.opts.transport.label });
      return;
    }

    const frame = parsed.frame;
    if (frame.t === "hello") {
      this.onHello(frame);
      return;
    }
    if (frame.t === "events") {
      this.markLive();
      for (const event of frame.events) {
        if (!this.applyRemote(event)) break;
      }
      return;
    }
    this.markLive();
    this.applyRemote(frame.event);
  }

  /**
   * A peer that connects later gets no hello back but events directly; even
   * then the handshake is done and the session is running.
   */
  private markLive(): void {
    if (this.statusValue !== "idle") return;
    this.statusValue = "live";
    this.opts.logger.debug("session live", { peer: this.opts.transport.label });
  }

  private onHello(frame: Extract<Frame, { t: "hello" }>): void {
    if (frame.v !== 1) {
      this.fail(new SyncError("version-mismatch", `peer ${frame.node} speaks protocol ${frame.v}`));
      return;
    }
    if (frame.chain !== this.opts.store.chain) {
      this.fail(
        new SyncError(
          "chain-mismatch",
          `peer ${frame.node} sends chain "${frame.chain}", we have "${this.opts.store.chain}"`,
        ),
      );
      return;
    }
    if (frame.node === this.opts.store.nodeId) {
      this.opts.logger.warn("ignored hello from ourselves", { peer: this.opts.transport.label });
      return;
    }

    this.peerNode = frame.node;
    this.statusValue = "live";
    const local = this.opts.store.head();

    if (frame.haveSeq > local) {
      // Peer is ahead: request the missing events with a new hello.
      // The key prevents us from asking again on every repeated hello.
      const key = `${frame.node}:${frame.haveSeq}:${local}`;
      this.opts.logger.info("peer is ahead; requested missing events", {
        peer: frame.node,
        peerSeq: frame.haveSeq,
        localSeq: local,
      });
      this.lastSentSeq = Math.max(this.lastSentSeq, frame.haveSeq);
      if (!this.requested.has(key)) {
        this.requested.add(key);
        this.sendHello("catch-up");
      }
      return;
    }

    // Peer is behind or level: we send what it is missing. At equal seq that is
    // exactly one anchor event, so it can spot a deviating id on that seq.
    this.lastSentSeq = Math.max(this.lastSentSeq, frame.haveSeq);
    this.sendSince(frame.haveSeq);
    this.lastSentSeq = Math.max(this.lastSentSeq, this.opts.store.head());
  }

  /** Returns false if the session must stop (conflict or error). */
  private applyRemote(event: Event): boolean {
    if (this.statusValue === "conflicted" || this.statusValue === "failed" || this.closed) return false;

    if (event.v !== 1) {
      this.fail(new SyncError("invalid-event", `event ${event.id} has protocol version ${event.v}`));
      return false;
    }
    if (event.chain !== this.opts.store.chain) {
      this.fail(
        new SyncError("invalid-event", `event ${event.id} belongs to chain "${event.chain}"`),
      );
      return false;
    }
    if (this.opts.store.has(event.id)) {
      this.opts.logger.debug("ignored duplicate event", { id: event.id, seq: event.seq });
      return true;
    }

    // Merge mode: the peer's stream rebase onto our head, in arrival order.
    // Their ids keep them deduped; their events become our tail.
    if (this.mergeMode) {
      const ok = this.rebaseRemote(event);
      // A rebased event may be exactly the seq a buffered group was waiting
      // for; without this the group would sit there for ever.
      if (ok) this.flushPending();
      return ok;
    }

    const head = this.opts.store.head();
    if (event.seq > head + 1) {
      if (event.seq > head + MAX_PENDING) {
        this.fail(
          new SyncError(
            "invalid-event",
            `event ${event.id} is ${event.seq - head} ahead of seq ${head}; that is not normal lag`,
          ),
        );
        return false;
      }
      this.buffer(event);
      return true;
    }
    if (event.seq === head + 1) {
      const ok = this.appendRemote(event);
      this.flushPending();
      return ok;
    }

    // seq <= head: does something already exist at that spot?
    const existingId = this.opts.store.idAt(event.seq);
    if (existingId === undefined) {
      this.fail(
        new SyncError("store-hole", `store has no event at seq ${event.seq}, but head is ${head}`),
      );
      return false;
    }
    if (existingId !== event.id) {
      // Two writers picked the same seq. Nobody's history gets deleted:
      // we keep ours where it is and rebase this peer's branch after it.
      this.reportDivergence(event.seq, existingId, event.id, event.node);
      return this.rebaseRemote(event);
    }
    this.opts.logger.debug("event was already present", { id: event.id, seq: event.seq });
    return true;
  }

  /** One incoming event onto the local tail, whatever seq it arrived with. */
  private rebaseRemote(event: Event): boolean {
    if (this.opts.store.has(event.id)) {
      this.opts.logger.debug("rebased event already present", { id: event.id });
      return true;
    }
    const rebased: Event = { ...event, seq: this.opts.store.head() + 1 };
    // Before the append, like `appendRemote`: a rebased event is still the
    // peer's event, and it must not be echoed back at it.
    this.rememberRemoteId(event.id);
    const outcome: AppendOutcome = this.opts.store.append(rebased);
    if (outcome.status === "appended") {
      this.opts.logger.debug("branch rebased", { id: event.id, seq: rebased.seq, vanSeq: event.seq });
      return true;
    }
    if (outcome.status === "duplicate") return true;
    this.reportDivergence(event.seq, outcome.existingId, event.id, event.node);
    return true;
  }

  private buffer(event: Event): void {
    const group = this.pending.get(event.seq) ?? [];
    if (group.some((queued) => queued.id === event.id)) return;
    group.push(event);
    // Siblings are kept in the one order every node computes, so the placement
    // does not depend on which of them happened to arrive first.
    group.sort(compareBranches);
    this.pending.set(event.seq, group);
    if (group.length === 1) {
      this.opts.logger.debug("event buffered until the gap closes", {
        seq: event.seq,
        head: this.opts.store.head(),
      });
      return;
    }
    // A second event for the same seq is not a gap but a branch: two writers
    // picked one place. Both are kept; `flushPending` puts the first at that
    // seq and rebases the rest behind it.
    const first = group[0];
    const second = group[1];
    if (first !== undefined && second !== undefined) {
      this.reportDivergence(event.seq, first.id, second.id, second.node);
    }
    this.flushPending();
  }

  private appendRemote(event: Event): boolean {
    // Register before the append so the subscribe callback recognises it as an echo.
    this.rememberRemoteId(event.id);
    const outcome: AppendOutcome = this.opts.store.append(event);
    if (outcome.status === "appended") {
      this.lastSentSeq = Math.max(this.lastSentSeq, event.seq);
      this.opts.logger.debug("event applied", { id: event.id, seq: event.seq, node: event.node });
      return true;
    }
    if (outcome.status === "duplicate") {
      this.opts.logger.debug("store called event a duplicate", { id: event.id });
      return true;
    }
    this.reportDivergence(event.seq, outcome.existingId, event.id, event.node);
    return true;
  }

  private flushPending(): void {
    for (;;) {
      const next = this.opts.store.head() + 1;
      const group = this.pending.get(next);
      if (group === undefined) return;
      this.pending.delete(next);
      const first = group[0];
      if (first === undefined) continue;
      if (!this.appendRemote(first)) return;
      // Everything else in the group competed for the same seq; it was sorted
      // by the shared rule, so it lands in the same order on every node.
      for (let index = 1; index < group.length; index++) {
        const sibling = group[index];
        if (sibling === undefined) continue;
        if (!this.rebaseRemote(sibling)) return;
      }
    }
  }

  // --- outgoing ---------------------------------------------------------

  private sendHello(reason: string): void {
    const frame: Frame = {
      t: "hello",
      v: 1,
      chain: this.opts.store.chain,
      node: this.opts.store.nodeId,
      haveSeq: this.opts.store.head(),
    };
    this.opts.transport.send(frame);
    this.opts.logger.debug("hello sent", {
      reason,
      haveSeq: frame.haveSeq,
      peer: this.opts.transport.label,
    });
  }

  /** Sends everything from `from` (inclusive), in batches. */
  private sendSince(from: number): void {
    const events = this.opts.store.since(Math.max(0, from));
    if (events.length === 0) return;
    for (let i = 0; i < events.length; i += SEND_BATCH) {
      const batch: Frame = { t: "events", events: events.slice(i, i + SEND_BATCH) };
      this.opts.transport.send(batch);
    }
    this.opts.logger.debug("events sent", {
      from,
      count: events.length,
      peer: this.opts.transport.label,
    });
  }

  private onLocalEvent(event: Event): void {
    if (this.statusValue === "conflicted" || this.statusValue === "failed" || this.closed) return;

    if (this.remoteIds.has(event.id)) {
      this.remoteIds.delete(event.id);
      return;
    }

    if (this.mergeMode) {
      // The peer's seq space is its own; it rebases whatever we send.
      this.opts.transport.send({ t: "append", event });
      return;
    }

    if (event.seq <= this.lastSentSeq) {
      // The peer claims this seq already, with another event: two writers took
      // the same place and we only now notice. A catch-up would silently skip
      // ours, so this event goes out as it is and the peer rebases it.
      this.enterMergeMode(event);
      this.opts.transport.send({ t: "append", event });
      return;
    }

    if (event.seq !== this.lastSentSeq + 1) {
      // The peer is missing history (or we know no better): send the sequence again
      // instead of a loose event it cannot place anyway.
      this.opts.logger.debug("gap in what the peer has; catch-up sent", {
        seq: event.seq,
        peerHas: this.lastSentSeq,
      });
      this.sendSince(this.lastSentSeq);
      this.lastSentSeq = Math.max(this.lastSentSeq, this.opts.store.head());
      return;
    }

    this.lastSentSeq = event.seq;
    this.opts.transport.send({ t: "append", event });
  }

  /**
   * From here on this peer's seq numbers are hints, not positions: every event
   * it has that we do not know is rebased onto our tail, and the other way
   * round. Both sides do it, so no branch is lost and no event is quietly
   * skipped because the peer "should already have" that seq.
   */
  private enterMergeMode(event: Event): void {
    if (this.mergeMode) return;
    this.mergeMode = true;
    this.opts.logger.warn(
      `local event ${event.id} at seq ${event.seq} does not fit what peer ${this.peerNode ?? this.opts.transport.label} reports (${this.lastSentSeq}); from now on branches are rebased`,
      { peer: this.opts.transport.label, seq: event.seq, peerHas: this.lastSentSeq },
    );
  }

  // --- shutting down ----------------------------------------------------

  /**
   * A divergence, reported but never fatal: the report stays visible for
   * whoever listens, the link stays open, and this peer's branch merges
   * after ours. Both sides do the same, so every event survives on every
   * node — in the other's order on the other node, which is the honest
   * price of two writers on one append-only line.
   */
  private reportDivergence(seq: number, localId: string, remoteId: string, remoteNode: string): void {
    if (!this.mergeMode) this.mergeMode = true;
    const report: ConflictReport = {
      kind: "seq-id-mismatch",
      chain: this.opts.store.chain,
      seq,
      localNode: this.opts.store.nodeId,
      remoteNode: this.peerNode ?? remoteNode,
      localId,
      remoteId,
    };
    if (this.conflictList.some((entry) => entry.remoteId === remoteId && entry.localId === localId)) return;
    this.conflictList.push(report);
    this.opts.logger.warn(
      `branch at seq ${seq}: local id ${localId}, remote id ${remoteId}; the remote branch rebases behind ours`,
      { ...report },
    );
    this.opts.onConflict?.(report);
  }

  private fail(error: SyncError): void {
    if (this.statusValue === "failed" || this.statusValue === "conflicted") return;
    this.statusValue = "failed";
    this.opts.logger.error(error.message, { code: error.code, peer: this.opts.transport.label });
    this.opts.onError?.(error);
    this.pending.clear();
    this.closed = true;
    this.unsubscribe();
    this.opts.transport.close(error.code);
  }

  private handleClose(reason?: string): void {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
    this.pending.clear();
    this.statusValue = "closed";
    this.opts.logger.info("connection with peer closed", {
      reason: reason ?? "unknown",
      peer: this.opts.transport.label,
    });
  }

  private rememberRemoteId(id: string): void {
    this.remoteIds.add(id);
    if (this.remoteIds.size <= ECHO_MEMORY) return;
    const oldest = this.remoteIds.values().next().value;
    if (typeof oldest === "string") this.remoteIds.delete(oldest);
  }
}

/** Creates and starts a replication session for one chain and one peer. */
export function replicate(options: ReplicateOptions): ReplicationSession {
  return new ReplicationSession(options).start();
}
