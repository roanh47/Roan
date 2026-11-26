/**
 * The local socket between the app and the daemon on the same machine.
 *
 * This is not the peer protocol: nothing here goes over the network, and a peer
 * never sees these frames. It exists so the app can ask "what state are you in"
 * and tell the daemon to create or join a chain without any command line.
 */

export interface StateRequest { readonly t: "state" }

export interface CreateChainRequest { readonly t: "create_chain" }

export interface JoinChainRequest {
  readonly t: "join_chain";
  /** The code the user pasted or scanned. Opaque to the app. */
  readonly code: string;
}

export interface PeersRequest { readonly t: "peers" }

export type ControlRequest = StateRequest | CreateChainRequest | JoinChainRequest | PeersRequest;

export interface DaemonState {
  readonly onboarding: boolean;
  readonly chain: string | null;
  readonly node: string | null;
  readonly head: number;
  readonly peers: readonly string[];
  /**
   * The devices this chain shows now, newest fact per node, with the ones a
   * `node_remove` took out left out. A device that announces itself again comes
   * back: a tombstone is "nobody heard from it", not "gone for good".
   */
  readonly nodes: readonly {
    readonly node: string;
    readonly name: string;
    readonly host: string;
    readonly port: number;
    /**
     * Whether this node counts as present now. The local node is live while its
     * daemon runs; a peer is live when it is connected or recently spoke.
     */
    readonly live?: boolean;
  }[];
  /** The code another device pastes in; null before there is a chain. */
  readonly invite: string | null;
  readonly model?: string;
  readonly provider?: string;
  readonly sessions?: readonly { readonly id: string; readonly title: string; readonly messages: number }[];
  readonly activeSession?: string | null;
}

export interface StateResponse { readonly t: "state"; readonly data: DaemonState }

export interface ChainResponse {
  readonly t: "chain";
  readonly chain: string;
  readonly node: string;
  /** Present after creating a chain: hand this to the next machine. */
  readonly invite?: string;
}

export interface ControlError { readonly t: "control_error"; readonly message: string }

export type ControlResponse = StateResponse | ChainResponse | ControlError;

/**
 * A join code carries every way to reach the other node and how to prove the
 * chain. `hosts` is ordered best-first: the joiner dials them all until one
 * opens, so whether the two devices meet over Tailscale or the LAN does not
 * matter — they just have to find each other.
 */
export interface JoinCode {
  readonly v: 2;
  readonly chain: string;
  readonly token: string;
  readonly hosts: readonly string[];
  readonly port: number;
}

export function encodeJoinCode(code: JoinCode): string {
  return Buffer.from(JSON.stringify(code), "utf8").toString("base64url");
}

/**
 * Decodes v2 codes (a `hosts` list) and the v1 codes that carry one `host`.
 * Every address an old or new device ever put in a code stays joinable.
 */
export function decodeJoinCode(text: string): JoinCode {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(text.trim(), "base64url").toString("utf8"));
  } catch {
    throw new Error("this is not a Roan invite code");
  }
  if (typeof parsed !== "object" || parsed === null) throw new Error("this is not a Roan invite code");
  const p = parsed as Record<string, unknown>;
  if (p["v"] !== 1 && p["v"] !== 2) throw new Error("this invite code is from another version of Roan");
  const chain = p["chain"];
  const token = p["token"];
  const port = p["port"];
  if (typeof chain !== "string" || chain.length === 0) throw new Error("invite code has no chain");
  if (typeof token !== "string" || token.length === 0) throw new Error("invite code has no token");
  if (typeof port !== "number" || !Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("invite code has no usable port");
  }
  const hosts: string[] = [];
  // A listen-all address is not an address: codes from the broken era that
  // carry nothing else are refused with a reason instead of joining into
  // silence.
  const pushHost = (entry: unknown): void => {
    if (typeof entry !== "string" || entry.length === 0) return;
    if (entry === "0.0.0.0" || entry === "::") return;
    if (!hosts.includes(entry)) hosts.push(entry);
  };
  pushHost(p["host"]);
  if (Array.isArray(p["hosts"])) {
    for (const entry of p["hosts"]) pushHost(entry);
  }
  if (hosts.length === 0) throw new Error("invite code has no address");
  return { v: 2, chain, token, hosts, port };
}
