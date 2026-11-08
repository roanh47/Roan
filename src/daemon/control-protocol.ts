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

/** A join code carries where to reach the other node and how to prove the chain. */
export interface JoinCode {
  readonly v: 1;
  readonly chain: string;
  readonly token: string;
  readonly host: string;
  readonly port: number;
}

export function encodeJoinCode(code: JoinCode): string {
  return Buffer.from(JSON.stringify(code), "utf8").toString("base64url");
}

export function decodeJoinCode(text: string): JoinCode {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(text.trim(), "base64url").toString("utf8"));
  } catch {
    throw new Error("this is not a Roan invite code");
  }
  if (typeof parsed !== "object" || parsed === null) throw new Error("this is not a Roan invite code");
  const p = parsed as Record<string, unknown>;
  if (p["v"] !== 1) throw new Error("this invite code is from another version of Roan");
  const chain = p["chain"];
  const token = p["token"];
  const host = p["host"];
  const port = p["port"];
  if (typeof chain !== "string" || chain.length === 0) throw new Error("invite code has no chain");
  if (typeof token !== "string" || token.length === 0) throw new Error("invite code has no token");
  if (typeof host !== "string" || host.length === 0) throw new Error("invite code has no address");
  if (typeof port !== "number" || !Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("invite code has no usable port");
  }
  return { v: 1, chain, token, host, port };
}
