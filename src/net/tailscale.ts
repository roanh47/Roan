/**
 * Tailscale-first peer addressing.
 *
 * Tailscale is the preferred route between nodes: the tailnet address is the
 * first candidate for every peer, and a LAN address is only a fallback for the
 * case where both machines are on the same network and Tailscale is not up.
 * There is deliberately no Cloudflare/relay path here — if neither route works,
 * the caller gets an error instead of a tunnel to somebody else's edge.
 *
 * Detection is read-only: `tailscale status --json` and `tailscale ip -4`. This
 * module never starts, stops or reconfigures tailscaled.
 */

import dns from "node:dns/promises";
import {
  classifyFailure,
  DEFAULT_COMMAND_TIMEOUT_MS,
  makeRunner,
  silentLogger,
  type CommandRunner,
  type Logger,
} from "./tailscale-cli.js";
import {
  isPrivateLanAddress,
  orderCandidates,
  type AddressCandidate,
  type CandidateOptions,
  type ResolvedRoute,
} from "./peer-address.js";
import {
  isTailnetAddress,
  matchPeer,
  parseTailscaleStatus,
  stripTrailingDot,
  type TailscalePeerInfo,
  type TailscaleStatus,
} from "./tailscale-status.js";

export { silentLogger, type Logger, type CommandRunner } from "./tailscale-cli.js";
export {
  isPrivateLanAddress,
  type AddressCandidate,
  type CandidateOptions,
} from "./peer-address.js";

export interface TailscaleOptions {
  logger?: Logger;
  /** Per command, not per dial attempt. */
  commandTimeoutMs?: number;
  /** How long a detection result may be reused. 0 disables caching. */
  cacheMs?: number;
  bin?: string;
  run?: CommandRunner;
  dnsLookup?: (host: string) => Promise<string[]>;
  /** Look up a LAN address via DNS when the caller has no hint. Default true. */
  discoverLan?: boolean;
}

export interface TailscaleState extends TailscaleStatus {
  /** Why detection came up empty, when it did. */
  error: string | null;
}

const DEFAULT_CACHE_MS = 5000;

export class Tailscale {
  private readonly run: CommandRunner;
  private readonly logger: Logger;
  private readonly commandTimeoutMs: number;
  private readonly cacheMs: number;
  private readonly dnsLookup: (host: string) => Promise<string[]>;
  private readonly discoverLan: boolean;
  private cached: { at: number; state: TailscaleState } | null = null;

  constructor(options: TailscaleOptions = {}) {
    this.logger = options.logger ?? silentLogger;
    this.commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    this.cacheMs = options.cacheMs ?? DEFAULT_CACHE_MS;
    this.run = options.run ?? makeRunner(options.bin);
    this.discoverLan = options.discoverLan ?? true;
    this.dnsLookup =
      options.dnsLookup ??
      (async (host) => {
        const results = await dns.lookup(host, { all: true });
        return results.map((entry) => entry.address);
      });
  }

  /** Forget the cached status; call after a connection failure to re-check. */
  invalidate(): void {
    this.cached = null;
  }

  async status(): Promise<TailscaleState> {
    if (this.cached && this.cacheMs > 0 && Date.now() - this.cached.at < this.cacheMs) {
      return this.cached.state;
    }

    const result = await this.run(["status", "--json"], this.commandTimeoutMs);
    let state: TailscaleState;

    if (!result.ok) {
      const { availability, error } = classifyFailure(result);
      this.logger.warn(`tailscale: ${error}`);
      state = { availability, backendState: "", version: "", self: null, peers: [], error };
    } else {
      try {
        state = { ...parseTailscaleStatus(result.stdout), error: null };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`tailscale: ${message}`);
        state = {
          availability: "unknown",
          backendState: "",
          version: "",
          self: null,
          peers: [],
          error: message,
        };
      }
    }

    this.logger.debug(`tailscale state: ${state.availability} (${state.peers.length} peers)`);
    this.cached = { at: Date.now(), state };
    return state;
  }

  /** True when tailscaled is up and this node has a tailnet address. */
  async isUp(): Promise<boolean> {
    const state = await this.status();
    return state.availability === "running" && state.self !== null;
  }

  /** This node's tailnet IPv4 address, or null when Tailscale is not up. */
  async selfAddress(): Promise<string | null> {
    const state = await this.status();
    if (state.availability !== "running") return null;
    if (state.self?.ipv4) return state.self.ipv4;

    // Older daemons can answer status without listing Self's addresses.
    return this.ipCommand([]);
  }

  /** This node's MagicDNS name (`laptop.tailnet-abc.ts.net`), or null. */
  async selfName(): Promise<string | null> {
    const state = await this.status();
    if (state.availability !== "running") return null;
    const name = state.self?.dnsName;
    return name ? stripTrailingDot(name) : null;
  }

  /** Peers known to tailscaled. Empty when Tailscale is not up. */
  async peers(): Promise<TailscalePeerInfo[]> {
    return (await this.status()).peers;
  }

  /**
   * Resolve a peer name to its tailnet IPv4 address. Accepts a MagicDNS name, a
   * short hostname or a 100.x address. Returns null when Tailscale cannot name
   * the peer, so the caller can fall back rather than dialing a dead address.
   */
  async resolvePeer(peer: string): Promise<string | null> {
    const resolved = await this.resolvePeerRoute(peer);
    return resolved?.address ?? null;
  }

  /** Same as resolvePeer, but keeps how the address was found for error messages. */
  async resolvePeerRoute(peer: string): Promise<ResolvedRoute | null> {
    const query = peer.trim();
    if (query === "") return null;
    if (isTailnetAddress(query)) return { address: query, source: "tailscale-status" };

    const state = await this.status();
    if (state.availability === "not-installed") return null;

    const matched = matchPeer(state.peers, query);
    if (matched?.ipv4) return { address: matched.ipv4, source: "tailscale-status" };

    if (matched) {
      const address = await this.ipCommand([matched.hostName || matched.dnsName]);
      return address ? { address, source: "tailscale-ip" } : null;
    }

    // A peer may be absent from this node's status (shared node, stale view).
    // MagicDNS can still answer, and only a tailnet address counts as an answer.
    try {
      const addresses = await this.dnsLookup(query);
      const tailnet = addresses.find((address) => isTailnetAddress(address));
      if (tailnet) return { address: tailnet, source: "magicdns" };
    } catch {
      return null;
    }
    return null;
  }

  private async ipCommand(extra: string[]): Promise<string | null> {
    const result = await this.run(["ip", "-4", ...extra], this.commandTimeoutMs);
    if (!result.ok) {
      this.logger.debug(`tailscale ip -4 ${extra.join(" ")} failed: ${result.stderr.trim() || result.message}`);
      return null;
    }
    return (
      result.stdout
        .split(/\s+/)
        .map((part) => part.trim())
        .find((part) => isTailnetAddress(part)) ?? null
    );
  }

  /**
   * Ordered routes to a peer: tailnet first, LAN second. Anything else (a
   * hostname that only resolves on the local network, a manual hint) comes last
   * and is labelled so an error can say which route failed.
   */
  async addressCandidates(peer: string, options: CandidateOptions = {}): Promise<AddressCandidate[]> {
    const query = peer.trim();
    if (query === "") throw new Error("cannot build address candidates for an empty peer name");

    const tailnet = await this.resolvePeerRoute(query);

    let lan: ResolvedRoute | null = null;
    const hint = options.lan?.trim();
    if (hint) {
      // A caller-supplied LAN hint still cannot shadow the tailnet route.
      lan = { address: hint, source: "lan-hint" };
    } else if (this.discoverLan) {
      const found = await this.discoverLanAddress(query, tailnet?.address ?? null);
      if (found) lan = { address: found, source: "lan-dns" };
    }

    const candidates = orderCandidates(query, tailnet, lan);
    if (candidates.length === 0) this.logger.warn(`tailscale: no route known for peer "${query}"`);
    return candidates;
  }

  /**
   * Best-effort LAN lookup: a hostname that resolves to a private (RFC 1918)
   * address on this network. Never returns a tailnet address, since that would
   * duplicate the preferred route and lie about which one is local.
   */
  private async discoverLanAddress(peer: string, tailnet: string | null): Promise<string | null> {
    const host = peer.includes(".") ? (peer.split(".")[0] ?? peer) : peer;
    try {
      const addresses = await this.dnsLookup(host);
      return (
        addresses.find(
          (address) => isPrivateLanAddress(address) && !isTailnetAddress(address) && address !== tailnet,
        ) ?? null
      );
    } catch {
      return null;
    }
  }
}
