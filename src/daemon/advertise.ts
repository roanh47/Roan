import type { NetworkInterfaceInfo } from "node:os";

/**
 * How the peer link listens. The default is the tailnet only: the handshake
 * refuses strangers anyway, but the door does not have to stand open on every
 * network a machine happens to touch. A machine without Tailscale falls back
 * to loopback and says so in its invite (no routes) instead of pretending.
 *
 * `lan` reverts to the old listen-all behaviour for whoever wants it.
 * A specific address is taken literally.
 */
export type PeerBind =
  | { readonly kind: "tailscale"; readonly address: string }
  | { readonly kind: "address"; readonly address: string }
  | { readonly kind: "lan" }
  | { readonly kind: "loopback" };

/** Interface names that belong to containers, never to a network a peer dials. */
const BRIDGE_NAME = /^(docker|br-|veth)/i;

function isBridge(name: string): boolean {
  return BRIDGE_NAME.test(name);
}

/** First entry, or null when the list is empty; keeps the index access checked. */
function first(hosts: readonly string[]): string | null {
  return hosts[0] ?? null;
}

/**
 * Every dialable IPv4 address on this machine, docker bridges excluded, as
 * `[tailnet, lan]` — the tailnet range (`100.64.0.0/10`) first because that is
 * the network the other devices can always reach.
 */
export function realInterfaces(
  interfaces: Record<string, NetworkInterfaceInfo[] | undefined>,
): { tailnet: string[]; lan: string[] } {
  const tailnet: string[] = [];
  const lan: string[] = [];
  for (const [name, addresses] of Object.entries(interfaces)) {
    if (isBridge(name)) continue;
    for (const address of addresses ?? []) {
      if (address.family !== "IPv4" || address.internal) continue;
      if (address.address.startsWith("100.64.")) tailnet.push(address.address);
      else lan.push(address.address);
    }
  }
  return { tailnet, lan };
}

/**
 * Resolves `ROAN_PEER_BIND` (or the legacy `ROAN_PEER_HOST`) into a bind.
 * Defaults to the tailnet address; without one, loopback — sync then waits
 * for an explicit choice instead of quietly listening on every network.
 */
export function resolvePeerBind(
  interfaces: Record<string, NetworkInterfaceInfo[] | undefined>,
  env: { ROAN_PEER_BIND?: string; ROAN_PEER_HOST?: string } = process.env,
): PeerBind {
  const bind = env["ROAN_PEER_BIND"]?.trim() ?? "";
  const legacy = env["ROAN_PEER_HOST"]?.trim() ?? "";

  if (bind.length > 0) return fromChoice(bind, interfaces);
  if (legacy.length > 0) return fromChoice(legacy, interfaces);

  const { tailnet } = realInterfaces(interfaces);
  const address = first(tailnet);
  if (address !== null) return { kind: "tailscale", address };
  return { kind: "loopback" };
}

function fromChoice(
  choice: string,
  interfaces: Record<string, NetworkInterfaceInfo[] | undefined>,
): PeerBind {
  if (choice === "lan" || choice === "0.0.0.0" || choice === "::") return { kind: "lan" };
  if (choice === "loopback" || choice === "127.0.0.1" || choice === "localhost") return { kind: "loopback" };
  if (choice === "tailscale") {
    const { tailnet } = realInterfaces(interfaces);
    const address = first(tailnet);
    if (address !== null) return { kind: "tailscale", address };
    return { kind: "loopback" };
  }
  return { kind: "address", address: choice };
}

/** What the peer server passes as its listen host. */
export function bindListenHost(bind: PeerBind): string {
  switch (bind.kind) {
    case "tailscale":
    case "address":
      return bind.address;
    case "lan":
      return "0.0.0.0";
    case "loopback":
      return "127.0.0.1";
  }
}

/**
 * The addresses another device can dial, ordered best first — and never more
 * than the bind actually exposes: an invite carrying a LAN address of a
 * tailscale-only node is a route the door does not open.
 *
 * `ROAN_PEER_ADVERTISE` (one or more, comma-separated) overrides the list for
 * whoever runs behind a port forward or a reverse proxy.
 */
export function advertiseHosts(
  bind: PeerBind,
  interfaces: Record<string, NetworkInterfaceInfo[] | undefined>,
  explicit = process.env["ROAN_PEER_ADVERTISE"] ?? "",
): string[] {
  const hosts: string[] = [];
  const seen = new Set<string>();
  const push = (host: string): void => {
    if (host.length === 0 || host === "0.0.0.0" || host === "::" || seen.has(host)) return;
    seen.add(host);
    hosts.push(host);
  };

  for (const part of explicit.split(",")) push(part.trim());
  if (hosts.length > 0) return hosts;

  const { tailnet, lan } = realInterfaces(interfaces);
  switch (bind.kind) {
    case "tailscale":
    case "address":
      push(bind.address);
      break;
    case "lan":
      for (const address of tailnet) push(address);
      for (const address of lan) push(address);
      break;
    case "loopback":
      break;
  }
  return hosts;
}

/** The one address to show in a log or an announcement: the best route. */
export function advertiseHost(
  bind: PeerBind,
  interfaces: Record<string, NetworkInterfaceInfo[] | undefined>,
  explicit = process.env["ROAN_PEER_ADVERTISE"] ?? "",
): string {
  return advertiseHosts(bind, interfaces, explicit)[0] ?? "";
}
