import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { WebSocket } from "ws";
import { encodeFrame, type Frame } from "./protocol.js";
import type { Logger } from "./logger.js";

export interface Peer {
  readonly id: string;
  /** Remote node name, known once hello has been validated. */
  readonly node: string;
  readonly haveSeq: number;
  readonly remoteAddress: string | undefined;
  /** False when the socket is closed or its send buffer is full. */
  send(frame: Frame): boolean;
  close(code?: number, reason?: string): void;
}

export function closeReason(reason: string): string {
  return reason.length > 120 ? `${reason.slice(0, 117)}...` : reason;
}

/** Constant-time token comparison. Length mismatch is a mismatch. */
export function tokenMatches(presented: string | null, expected: string): boolean {
  if (presented === null) return false;
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Token from either the `Authorization: Bearer` header (native clients) or a
 * `?token=` query parameter (browsers, which cannot set upgrade headers).
 */
export function presentedToken(request: IncomingMessage): string | null {
  const header = request.headers["authorization"];
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    return header.slice("Bearer ".length).trim();
  }
  const raw = request.url ?? "/";
  try {
    const url = new URL(raw, "http://localhost");
    return url.searchParams.get("token");
  } catch {
    return null;
  }
}

/** A validated peer. Everything sent through here is bounded. */
export class PeerConnection implements Peer {
  node = "";
  haveSeq = 0;

  constructor(
    readonly id: string,
    readonly remoteAddress: string | undefined,
    private readonly socket: WebSocket,
    private readonly logger: Logger,
    private readonly maxBufferedBytes: number,
  ) {}

  send(frame: Frame): boolean {
    if (this.socket.readyState !== WebSocket.OPEN) return false;
    if (this.socket.bufferedAmount > this.maxBufferedBytes) {
      this.logger.log(
        "warn",
        `peer ${this.id} (${this.node || "unknown"}) is not draining; dropped ${frame.t} frame`,
      );
      return false;
    }
    this.socket.send(encodeFrame(frame));
    return true;
  }

  close(code = 1000, reason = ""): void {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    this.socket.close(code, closeReason(reason));
  }
}
