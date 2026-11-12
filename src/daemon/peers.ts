/**
 * Peering for the daemon.
 *
 * Inbound: `startPeerServer` from `../transport/server.js` listens on 7412. It
 * does the transport handshake (token, chain, hello with both heads) and hands
 * every established socket to a `ReplicationSession` from `../sync/replicate.js`.
 *
 * Outbound: `PeerClient` from `../transport/client.js` keeps a link alive to
 * every joined peer, reconnecting with backoff, and its frames feed a second
 * replication session.
 *
 * Two handshakes, one wire: the transport already exchanged `haveSeq` during the
 * hello, and both ends refuse a second hello after that (the server calls it a
 * bad frame, the client closes the link). Replication's own hello therefore never
 * goes on the wire. Instead every connection is seeded locally:
 *
 * - an accepted peer's hello is delivered to the inbound session as-is, so the
 *   side that knows the other is behind sends the missing events;
 * - an outbound link is seeded with `haveSeq: 0` once it is connected, which
 *   makes it push its chain from seq 1. That covers the case where the listening
 *   side is behind, without asking it for a hello it is not allowed to answer.
 *
 * Pushing the chain again on every reconnect is deliberate: it converges after a
 * dropped link without tracking what the peer may have missed.
 */

import { PeerClient } from "../transport/client.js";
import type { Logger as WireLogger } from "../transport/logger.js";
import type { Frame as WireFrame } from "../transport/protocol.js";
import { startPeerServer, type Peer, type PeerServer } from "../transport/server.js";
import { ReplicationSession } from "../sync/replicate.js";
import type { ConflictReport, Frame, Logger, NodeStore, PeerTransport } from "../sync/types.js";

/** Port the app and the invite code assume for the peer server. */
export const DEFAULT_PEER_PORT = 7412;

/** How often an outbound link is checked for "connected"; the client emits no event. */
const CONNECT_POLL_MS = 100;

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

export interface PeerTarget {
  readonly host: string;
  readonly port: number;
  /** Remote node name, only for logs before the handshake names it. */
  readonly node?: string;
}

export type PeerAddress = string | PeerTarget;

export interface PeersOptions {
  /** The chain this node keeps; replication reads and appends through it. */
  readonly store: NodeStore;
  /** Shared chain token. Never logged. */
  readonly token: string;
  /** Listen address; defaults to all interfaces. */
  readonly host?: string;
  /** Defaults to 7412, or 0 for a free port (read back from `peerPort()`). */
  readonly port?: number;
  readonly logger?: Logger;
  /** Same-seq-different-id. The chain diverged; nothing is picked. */
  readonly onConflict?: (report: ConflictReport) => void;
  /** Protocol errors that are not about content (bad frame, wrong chain). */
  readonly onError?: (error: Error) => void;
}

interface LinkHooks {
  send: (frame: Frame) => boolean;
  close: () => void;
}

/**
 * `PeerTransport` over one transport-level link. Frames arrive from the server
 * callback or the client's iterator instead of a socket of our own.
 */
class LinkTransport implements PeerTransport {
  private messageHandler: ((raw: string) => void) | undefined;
  private closeHandler: ((reason?: string) => void) | undefined;
  private closed = false;

  constructor(
    readonly label: string,
    private readonly logger: Logger,
    private readonly hooks: LinkHooks,
  ) {}

  get isClosed(): boolean {
    return this.closed;
  }

  send(frame: Frame): void {
    if (this.closed) return;
    if (frame.t === "hello") {
      // See the file comment: a second hello is a protocol error at this layer,
      // and connection-level seeding already gave both sides the same answer.
      this.logger.debug("replication hello kept local; the transport handshake already exchanged heads", {
        peer: this.label,
      });
      return;
    }
    if (!this.hooks.send(frame)) {
      this.logger.warn("frame not sent: the link to the peer is not writable", {
        peer: this.label,
        t: frame.t,
      });
    }
  }

  close(reason?: string): void {
    if (this.closed) return;
    this.closed = true;
    this.hooks.close();
    this.logger.debug("link closed locally", { peer: this.label, reason: reason ?? "local" });
  }

  onMessage(handler: (raw: string) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: (reason?: string) => void): void {
    this.closeHandler = handler;
  }

  /** Feed one raw frame from the transport into replication. */
  deliver(raw: string): void {
    if (this.closed) return;
    this.messageHandler?.(raw);
  }

  /** The other side went away; tell replication once. */
  remoteClosed(reason?: string): void {
    if (this.closed) return;
    this.closed = true;
    this.closeHandler?.(reason);
  }
}

interface InboundLink {
  readonly node: string;
  readonly peer: Peer;
  readonly transport: LinkTransport;
  readonly session: ReplicationSession;
}

interface OutboundLink {
  readonly endpoint: string;
  readonly label: string;
  readonly client: PeerClient;
  readonly transport: LinkTransport;
  readonly session: ReplicationSession;
  readonly logger: Logger;
  readonly store: NodeStore;
  timer: NodeJS.Timeout | null;
  connected: boolean;
}

interface PeersState {
  readonly store: NodeStore;
  readonly token: string;
  readonly logger: Logger;
  readonly server: PeerServer;
  readonly inbound: Map<string, InboundLink>;
  readonly outbound: Map<string, OutboundLink>;
  readonly port: number;
  readonly onConflict?: (report: ConflictReport) => void;
  readonly onError?: (error: Error) => void;
}

let state: PeersState | null = null;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toWireLogger(logger: Logger): WireLogger {
  return {
    log(level, message) {
      logger[level](message);
    },
  };
}

/** Wraps a session status so `peers()` only reports links that can still carry events. */
function isLive(session: ReplicationSession): boolean {
  return session.status !== "failed" && session.status !== "conflicted" && session.status !== "closed";
}

function endpointOf(target: PeerAddress): string {
  if (typeof target === "string") {
    const text = target.trim();
    if (text === "") throw new Error("peer address is empty");
    return text.includes("://") ? text : `ws://${text}`;
  }
  const host = target.host.trim();
  if (host === "") throw new Error("peer address has no host");
  if (!Number.isInteger(target.port) || target.port < 1 || target.port > 65_535) {
    throw new Error(`peer address has no usable port: ${target.port}`);
  }
  return `ws://${host}:${target.port}`;
}

function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}

/**
 * Starts listening for peers on `port` (7412 by default). Outbound links are
 * added with `addPeer`. Throws when called twice; call `stopPeers()` first when
 * the chain changes.
 */
export async function startPeers(options: PeersOptions): Promise<void> {
  if (state !== null) {
    throw new Error("peers are already running on this node; call stopPeers() before starting them again");
  }
  if (options.token.trim() === "") throw new Error("peers need the chain token");

  const store = options.store;
  const logger = options.logger ?? silentLogger;
  const inbound = new Map<string, InboundLink>();
  const outbound = new Map<string, OutboundLink>();
  const onConflict = options.onConflict;
  const onError = options.onError;

  const server = await startPeerServer({
    node: store.nodeId,
    chain: store.chain,
    token: options.token,
    host: options.host,
    port: options.port ?? DEFAULT_PEER_PORT,
    logger: toWireLogger(logger),
    getHaveSeq: () => store.head(),
    onPeer(peer, hello) {
      const transport = new LinkTransport(`inbound:${peer.id}`, logger, {
        send: (frame: Frame) => peer.send(frame as WireFrame),
        close: () => peer.close(1000, "replication done"),
      });
      const session = new ReplicationSession({
        store,
        transport,
        logger,
        onConflict,
        onError: (error) => onError?.(error),
      });
      inbound.set(peer.id, { node: hello.node, peer, transport, session });
      logger.info("peer joined", { peer: hello.node, haveSeq: hello.haveSeq });
      // The server consumed the wire hello; replication gets the same statement
      // locally so it can answer with the events the peer is missing.
      transport.deliver(JSON.stringify(hello));
    },
    onFrame(peer, frame) {
      inbound.get(peer.id)?.transport.deliver(JSON.stringify(frame));
    },
    onPeerClose(peerId) {
      const link = inbound.get(peerId);
      if (link === undefined) return;
      inbound.delete(peerId);
      logger.info("peer left", { peer: link.node });
      link.transport.remoteClosed("peer left");
    },
  });

  state = {
    store,
    token: options.token,
    logger,
    server,
    inbound,
    outbound,
    port: server.port,
    onConflict: options.onConflict,
    onError: options.onError,
  };
}

/**
 * Connects to a joined peer. Accepts `ws://host:port`, `host:port`, or
 * `{ host, port }`. Reconnecting happens inside `PeerClient`; calling this twice
 * for the same endpoint is a no-op.
 */
export function addPeer(target: PeerAddress): void {
  const current = state;
  if (current === null) throw new Error("cannot add a peer before startPeers()");

  const endpoint = endpointOf(target);
  if (current.outbound.has(endpoint)) return;

  const logger = current.logger;
  const client = new PeerClient({
    url: endpoint,
    token: current.token,
    chain: current.store.chain,
    node: current.store.nodeId,
    haveSeq: () => current.store.head(),
    logger: toWireLogger(logger),
  });

  const transport = new LinkTransport(endpoint, logger, {
    send: (frame: Frame) => client.send(frame as WireFrame),
    close: () => {
      void client.close();
    },
  });

  const link: OutboundLink = {
    endpoint,
    label: hostOf(endpoint),
    client,
    transport,
    session: new ReplicationSession({
      store: current.store,
      transport,
      logger,
      onConflict: current.onConflict,
      onError: (error) => current.onError?.(error),
    }),
    logger,
    store: current.store,
    timer: null,
    connected: false,
  };

  current.outbound.set(endpoint, link);
  const timer = setInterval(() => watchOutbound(link), CONNECT_POLL_MS);
  timer.unref();
  link.timer = timer;
  void pumpOutbound(link);
}

/** Polls the one bit `PeerClient` does not raise an event for. */
function watchOutbound(link: OutboundLink): void {
  if (link.transport.isClosed) return;
  if (!link.client.connected) {
    link.connected = false;
    return;
  }
  if (link.connected) return;
  link.connected = true;
  seedOutbound(link);
}

/**
 * Tells replication "the peer has nothing yet", which makes it send the chain
 * from seq 1. Used on every (re)connect; duplicates are dropped by the store.
 */
function seedOutbound(link: OutboundLink): void {
  const hello: Frame = {
    t: "hello",
    v: 1,
    chain: link.store.chain,
    node: link.client.peerNode ?? link.label,
    haveSeq: 0,
  };
  link.transport.deliver(JSON.stringify(hello));
  link.logger.info("outbound link seeded", { peer: link.label, head: link.store.head() });
}

async function pumpOutbound(link: OutboundLink): Promise<void> {
  try {
    for await (const frame of link.client.frames()) {
      if (link.transport.isClosed) break;
      link.transport.deliver(JSON.stringify(frame));
    }
  } catch (error) {
    link.logger.error("outbound peer link stopped", { peer: link.label, reason: messageOf(error) });
  } finally {
    link.transport.remoteClosed("outbound link closed");
  }
}

/** Node names of the peers that are connected and able to carry events. */
export function peers(): readonly string[] {
  const current = state;
  if (current === null) return [];

  const names = new Set<string>();
  for (const link of current.inbound.values()) {
    if (isLive(link.session) && link.node !== "") names.add(link.node);
  }
  for (const link of current.outbound.values()) {
    if (!link.client.connected || !isLive(link.session)) continue;
    const node = link.client.peerNode ?? link.label;
    if (node !== "") names.add(node);
  }
  return [...names].sort();
}

/** Port the server actually listens on (useful when `port: 0` was requested). */
export function peerPort(): number | null {
  return state?.port ?? null;
}

/** Closes every link and the listener. Safe to call when nothing is running. */
export async function stopPeers(): Promise<void> {
  const current = state;
  if (current === null) return;
  state = null;

  const outbound = [...current.outbound.values()];
  current.outbound.clear();
  for (const link of outbound) {
    if (link.timer !== null) clearInterval(link.timer);
    link.session.close("stopping");
    await link.client.close();
  }

  const inbound = [...current.inbound.values()];
  current.inbound.clear();
  for (const link of inbound) {
    link.transport.remoteClosed("stopping");
    link.session.close("stopping");
  }

  await current.server.close();
}
