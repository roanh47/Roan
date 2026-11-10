/**
 * Per-peer transport counters: frames in/out, bytes, reconnects and ack lag.
 *
 * Lag definition (chosen, only one is implemented here):
 *   lag = ACK LATENCY. It is the time between a frame being sent to a peer and
 *   that peer acknowledging it, in milliseconds, as reported by the caller to
 *   `ack(peer, lagMs)`. `lastLagMs` is the most recent sample, `lagAvgMs` the
 *   integer-rounded mean of all samples since the last `reset`.
 *   The other reading of "lag" (how far we are behind a peer, i.e.
 *   `peerHead - ourHead` in seq numbers) is deliberately NOT tracked here:
 *   that is chain progress, belongs to replication, and mixing the two units
 *   in one field is how dashboards start lying.
 *
 * Pure in-memory bookkeeping. No sockets, no timers, no logging: the caller
 * owns the clock (injected via `now`, defaulting to `Date.now`) and feeds every
 * event. Unknown peer names are created on first record, never rejected.
 *
 * Counts never drift: every counter is a non-negative safe integer, incremented
 * by whole numbers and saturated at `Number.MAX_SAFE_INTEGER` rather than
 * silently turning into a float. Bytes are truncated and negative/NaN/Infinity
 * values are clamped to 0.
 *
 * Bounded memory: at most `maxPeers` peers are retained (default 64). When a
 * new peer would exceed the limit, the least-recently-seen peer is evicted and
 * `evictions` is incremented. "Seen" means any recorded activity: a frame in or
 * out, a reconnect or an ack. Reading (`snapshot`, `one`, `toJSON`) never
 * touches recency, so a scrape cannot keep a dead peer alive.
 */

/** Default peer cap. Chosen well above a personal chain's fan-out. */
const DEFAULT_MAX_PEERS = 64;

/** Counter ceiling: above this, integers stop being exactly representable. */
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

export interface PeerMetricsOptions {
  /** Clock used for `lastFrameAt`/recency. Defaults to `Date.now`. */
  now?: () => number;
  /** Maximum number of peers retained; the least-recently-seen is evicted. */
  maxPeers?: number;
}

export interface PeerMetricSnapshot {
  /** Peer name as given by the caller (transport label or node id). */
  peer: string;
  /** Whole frames received from this peer. */
  framesIn: number;
  /** Whole frames sent to this peer. */
  framesOut: number;
  /** Bytes received; 0 when the caller does not report sizes. */
  bytesIn: number;
  /** Bytes sent; 0 when the caller does not report sizes. */
  bytesOut: number;
  /** Successful (re)connects, as reported to `reconnected`. */
  reconnects: number;
  /** Clock reading of the last frame in either direction, or null. */
  lastFrameAt: number | null;
  /** Last observed ack latency in ms, or null before the first ack. */
  lastLagMs: number | null;
  /** Integer-rounded mean ack latency in ms, or null before the first ack. */
  lagAvgMs: number | null;
  /** Frame counts by frame type (`t`); unknown types are kept as given. */
  frameTypesIn: Record<string, number>;
  frameTypesOut: Record<string, number>;
}

/** `toJSON` shape: the snapshots plus the eviction bookkeeping. */
export interface PeerMetricsReport {
  peers: PeerMetricSnapshot[];
  /** Peers dropped to stay within `maxPeers`, since construction or last `reset()`. */
  evictions: number;
  maxPeers: number;
}

interface PeerRecord {
  framesIn: number;
  framesOut: number;
  bytesIn: number;
  bytesOut: number;
  reconnects: number;
  lastFrameAt: number | null;
  lastLagMs: number | null;
  /** Sum of accepted lag samples, kept integral so the mean cannot drift. */
  lagTotalMs: number;
  lagSamples: number;
  /** Last activity of any kind; drives eviction order. */
  lastSeenAt: number;
  frameTypesIn: Map<string, number>;
  frameTypesOut: Map<string, number>;
}

/** Adds `delta` (a non-negative integer) to `current`, saturating safely. */
function bump(current: number, delta = 1): number {
  if (current >= MAX_SAFE) {
    return MAX_SAFE;
  }
  return Math.min(MAX_SAFE, current + delta);
}

/** Truncates a byte count to a non-negative safe integer. */
function bytes(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.min(MAX_SAFE, Math.trunc(value));
}

/** Frame type keys are free-form; an empty or missing one becomes "unknown". */
function frameTypeKey(frameType: string): string {
  return frameType.length > 0 ? frameType : "unknown";
}

function emptyRecord(lastSeenAt: number): PeerRecord {
  return {
    framesIn: 0,
    framesOut: 0,
    bytesIn: 0,
    bytesOut: 0,
    reconnects: 0,
    lastFrameAt: null,
    lastLagMs: null,
    lagTotalMs: 0,
    lagSamples: 0,
    lastSeenAt,
    frameTypesIn: new Map<string, number>(),
    frameTypesOut: new Map<string, number>(),
  };
}

function bumpType(counts: Map<string, number>, key: string): void {
  counts.set(key, bump(counts.get(key) ?? 0));
}

function freezeTypes(counts: Map<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of counts) {
    out[key] = value;
  }
  return out;
}

/** Sorts most-recently-seen first, ties broken by name for stable output. */
function byRecency(a: PeerMetricSnapshot, b: PeerMetricSnapshot, seen: Map<string, number>): number {
  const diff = (seen.get(b.peer) ?? 0) - (seen.get(a.peer) ?? 0);
  return diff !== 0 ? diff : a.peer < b.peer ? -1 : a.peer > b.peer ? 1 : 0;
}

export class PeerMetrics {
  private readonly now: () => number;
  private readonly maxPeers: number;
  private readonly peers = new Map<string, PeerRecord>();
  private evictionCount = 0;

  constructor(options: PeerMetricsOptions = {}) {
    const maxPeers = options.maxPeers ?? DEFAULT_MAX_PEERS;
    if (!Number.isInteger(maxPeers) || maxPeers < 1) {
      throw new Error("invalid metrics options: maxPeers must be a positive integer");
    }
    this.now = options.now ?? Date.now;
    this.maxPeers = maxPeers;
  }

  /** Peers dropped to stay within `maxPeers`. */
  get evictions(): number {
    return this.evictionCount;
  }

  /** Number of peers currently tracked. */
  get size(): number {
    return this.peers.size;
  }

  /**
   * Records a received frame. `bytes` is optional so existing callers can keep
   * the two-argument form; when omitted `bytesIn` simply does not move.
   */
  frameIn(peer: string, frameType: string, bytes_?: number): void {
    const { record, at } = this.touch(peer);
    record.framesIn = bump(record.framesIn);
    record.bytesIn = bump(record.bytesIn, bytes(bytes_));
    record.lastFrameAt = at;
    bumpType(record.frameTypesIn, frameTypeKey(frameType));
  }

  /** Records a sent frame; `bytes` is the encoded size in bytes when known. */
  frameOut(peer: string, frameType: string, bytes_?: number): void {
    const { record, at } = this.touch(peer);
    record.framesOut = bump(record.framesOut);
    record.bytesOut = bump(record.bytesOut, bytes(bytes_));
    record.lastFrameAt = at;
    bumpType(record.frameTypesOut, frameTypeKey(frameType));
  }

  /** Records a successful (re)connect for a peer. Creates it if unknown. */
  reconnected(peer: string): void {
    const { record } = this.touch(peer);
    record.reconnects = bump(record.reconnects);
  }

  /**
   * Records the ack latency for a peer: ms from our send to the peer's ack.
   * Negative, NaN and Infinity samples are ignored (they are clock artefacts,
   * not data) and never reach the average.
   */
  ack(peer: string, lagMs: number): void {
    if (!Number.isFinite(lagMs) || lagMs < 0) {
      return;
    }
    const { record } = this.touch(peer);
    const sample = Math.min(MAX_SAFE, Math.round(lagMs));
    record.lastLagMs = sample;
    record.lagTotalMs = bump(record.lagTotalMs, sample);
    record.lagSamples = bump(record.lagSamples);
  }

  /** Snapshots every peer, most recently seen first. */
  snapshot(): PeerMetricSnapshot[] {
    const seen = new Map<string, number>();
    for (const [peer, record] of this.peers) {
      seen.set(peer, record.lastSeenAt);
    }
    return this.snapshotAll().sort((a, b) => byRecency(a, b, seen));
  }

  /** Snapshot of one peer, or undefined if it was never recorded. Read-only. */
  one(peer: string): PeerMetricSnapshot | undefined {
    const record = this.peers.get(peer);
    return record === undefined ? undefined : this.project(peer, record);
  }

  /**
   * Without an argument: forget every peer and the eviction count.
   * With a peer name: zero that peer's counters, keeping it tracked (recency is
   * not reset, so a reset peer is not instantly evicted). Unknown names are a
   * no-op — reading never invents peers.
   */
  reset(peer?: string): void {
    if (peer === undefined) {
      this.peers.clear();
      this.evictionCount = 0;
      return;
    }
    const record = this.peers.get(peer);
    if (record === undefined) {
      return;
    }
    const fresh = emptyRecord(record.lastSeenAt);
    this.peers.set(peer, fresh);
  }

  /** Report for logs and dashboards: peers plus eviction bookkeeping. */
  toJSON(): PeerMetricsReport {
    return {
      peers: this.snapshot(),
      evictions: this.evictionCount,
      maxPeers: this.maxPeers,
    };
  }

  /**
   * Finds or creates the record for `peer` and marks it seen at `at`.
   *
   * Space is made *before* the insert, so the newcomer is never the peer that
   * gets dropped (that would make a first report vanish). If the clock has gone
   * backwards the newcomer is simply seen as old and may be evicted later.
   */
  private touch(peer: string): { record: PeerRecord; at: number } {
    const at = this.now();
    const existing = this.peers.get(peer);
    if (existing !== undefined) {
      existing.lastSeenAt = at;
      return { record: existing, at };
    }
    this.evictOldestWhileFull();
    const record = emptyRecord(at);
    this.peers.set(peer, record);
    return { record, at };
  }

  /** Drops least-recently-seen peers until there is room for one more. */
  private evictOldestWhileFull(): void {
    while (this.peers.size >= this.maxPeers) {
      let oldestPeer: string | undefined;
      let oldestSeen = Number.POSITIVE_INFINITY;
      for (const [peer, record] of this.peers) {
        if (record.lastSeenAt < oldestSeen) {
          oldestSeen = record.lastSeenAt;
          oldestPeer = peer;
        }
      }
      if (oldestPeer === undefined) {
        return;
      }
      this.peers.delete(oldestPeer);
      this.evictionCount = bump(this.evictionCount);
    }
  }

  private snapshotAll(): PeerMetricSnapshot[] {
    const out: PeerMetricSnapshot[] = [];
    for (const [peer, record] of this.peers) {
      out.push(this.project(peer, record));
    }
    return out;
  }

  private project(peer: string, record: PeerRecord): PeerMetricSnapshot {
    return {
      peer,
      framesIn: record.framesIn,
      framesOut: record.framesOut,
      bytesIn: record.bytesIn,
      bytesOut: record.bytesOut,
      reconnects: record.reconnects,
      lastFrameAt: record.lastFrameAt,
      lastLagMs: record.lastLagMs,
      lagAvgMs: record.lagSamples === 0 ? null : Math.round(record.lagTotalMs / record.lagSamples),
      frameTypesIn: freezeTypes(record.frameTypesIn),
      frameTypesOut: freezeTypes(record.frameTypesOut),
    };
  }
}
