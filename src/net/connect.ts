/**
 * Dialing a peer over the best available route.
 *
 * The candidate list comes from `Tailscale.addressCandidates`, which puts the
 * tailnet address first. Each candidate gets a short, independent timeout: a
 * tailnet address that is offline must not eat the time budget of the LAN
 * fallback, and the connection that wins is reported so the caller can log which
 * route the nodes actually used.
 */

import net from "node:net";
import { silentLogger, Tailscale, type AddressCandidate, type Logger } from "./tailscale.js";

export interface ConnectTarget {
  address: string;
  port: number;
}

export type Connector = (
  target: ConnectTarget,
  timeoutMs: number,
  signal?: AbortSignal,
) => Promise<net.Socket>;

export interface DialAttempt {
  candidate: AddressCandidate;
  ok: boolean;
  elapsedMs: number;
  /** Null on success. Never contains credentials: this is a socket error. */
  error: string | null;
  /** OS error code such as `ECONNREFUSED`, when there was one. */
  code: string | null;
}

export interface DialResult {
  socket: net.Socket;
  peer: string;
  port: number;
  /** The route that won; `candidate.kind === "tailscale"` means the tailnet. */
  candidate: AddressCandidate;
  attempts: DialAttempt[];
}

export interface DialOptions {
  /** Per candidate. Default 2000ms. */
  timeoutMs?: number;
  signal?: AbortSignal;
  logger?: Logger;
  /** Reuse a detector (and its cached status) across dials. */
  tailscale?: Tailscale;
  /** Known LAN address; only used when the tailnet route is unavailable. */
  lan?: string;
  /** Pre-computed candidates, mostly for tests and for retries of a known peer. */
  candidates?: AddressCandidate[];
  /** Injectable socket factory, mostly for tests. */
  connect?: Connector;
}

const DEFAULT_DIAL_TIMEOUT_MS = 2000;

function assertPort(port: number, peer: string): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`cannot dial peer "${peer}": invalid port ${String(port)} (expected 1-65535)`);
  }
}

/** One TCP connection with its own timeout and abort handling. */
export const connectSocket: Connector = (target, timeoutMs, signal) => {
  return new Promise<net.Socket>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted before connecting"));
      return;
    }

    const socket = net.createConnection({ host: target.address, port: target.port });
    let settled = false;

    const finish = (error: Error | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      socket.removeListener("connect", onConnect);
      socket.removeListener("error", onError);
      if (error) {
        socket.destroy();
        reject(error);
      } else {
        socket.setNoDelay(true);
        resolve(socket);
      }
    };

    const onConnect = (): void => finish(null);
    const onError = (error: Error): void => finish(error);
    const onAbort = (): void => finish(new Error("aborted while connecting"));

    const timer = setTimeout(
      () => finish(new Error(`timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );

    socket.once("connect", onConnect);
    socket.once("error", onError);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
};

function errorCode(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return null;
}

function describeFailure(attempt: DialAttempt, port: number): string {
  return `${attempt.candidate.kind} ${attempt.candidate.address}:${port}: ${attempt.error ?? "unknown error"}`;
}

/**
 * Try the peer's routes in order and return the first socket that connects.
 * Fails with an error that names the peer and every route that was tried, so
 * "the server is down" is distinguishable from "Tailscale is not logged in".
 */
export async function dial(peer: string, port: number, options: DialOptions = {}): Promise<DialResult> {
  const name = peer.trim();
  if (name === "") throw new Error("cannot dial an empty peer name");
  assertPort(port, name);

  const logger = options.logger ?? silentLogger;
  const timeoutMs = options.timeoutMs ?? DEFAULT_DIAL_TIMEOUT_MS;
  const detector = options.tailscale ?? new Tailscale({ logger });

  const candidates =
    options.candidates ??
    (await detector.addressCandidates(name, options.lan === undefined ? {} : { lan: options.lan }));

  if (candidates.length === 0) {
    // Explain *why* there is no route, without pretending a tunnel exists.
    const state = await detector.status();
    const reason = state.error ?? "no tailnet or LAN address is known for it";
    const guidance =
      state.availability === "not-installed"
        ? "Tailscale is the preferred route and is not installed on this node."
        : state.availability === "needs-login" || state.availability === "not-running"
          ? "Tailscale is the preferred route and is not up; `tailscale up` on both nodes fixes this."
          : "Tailscale is the preferred route; check `tailscale status` for this peer.";
    throw new Error(
      `cannot reach peer "${name}" on port ${port}: no address to try (${reason}). ${guidance}`,
    );
  }

  const connect = options.connect ?? connectSocket;
  const attempts: DialAttempt[] = [];

  for (const candidate of candidates) {
    if (options.signal?.aborted) {
      throw new Error(`dial to peer "${name}" on port ${port} was aborted`);
    }

    const started = Date.now();
    try {
      const socket = await connect({ address: candidate.address, port }, timeoutMs, options.signal);
      const attempt: DialAttempt = {
        candidate,
        ok: true,
        elapsedMs: Date.now() - started,
        error: null,
        code: null,
      };
      attempts.push(attempt);
      logger.debug(
        `dial ${name}:${port} via ${candidate.kind} ${candidate.address} connected in ${attempt.elapsedMs}ms`,
      );
      return { socket, peer: name, port, candidate, attempts };
    } catch (error) {
      const attempt: DialAttempt = {
        candidate,
        ok: false,
        elapsedMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
        code: errorCode(error),
      };
      attempts.push(attempt);
      logger.warn(`dial ${name}:${port} via ${candidate.kind} ${candidate.address} failed: ${attempt.error}`);
    }
  }

  const tried = attempts.map((attempt) => describeFailure(attempt, port)).join("; ");
  const tailnetAttempt = attempts.find((attempt) => attempt.candidate.kind === "tailscale");
  const hint =
    tailnetAttempt === undefined
      ? " Tailscale is the preferred route but gave no address for this peer."
      : "";

  throw new Error(`cannot reach peer "${name}" on port ${port}: no route connected (${tried}).${hint}`);
}
