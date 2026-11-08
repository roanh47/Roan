/**
 * Parsing and querying helpers for `tailscale status --json`.
 *
 * Everything here is pure: it turns one JSON document into plain data and never
 * runs a command. The process handling lives in `tailscale.ts`, so the parser can
 * be tested against a captured document without a tailnet.
 */

export type TailscaleAvailability =
  | "running"
  | "needs-login"
  | "not-running"
  | "not-installed"
  | "unknown";

export interface TailscaleSelf {
  hostName: string;
  /** MagicDNS name without the trailing dot, e.g. `laptop.tailnet-abc.ts.net`. */
  dnsName: string | null;
  addresses: string[];
  ipv4: string | null;
}

export interface TailscalePeerInfo {
  id: string;
  hostName: string;
  /** MagicDNS name without the trailing dot. */
  dnsName: string;
  addresses: string[];
  ipv4: string | null;
  online: boolean;
}

export interface TailscaleStatus {
  availability: TailscaleAvailability;
  /** Raw `BackendState`, e.g. `Running`, `NeedsLogin`, `Stopped`. */
  backendState: string;
  version: string;
  self: TailscaleSelf | null;
  peers: TailscalePeerInfo[];
}

/** MagicDNS always reports the name with a trailing dot; we never keep it. */
export function stripTrailingDot(name: string): string {
  return name.endsWith(".") ? name.slice(0, -1) : name;
}

/**
 * True for the addresses Tailscale hands out: 100.64.0.0/10 (IPv4 CGNAT space)
 * and fd7a:115c:a1e0::/48 (its IPv6 prefix). Plain 100.x outside that block is
 * somebody else's carrier NAT and must not be mistaken for a tailnet address.
 */
export function isTailnetAddress(address: string): boolean {
  const value = address.trim().toLowerCase();
  if (value.startsWith("fd7a:115c:a1e0:")) return true;

  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== "100") return false;
  const second = parts[1];
  if (second === undefined || !/^\d{1,3}$/.test(second)) return false;
  const octet = Number(second);
  return octet >= 64 && octet <= 127;
}

export function firstIpv4(addresses: string[]): string | null {
  return addresses.find((a) => /^\d{1,3}(\.\d{1,3}){3}$/.test(a)) ?? null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function availabilityFromBackendState(state: string): TailscaleAvailability {
  switch (state) {
    case "Running":
      return "running";
    case "NeedsLogin":
    case "NeedsMachineAuth":
      return "needs-login";
    case "Stopped":
    case "NoState":
    case "Starting":
      return "not-running";
    default:
      return "unknown";
  }
}

function parsePeer(id: string, value: unknown): TailscalePeerInfo | null {
  const record = asRecord(value);
  if (!record) return null;

  const hostName = asString(record["HostName"]) ?? asString(record["hostName"]) ?? "";
  const rawDnsName = asString(record["DNSName"]) ?? asString(record["dnsName"]) ?? "";
  const addresses = asStringArray(record["TailscaleIPs"] ?? record["tailscaleIPs"]);
  const online = record["Online"] === true || record["online"] === true;

  return {
    id,
    hostName,
    dnsName: stripTrailingDot(rawDnsName),
    addresses,
    ipv4: firstIpv4(addresses),
    online,
  };
}

/**
 * Turn `tailscale status --json` output into data. Throws with the first bytes of
 * the offending output when it is not JSON — a truncated document or a daemon
 * that printed a warning instead of a status is a real failure and must not be
 * mistaken for "no peers".
 */
export function parseTailscaleStatus(stdout: string): TailscaleStatus {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    const preview = stdout.trim().slice(0, 120) || "<empty>";
    throw new Error(`tailscale status --json did not return JSON: ${preview}`);
  }

  const root = asRecord(parsed);
  if (!root) throw new Error("tailscale status --json returned something other than an object");

  const backendState = asString(root["BackendState"]) ?? asString(root["backendState"]) ?? "";
  const version = asString(root["Version"]) ?? asString(root["version"]) ?? "";

  const selfRecord = asRecord(root["Self"]);
  let self: TailscaleSelf | null = null;
  if (selfRecord) {
    const addresses = asStringArray(selfRecord["TailscaleIPs"] ?? selfRecord["tailscaleIPs"]);
    const dnsName = asString(selfRecord["DNSName"]) ?? asString(selfRecord["dnsName"]);
    self = {
      hostName: asString(selfRecord["HostName"]) ?? asString(selfRecord["hostName"]) ?? "",
      dnsName: dnsName ? stripTrailingDot(dnsName) : null,
      addresses,
      ipv4: firstIpv4(addresses),
    };
  }

  const peersRecord = asRecord(root["Peer"]);
  const peers: TailscalePeerInfo[] = [];
  if (peersRecord) {
    for (const [id, value] of Object.entries(peersRecord)) {
      const peer = parsePeer(id, value);
      if (peer) peers.push(peer);
    }
  }

  return {
    availability: availabilityFromBackendState(backendState),
    backendState,
    version,
    self,
    peers,
  };
}

/** `server`, `server.tailnet-abc.ts.net.` and `100.64.1.2` all name the same node. */
function normalizePeerQuery(query: string): string {
  let value = query.trim().toLowerCase();
  if (value.includes("://")) {
    // Accept a URL by accident; the host is what matters.
    try {
      value = new URL(value).hostname;
    } catch {
      value = value.split("://")[1] ?? value;
    }
  }
  value = value.replace(/:\d+$/, "");
  return stripTrailingDot(value);
}

/**
 * Find a peer by MagicDNS name, short hostname or tailnet address. Returns null
 * when the tailnet has no such node, so callers can fall back to another route
 * instead of dialing a name that resolved to nothing.
 */
export function matchPeer(
  peers: TailscalePeerInfo[],
  query: string,
): TailscalePeerInfo | null {
  const wanted = normalizePeerQuery(query);
  if (wanted === "") return null;

  for (const peer of peers) {
    const dns = peer.dnsName.toLowerCase();
    if (dns !== "" && dns === wanted) return peer;
  }
  for (const peer of peers) {
    if (peer.addresses.some((address) => address.toLowerCase() === wanted)) return peer;
  }
  for (const peer of peers) {
    if (peer.hostName !== "" && peer.hostName.toLowerCase() === wanted) return peer;
  }

  // `server` against `server.tailnet-abc.ts.net`: compare the first label, but
  // never match a dotted query whose domain differs from the peer's.
  for (const peer of peers) {
    const dns = peer.dnsName.toLowerCase();
    if (dns === "") continue;
    const label = dns.split(".")[0];
    if (label !== undefined && label === wanted) return peer;
  }

  return null;
}
