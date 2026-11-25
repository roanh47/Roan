import type {
  Event,
  EventsFrame,
  HelloFrame,
  Logger,
  NodeStore,
  PeerTransport,
} from "./types.js";

/** Events per `events`-frame; small enough for a slow line, large enough to be useful. */
const DEFAULT_PAGE_SIZE = 200;
/** Hard upper bound on `pageSize`, even if the caller passes something bigger. */
const MAX_PAGE_SIZE = 2_000;
/** Number of failed `send` attempts on a page before we give up. */
const MAX_SEND_RETRIES = 2;
/** Wait before that single retry; there is never more than one timer. */
const RETRY_DELAY_MS = 1_000;

export type BackfillStatus = "idle" | "sending" | "complete" | "failed" | "stopped";

/** Snapshot of what the backfill is doing; safe to log or display. */
export interface BackfillProgress {
  status: BackfillStatus;
  /** Last `haveSeq` the peer mentioned in a hello. */
  peerHaveSeq: number;
  /** First seq of the current plan; 0 when there is nothing to send. */
  from: number;
  /** Last seq of the current plan (the local head when the plan was made); 0 when there is nothing. */
  to: number;
  /** Next seq that still has to go out. */
  nextSeq: number;
  /** Highest seq that actually made it onto the wire. */
  lastSeqSent: number;
  eventsSent: number;
  pagesSent: number;
  /** Counts only consecutive failed send attempts; resets after a successful page. */
  retries: number;
  pendingRetry: boolean;
}

export interface BackfillDeps {
  store: NodeStore;
  transport: PeerTransport;
  /** Events per frame; defaults to 200, capped at 2000. */
  pageSize?: number;
  logger?: Logger;
}

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Computes the contiguous seq range the peer is missing and we can deliver.
 *
 * `remoteHead` is what the peer says it has (the `haveSeq` from its hello),
 * `localHead` is what we have (defaults to `store.head()`). The result runs
 * from `remoteHead + 1` up to and including `localHead`. If the peer is level
 * or ahead, or the input is not a valid seq, there is nothing to send and the
 * result is `null`.
 *
 * The function does not touch the store and invents nothing: it only works out
 * the boundaries. Whether an event really sits on every seq is checked by the
 * `Backfiller` when it packs the pages.
 */
export function planBackfill(
  local: NodeStore,
  remoteHead: number,
  localHead?: number,
): { from: number; to: number } | null {
  if (!Number.isInteger(remoteHead) || remoteHead < 0) return null;
  const head = localHead ?? local.head();
  if (!Number.isInteger(head) || head < 0) return null;
  const from = remoteHead + 1;
  if (from > head) return null;
  return { from, to: head };
}

/**
 * Serves one chain to one peer that is behind.
 *
 * The peer asks with a `hello` (haveSeq = what it has); we answer with
 * `events` frames, one per page, until our head is reached. An explicit
 * request frame does not exist in this protocol, so the hello is the request.
 *
 * Rules this class guards:
 * - only events from `store.since()`, in seq order and without holes;
 * - a frame only goes out when every event has a valid seq and id;
 * - ids already sent to this peer do not go out a second time;
 * - a second `start()` or a repeated hello with the same range starts no
 *   second runner and sends no duplicate page;
 * - on a send that throws there is exactly one `setTimeout` retry, and `stop()`
 *   cleans it up.
 */
export class Backfiller {
  private readonly store: NodeStore;
  private readonly transport: PeerTransport;
  private readonly logger: Logger;
  private readonly pageSize: number;

  private running = false;
  private pumping = false;
  private closed = false;
  private statusValue: BackfillStatus = "idle";

  private plan: { from: number; to: number } | null = null;
  private cursor = 0;
  private peerHaveSeq = 0;
  private lastSeqSent = 0;
  private eventsSent = 0;
  private pagesSent = 0;
  private retries = 0;

  /** id → seq of what this peer already got from us; dedupe across repeated hellos. */
  private readonly sentIds = new Map<string, number>();

  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: BackfillDeps) {
    this.store = deps.store;
    this.transport = deps.transport;
    this.logger = deps.logger ?? silentLogger;
    this.pageSize = normalizePageSize(deps.pageSize);

    this.transport.onMessage((raw) => this.handleRaw(raw));
    this.transport.onClose((reason) => this.handleClose(reason));
  }

  get status(): BackfillStatus {
    return this.statusValue;
  }

  /** Activates sending. Idempotent: a second call does nothing. */
  start(): this {
    if (this.closed || this.running) return this;
    this.running = true;
    if (this.plan !== null) {
      this.statusValue = "sending";
      this.logger.debug("backfill started", {
        peer: this.transport.label,
        from: this.plan.from,
        to: this.plan.to,
      });
      this.pump();
    }
    return this;
  }

  /** Stops sending and clears the single possible retry timer. Does not close the transport. */
  stop(): void {
    if (!this.running && this.retryTimer === null) return;
    this.running = false;
    this.clearRetry();
    if (this.statusValue !== "failed") this.statusValue = "stopped";
    this.logger.debug("backfill stopped", { peer: this.transport.label, lastSeqSent: this.lastSeqSent });
  }

  /** Handles a hello from the peer; this is the request to backfill. */
  onHello(hello: HelloFrame): void {
    if (this.closed) return;
    if (hello.v !== 1) {
      this.logger.warn("backfill: hello with unknown protocol version", {
        peer: this.transport.label,
        version: hello.v,
      });
      return;
    }
    if (hello.chain !== this.store.chain) {
      this.logger.warn("backfill: hello for another chain", {
        peer: this.transport.label,
        chain: hello.chain,
        expected: this.store.chain,
      });
      return;
    }
    if (hello.node === this.store.nodeId) {
      this.logger.debug("backfill: ignoring hello from ourselves", { peer: this.transport.label });
      return;
    }
    if (!Number.isInteger(hello.haveSeq) || hello.haveSeq < 0) {
      this.logger.warn("backfill: hello with invalid haveSeq", {
        peer: this.transport.label,
        haveSeq: hello.haveSeq,
      });
      return;
    }

    this.peerHaveSeq = hello.haveSeq;
    const plan = planBackfill(this.store, hello.haveSeq);
    if (plan === null) {
      this.plan = null;
      this.cursor = 0;
      if (this.running) this.statusValue = "complete";
      this.logger.debug("backfill: peer already has everything", {
        peer: this.transport.label,
        haveSeq: hello.haveSeq,
        head: this.store.head(),
      });
      return;
    }

    const same = this.plan !== null && this.plan.from === plan.from && this.plan.to === plan.to;
    if (same) {
      // Repeated hello for the same gap: no new plan, no second runner.
      if (this.running) this.pump();
      return;
    }

    this.plan = plan;
    // Ids the peer already has according to this hello no longer need remembering.
    this.pruneSentIds(hello.haveSeq);
    if (this.pumping) {
      // A page is already in flight; only move up if the new range starts later.
      if (plan.from > this.cursor) this.cursor = plan.from;
    } else {
      this.cursor = plan.from;
    }
    this.logger.info("backfill: range planned", {
      peer: this.transport.label,
      from: plan.from,
      to: plan.to,
      peerHaveSeq: hello.haveSeq,
    });
    if (this.running) {
      this.statusValue = "sending";
      this.pump();
    }
  }

  progress(): BackfillProgress {
    return {
      status: this.statusValue,
      peerHaveSeq: this.peerHaveSeq,
      from: this.plan?.from ?? 0,
      to: this.plan?.to ?? 0,
      nextSeq: this.cursor,
      lastSeqSent: this.lastSeqSent,
      eventsSent: this.eventsSent,
      pagesSent: this.pagesSent,
      retries: this.retries,
      pendingRetry: this.retryTimer !== null,
    };
  }

  // --- incoming ---------------------------------------------------------

  private handleRaw(raw: string): void {
    if (this.closed) return;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      this.logger.debug("backfill: ignoring invalid JSON frame", { peer: this.transport.label });
      return;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) return;
    const record = value as Record<string, unknown>;
    if (record["t"] !== "hello") return;

    const v = record["v"];
    const chain = record["chain"];
    const node = record["node"];
    const haveSeq = record["haveSeq"];
    if (v !== 1 || typeof chain !== "string" || typeof node !== "string") return;
    if (typeof haveSeq !== "number" || !Number.isInteger(haveSeq) || haveSeq < 0) return;
    this.onHello({ t: "hello", v: 1, chain, node, haveSeq });
  }

  private handleClose(reason?: string): void {
    if (this.closed) return;
    this.closed = true;
    this.running = false;
    this.clearRetry();
    if (this.statusValue !== "failed") this.statusValue = "stopped";
    this.logger.info("backfill: transport closed", {
      peer: this.transport.label,
      reason: reason ?? "unknown",
    });
  }

  // --- outgoing ---------------------------------------------------------

  private pump(): void {
    if (!this.running || this.pumping || this.retryTimer !== null) return;
    this.pumping = true;
    try {
      this.pumpLoop();
    } finally {
      this.pumping = false;
    }
  }

  private pumpLoop(): void {
    while (this.running) {
      const plan = this.plan;
      if (plan === null) {
        this.statusValue = "complete";
        return;
      }
      // Never past the head of this moment; what comes after is live work.
      const to = Math.min(plan.to, this.store.head());
      if (this.cursor > to) {
        this.statusValue = "complete";
        this.logger.debug("backfill: done", {
          peer: this.transport.label,
          lastSeqSent: this.lastSeqSent,
          pages: this.pagesSent,
        });
        return;
      }

      const page = this.collectPage(to);
      if (page === null) return;
      if (page.events.length === 0) {
        // Everything in this stretch was already sent; advance without a frame.
        this.cursor = page.next;
        continue;
      }
      if (!this.sendPage(page.events, page.next)) return;
    }
  }

  /**
   * Packs the next page from the store. Returns `null` on an error we must not
   * mask: a hole in the store or an event without a usable id/seq.
   */
  private collectPage(to: number): { events: Event[]; next: number } | null {
    const from = this.cursor;
    const candidates = this.store.since(from);
    const events: Event[] = [];
    let expected = from;

    for (const event of candidates) {
      if (event.seq < expected) continue;
      if (event.seq > to) break;
      if (event.seq !== expected) {
        return this.fail(
          `store has no contiguous seq: expected ${expected}, got ${event.seq}`,
        );
      }
      if (!this.isSendable(event)) {
        return this.fail(`event at seq ${event.seq} has no usable id or chain`);
      }
      expected = event.seq + 1;
      if (this.sentIds.has(event.id)) continue;
      events.push(event);
      if (events.length >= this.pageSize) break;
    }

    return { events, next: expected };
  }

  /** One frame per page; on a throw at most `MAX_SEND_RETRIES` retries. */
  private sendPage(events: Event[], next: number): boolean {
    const frame: EventsFrame = { t: "events", events };
    try {
      this.transport.send(frame);
    } catch (error) {
      this.retries += 1;
      const reason = error instanceof Error ? error.message : String(error);
      if (this.retries > MAX_SEND_RETRIES) {
        this.fail(`send to ${this.transport.label} failed ${this.retries} times: ${reason}`);
        return false;
      }
      this.logger.warn("backfill: send failed; one retry scheduled", {
        peer: this.transport.label,
        attempt: this.retries,
        reason,
      });
      this.scheduleRetry();
      return false;
    }

    for (const event of events) {
      this.sentIds.set(event.id, event.seq);
      this.lastSeqSent = Math.max(this.lastSeqSent, event.seq);
    }
    this.cursor = next;
    this.eventsSent += events.length;
    this.pagesSent += 1;
    this.retries = 0;
    return true;
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== null) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.pump();
    }, RETRY_DELAY_MS);
  }

  private clearRetry(): void {
    if (this.retryTimer === null) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private pruneSentIds(haveSeq: number): void {
    for (const [id, seq] of this.sentIds) {
      if (seq <= haveSeq) this.sentIds.delete(id);
    }
  }

  private isSendable(event: Event): boolean {
    return (
      event.chain === this.store.chain &&
      Number.isInteger(event.seq) &&
      event.seq >= 1 &&
      typeof event.id === "string" &&
      event.id.length > 0
    );
  }

  private fail(reason: string): null {
    this.statusValue = "failed";
    this.running = false;
    this.clearRetry();
    this.logger.error(`backfill stopped: ${reason}`, {
      peer: this.transport.label,
      lastSeqSent: this.lastSeqSent,
    });
    return null;
  }
}

function normalizePageSize(pageSize: number | undefined): number {
  if (pageSize === undefined || !Number.isInteger(pageSize) || pageSize < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(pageSize, MAX_PAGE_SIZE);
}
