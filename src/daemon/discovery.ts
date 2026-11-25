/**
 * Finding peers via Tailscale.
 *
 * Every Roan listens on the peer port. Instead of pasting an invite code the
 * daemon asks Tailscale who is on the network, probes the peer port on every
 * address and links whatever answers. That way four machines find each other
 * by themselves, also after a restart or a new IP.
 *
 * Tailscale is the source of addresses, not the security: the handshake still
 * refuses every peer with a wrong token or a different chain.
 */

import { execFile } from "node:child_process";
import { connect } from "node:net";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** How often the list is read again. */
const DEFAULT_INTERVAL_MS = 20_000;
/** An address that does not answer within this time runs no daemon. */
const PROBE_TIMEOUT_MS = 700;

export interface DiscoveryOptions {
  /** Port every peer listens on. */
  readonly port: number;
  /** Called for every address that answers and is not known yet. */
  readonly onCandidate: (host: string) => void;
  readonly intervalMs?: number;
  readonly logger?: { info: (message: string, meta?: Record<string, unknown>) => void };
}

interface TailscaleStatus {
  readonly Self?: { readonly TailscaleIPs?: readonly string[] };
  readonly Peer?: Record<
    string,
    {
      readonly TailscaleIPs?: readonly string[];
      readonly Online?: boolean;
      readonly OS?: string;
    }
  >;
}

/**
 * Where the Tailscale CLI lives.
 *
 * The server runs Tailscale in Docker (the host only has `tailscale0`), so
 * besides a plain `tailscale` command we try the container. Anyone who has it
 * somewhere else sets `ROAN_TAILSCALE_BIN` or `ROAN_TAILSCALE_CONTAINER`.
 */
function tailscaleCommands(): Array<{ bin: string; args: string[] }> {
  const eigen = process.env["ROAN_TAILSCALE_BIN"];
  if (eigen !== undefined && eigen !== "") return [{ bin: eigen, args: [] }];
  const container = process.env["ROAN_TAILSCALE_CONTAINER"] ?? "tailscale-tailscale-1";
  return [
    { bin: "tailscale", args: [] },
    { bin: "docker", args: ["exec", container, "tailscale"] },
  ];
}

function firstV4(addresses: readonly string[] | undefined): string | null {
  if (!addresses) return null;
  for (const address of addresses) {
    if (address.includes(".")) return address; // IPv4; IPv6 we leave to Tailscale
  }
  return null;
}

/**
 * All IPv4 addresses in the tailnet except this device.
 *
 * `tailscale status --json` is the only source that knows "online"; devices
 * that are off we skip so we do not hit a timeout every round.
 */
export async function tailscaleHosts(): Promise<{ self: string | null; hosts: string[] }> {
  let parsed: TailscaleStatus | null = null;
  for (const command of tailscaleCommands()) {
    try {
      const { stdout } = await execFileAsync(command.bin, [...command.args, "status", "--json"], { timeout: 5_000 });
      parsed = JSON.parse(stdout) as TailscaleStatus;
      break;
    } catch {
      // Next candidate: no CLI, or no daemon running there.
    }
  }
  if (parsed === null) return { self: null, hosts: [] };

  const self = firstV4(parsed.Self?.TailscaleIPs);
  const hosts = new Set<string>();
  for (const peer of Object.values(parsed.Peer ?? {})) {
    if (peer.Online === false) continue;
    const address = firstV4(peer.TailscaleIPs);
    if (address !== null && address !== self) hosts.add(address);
  }
  return { self, hosts: [...hosts].sort() };
}

/** Does a short TCP attempt: if nothing answers, no daemon runs there. */
export function probe(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (answer: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(answer);
    };
    socket.setTimeout(PROBE_TIMEOUT_MS, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

/**
 * Starts the round. Every known host is offered once; after that it is up to
 * replication to keep the link alive.
 */
export function startDiscovery(options: DiscoveryOptions): () => void {
  const interval = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const offered = new Set<string>();
  let stopped = false;

  const round = async (): Promise<void> => {
    if (stopped) return;
    const { self, hosts } = await tailscaleHosts();
    if (self === null && hosts.length === 0) {
      options.logger?.info("discovery: Tailscale returned no addresses");
      return;
    }
    for (const host of hosts) {
      if (stopped) return;
      if (offered.has(host)) continue;
      if (await probe(host, options.port)) {
        offered.add(host);
        options.onCandidate(host);
        options.logger?.info("discovery: peer found", { host });
      }
    }
  };

  // First round after a short delay: the peer-server has to be listening first.
  const first = setTimeout(() => void round().catch(() => undefined), 3_000);
  first.unref();
  const timer = setInterval(() => void round().catch(() => undefined), interval);
  timer.unref();

  return () => {
    stopped = true;
    clearTimeout(first);
    clearInterval(timer);
  };
}
