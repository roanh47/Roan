/**
 * Finding a peer by name.
 *
 * A name is looked up on the tailnet first: `Tailscale.addressCandidates` owns
 * the ordering rule, so the tailnet address is the first candidate whenever it
 * exists and a LAN address is only the fallback. This module adds the part the
 * detector deliberately leaves out — a failure that says which peer could not be
 * found and why, instead of handing back an empty list the caller has to explain.
 *
 * Discovery is read-only. It never starts tailscaled and never dials.
 */

import {
  silentLogger,
  Tailscale,
  type AddressCandidate,
  type CandidateOptions,
  type Logger,
  type TailscaleState,
} from "./tailscale.js";

export interface FindPeersOptions extends CandidateOptions {
  logger?: Logger;
  /** Reuse a detector (and its cached status) across lookups. */
  tailscale?: Tailscale;
}

/** One sentence per availability, so a failure names the fix and not just the symptom. */
function fixFor(state: TailscaleState): string {
  switch (state.availability) {
    case "not-installed":
      return "Tailscale is the preferred route and is not installed on this node; install it or supply a LAN address.";
    case "needs-login":
      return "Tailscale is the preferred route and this node is not logged in; run `tailscale up`.";
    case "not-running":
      return "Tailscale is the preferred route and tailscaled is not running; start it or supply a LAN address.";
    default:
      return "Tailscale is the preferred route; check `tailscale status` for this peer, or check the hostname on the LAN.";
  }
}

/**
 * Why the name resolved to nothing, in terms of the name that was asked for.
 * `running` is worth separating: an empty answer there means the tailnet is up
 * and does not know the peer, which is a different mistake from Tailscale being
 * down.
 */
function explainMiss(state: TailscaleState, peer: string): string {
  if (state.availability === "running") {
    const count = state.peers.length;
    const known = `${count} peer${count === 1 ? "" : "s"}`;
    return `the tailnet is up and lists ${known}, but none is named "${peer}" and no LAN address resolved for it`;
  }
  const reason = state.error ?? `tailscale is ${state.availability}`;
  return `no tailnet address is known for it (${reason}) and no LAN address resolved`;
}

/**
 * Resolve a peer name to the addresses to try, tailnet first and LAN second.
 *
 * Throws when nothing resolves, with a message that names the peer and the
 * reason: an empty list here would turn "I typo'd the hostname" into "the network
 * is broken" two layers up. A tailnet peer that is currently offline still
 * yields its address — the route list is not a liveness check, `dial` decides.
 */
export async function findPeers(
  peer: string,
  options: FindPeersOptions = {},
): Promise<AddressCandidate[]> {
  const name = peer.trim();
  if (name === "") throw new Error("cannot find a peer with an empty name");

  const logger = options.logger ?? silentLogger;
  const detector = options.tailscale ?? new Tailscale({ logger });

  const candidates = await detector.addressCandidates(name, options.lan === undefined ? {} : { lan: options.lan });
  if (candidates.length > 0) {
    const first = candidates[0];
    logger.debug(
      `discovery: peer "${name}" -> ${candidates.length} route${candidates.length === 1 ? "" : "s"}, first ${first?.kind ?? "unknown"} ${first?.address ?? ""}`,
    );
    return candidates;
  }

  const state = await detector.status();
  throw new Error(`cannot find peer "${name}": ${explainMiss(state, name)}. ${fixFor(state)}`);
}
