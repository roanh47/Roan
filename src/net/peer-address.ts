/**
 * What a peer route looks like, and the rule that orders it.
 *
 * Tailscale first, always. A LAN address is a fallback for two machines in the
 * same network and never replaces, or precedes, the tailnet address. Duplicates
 * are dropped so a peer with the same address on both routes is tried once.
 */

export type TailnetSource = "tailscale-status" | "tailscale-ip" | "magicdns";

export interface AddressCandidate {
  address: string;
  /** `tailscale` is always tried before `lan`. */
  kind: "tailscale" | "lan";
  source: TailnetSource | "lan-hint" | "lan-dns";
  /** The peer name the caller asked for, so errors can name it. */
  peer: string;
}

export interface CandidateOptions {
  /** Known LAN address, e.g. from a previous connection or a peer announcement. */
  lan?: string;
}

export interface ResolvedRoute {
  address: string;
  source: TailnetSource | "lan-hint" | "lan-dns";
}

/** RFC 1918 only: link-local and CGNAT are not "LAN" enough to be a fallback. */
export function isPrivateLanAddress(address: string): boolean {
  const parts = address.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => (part === "" ? Number.NaN : Number(part)));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const [a, b] = octets;
  if (a === undefined || b === undefined) return false;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

/**
 * Order the routes for one peer. The tailnet route is the first element whenever
 * it exists; the LAN route is second and never shadows it.
 */
export function orderCandidates(
  peer: string,
  tailnet: ResolvedRoute | null,
  lan: ResolvedRoute | null,
): AddressCandidate[] {
  const candidates: AddressCandidate[] = [];
  const seen = new Set<string>();

  const add = (route: ResolvedRoute | null, kind: AddressCandidate["kind"]): void => {
    if (!route) return;
    const address = route.address.trim();
    if (address === "" || seen.has(address)) return;
    seen.add(address);
    candidates.push({ address, kind, source: route.source, peer });
  };

  add(tailnet, "tailscale");
  add(lan, "lan");
  return candidates;
}
