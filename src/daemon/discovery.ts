/**
 * Peers vinden via Tailscale.
 *
 * Elke Roan luistert op de peer-poort. In plaats van een invite-code te plakken
 * vraagt de daemon aan Tailscale wie er in het netwerk zitten, probeert de
 * peer-poort op elk adres en koppelt wat antwoordt. Zo komen vier machines
 * vanzelf aan elkaar, ook na een herstart of een nieuw IP.
 *
 * Tailscale is de bron van adressen, niet de beveiliging: de handshake weigert
 * nog steeds elke peer met een verkeerd token of een andere keten.
 */

import { execFile } from "node:child_process";
import { connect } from "node:net";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Hoe vaak de lijst opnieuw wordt gelezen. */
const DEFAULT_INTERVAL_MS = 20_000;
/** Een adres dat niet binnen deze tijd antwoordt, draait geen daemon. */
const PROBE_TIMEOUT_MS = 700;

export interface DiscoveryOptions {
  /** Poort waarop elke peer luistert. */
  readonly port: number;
  /** Aangeroepen voor elk adres dat antwoordt en nog niet bekend is. */
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
 * Waar de Tailscale-CLI staat.
 *
 * De server draait Tailscale in Docker (de host heeft alleen `tailscale0`), dus
 * naast een gewoon `tailscale`-commando proberen we de container. Wie het ergens
 * anders heeft staan zet `ROAN_TAILSCALE_BIN` of `ROAN_TAILSCALE_CONTAINER`.
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
    if (address.includes(".")) return address; // IPv4; IPv6 laten we aan Tailscale
  }
  return null;
}

/**
 * Alle IPv4-adressen in de tailnet behalve dit device.
 *
 * `tailscale status --json` is de enige bron die "online" weet; apparaten die
 * uit staan slaan we over zodat we niet elke ronde in een timeout lopen.
 */
export async function tailscaleHosts(): Promise<{ self: string | null; hosts: string[] }> {
  let parsed: TailscaleStatus | null = null;
  for (const command of tailscaleCommands()) {
    try {
      const { stdout } = await execFileAsync(command.bin, [...command.args, "status", "--json"], { timeout: 5_000 });
      parsed = JSON.parse(stdout) as TailscaleStatus;
      break;
    } catch {
      // Volgende kandidaat: geen CLI, of de daemon draait daar niet.
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

/** Doet een korte TCP-poging: antwoordt er niets, dan draait daar geen daemon. */
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
 * Start de ronde. Elke bekende host wordt één keer aangeboden; daarna is het aan
 * de replicatie om de link levend te houden.
 */
export function startDiscovery(options: DiscoveryOptions): () => void {
  const interval = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const offered = new Set<string>();
  let stopped = false;

  const round = async (): Promise<void> => {
    if (stopped) return;
    const { self, hosts } = await tailscaleHosts();
    if (self === null && hosts.length === 0) {
      options.logger?.info("discovery: Tailscale gaf geen adressen");
      return;
    }
    for (const host of hosts) {
      if (stopped) return;
      if (offered.has(host)) continue;
      if (await probe(host, options.port)) {
        offered.add(host);
        options.onCandidate(host);
        options.logger?.info("discovery: peer gevonden", { host });
      }
    }
  };

  // Eerste ronde met een korte vertraging: de peer-server moet eerst luisteren.
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
