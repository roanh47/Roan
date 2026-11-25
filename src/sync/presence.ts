import type { Event, HelloFrame } from "./types.js";

/**
 * Local bookkeeping of who is alive and how far along they are.
 *
 * Presence does nothing with the network itself: no sockets, no timers. The
 * caller reports a hello or an event and supplies the clock (`now`); expiry
 * is applied at read time. That makes the behaviour deterministic to test and
 * nothing in this module can "expire" on its own.
 *
 * A node that shows up again after its TTL simply gets the same entry with a
 * fresh `lastSeen`; no second entry is added.
 */

export interface PresenceOptions {
  /** How long a node stays live after its last sign of life. */
  ttlMs?: number;
  /** Clock in ms; defaults to `Date.now`. */
  now?: () => number;
}

export interface PresenceEntry {
  node: string;
  chain: string;
  /** Highest seq we know of for this node. */
  head: number;
  transportLabel?: string;
  /** Clock value (ms) of the last sign of life. */
  lastSeen: number;
  /** Whether `lastSeen` falls within the TTL at read time. */
  live: boolean;
}

export interface PresenceSnapshot {
  chain: string | null;
  live: PresenceEntry[];
  stale: PresenceEntry[];
}

/** Default TTL: half a minute without a sign of life is no longer live. */
export const DEFAULT_PRESENCE_TTL_MS = 30_000;

interface PresenceRecord {
  node: string;
  chain: string;
  head: number;
  transportLabel: string | undefined;
  lastSeen: number;
}

export class Presence {
  private readonly ttlMs: number;
  private readonly clock: () => number;
  private readonly records = new Map<string, PresenceRecord>();
  /** The chain this presence belongs to; `null` until the first report. */
  private chainValue: string | null = null;

  constructor(options: PresenceOptions = {}) {
    const ttlMs = options.ttlMs ?? DEFAULT_PRESENCE_TTL_MS;
    if (!Number.isFinite(ttlMs) || ttlMs < 0) {
      throw new RangeError(`invalid ttlMs: ${String(ttlMs)}`);
    }
    this.ttlMs = ttlMs;
    this.clock = options.now ?? Date.now;
  }

  /** Chain name as it came from the first hello or the first event. */
  get chain(): string | null {
    return this.chainValue;
  }

  /**
   * Handles a hello from a peer. `haveSeq` is what the peer says it has; a
   * previously observed higher head never drops back, because events we
   * already saw really happened.
   */
  seeHello(hello: HelloFrame, transportLabel?: string): void {
    const now = this.clock();
    this.adoptChain(hello.chain, hello.node);

    const existing = this.records.get(hello.node);
    if (existing === undefined) {
      this.records.set(hello.node, {
        node: hello.node,
        chain: hello.chain,
        head: hello.haveSeq,
        transportLabel,
        lastSeen: now,
      });
      return;
    }

    existing.head = Math.max(existing.head, hello.haveSeq);
    existing.lastSeen = now;
    if (transportLabel !== undefined) existing.transportLabel = transportLabel;
  }

  /**
   * Handles an event: the sender is alive and is at least at `event.seq`.
   * Only a seq higher than the one we know raises the head.
   */
  seeEvent(event: Event, transportLabel?: string): void {
    const now = this.clock();
    this.adoptChain(event.chain, event.node);

    const existing = this.records.get(event.node);
    if (existing === undefined) {
      this.records.set(event.node, {
        node: event.node,
        chain: event.chain,
        head: event.seq,
        transportLabel,
        lastSeen: now,
      });
      return;
    }

    if (event.seq > existing.head) existing.head = event.seq;
    existing.lastSeen = now;
    if (transportLabel !== undefined) existing.transportLabel = transportLabel;
  }

  /** A transport to this node is closed; the node is no longer present. */
  drop(node: string): void {
    this.records.delete(node);
  }

  /** Nodes currently within the TTL, sorted by name. */
  live(): PresenceEntry[] {
    return this.collect(this.clock(), true);
  }

  /** Nodes whose `lastSeen` is older than the TTL, sorted by name. */
  stale(now?: number): PresenceEntry[] {
    return this.collect(now ?? this.clock(), false);
  }

  /**
   * Highest seq of a node, or `undefined` if we do not know it or if it has
   * expired: the head of a dead node is not a live state.
   */
  head(node: string): number | undefined {
    const record = this.records.get(node);
    if (record === undefined) return undefined;
    if (!this.isLive(record, this.clock())) return undefined;
    return record.head;
  }

  snapshot(): PresenceSnapshot {
    const now = this.clock();
    return {
      chain: this.chainValue,
      live: this.collect(now, true),
      stale: this.collect(now, false),
    };
  }

  // --- internal ----------------------------------------------------------

  /** The first report sets the chain; any other chain is an error, not noise. */
  private adoptChain(chain: string, node: string): void {
    if (this.chainValue === null) {
      this.chainValue = chain;
      return;
    }
    if (chain !== this.chainValue) {
      throw new Error(
        `chain-mismatch: node "${node}" reports chain "${chain}", but presence follows chain "${this.chainValue}"`,
      );
    }
  }

  /** Exactly at the TTL boundary counts as live; only after that is a node old. */
  private isLive(record: PresenceRecord, now: number): boolean {
    return now - record.lastSeen <= this.ttlMs;
  }

  private collect(now: number, wantLive: boolean): PresenceEntry[] {
    const entries: PresenceEntry[] = [];
    const nodes = [...this.records.keys()].sort();
    for (const node of nodes) {
      const record = this.records.get(node);
      if (record === undefined) continue;
      const live = this.isLive(record, now);
      if (live !== wantLive) continue;
      entries.push({
        node: record.node,
        chain: record.chain,
        head: record.head,
        transportLabel: record.transportLabel,
        lastSeen: record.lastSeen,
        live,
      });
    }
    return entries;
  }
}
