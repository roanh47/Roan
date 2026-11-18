import type { NetworkInterfaceInfo } from "node:os";

/**
 * The addresses another device can dial to reach this node.
 *
 * The peer link listens on all interfaces (`0.0.0.0`), but an invite carrying
 * that is an invite nobody can join: it says where the daemon listens, not
 * where it can be called. This collects every dialable route, best first:
 *
 * - `ROAN_PEER_ADVERTISE`, when the operator states one or more (comma-separated);
 * - the specific listen address, when there is one;
 * - the tailnet IPs (`100.64.0.0/10`) — what peers reach over Tailscale;
 * - every other interface address.
 *
 * The joiner calls them all until one opens: the way a peer is reached does
 * not matter, only that they find each other. Pure on injected interfaces,
 * so the priority order is testable without touching the machine.
 */
export function advertiseHosts(
  listenHost: string,
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
  push(listenHost);

  const lan: string[] = [];
  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses ?? []) {
      if (address.family !== "IPv4" || address.internal) continue;
      // The tailnet range is what the other devices can always reach, wherever
      // they are: same overlay network, no port forwarding. LAN comes after.
      if (address.address.startsWith("100.64.")) push(address.address);
      else lan.push(address.address);
    }
  }
  for (const address of lan) push(address);

  return hosts;
}

/** The one address to show in a log or an announcement: the best route. */
export function advertiseHost(
  listenHost: string,
  interfaces: Record<string, NetworkInterfaceInfo[] | undefined>,
  explicit = process.env["ROAN_PEER_ADVERTISE"] ?? "",
): string {
  return advertiseHosts(listenHost, interfaces, explicit)[0] ?? "";
}
