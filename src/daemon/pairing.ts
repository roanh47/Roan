/**
 * The join handshake for a machine that adopts an existing chain.
 *
 * The joining node never pushes anything: it presents the token from the invite,
 * asks for the chain from `haveSeq`, and applies every event it receives in seq
 * order. Joining adopts (AGENTS.md rule 9), so the store it writes into is the
 * fresh local one — the caller parks local data before calling here.
 *
 * Two halves live in this file because they must agree on one wire contract:
 * - `authorizeJoin` is what the peer server runs before it sends anything.
 * - `joinChain` is what the joining daemon runs against that server.
 *
 * Tokens are compared in constant time and never appear in an error message; a
 * refusal names the chain and the reason code, not what was presented.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import type { AppendOutcome, Event, NodeStore } from "../sync/types.js";

/** Everything that can go wrong, as a code a caller can branch on. */
export type PairingErrorCode =
  | "bad-frame"
  | "token-mismatch"
  | "chain-mismatch"
  | "version-mismatch"
  | "out-of-order"
  | "conflict"
  | "refused"
  | "closed"
  | "timeout";

export class PairingError extends Error {
  constructor(
    readonly code: PairingErrorCode,
    message: string,
    /** The seq that caused the failure, when there is one. */
    readonly seq?: number,
  ) {
    super(message);
    this.name = "PairingError";
  }
}

/** What a successful join hands back to the daemon. */
export interface JoinReport {
  /** Chain id the joiner now belongs to. */
  readonly chain: string;
  /** Highest seq in the local store after applying. */
  readonly head: number;
  /** Events actually written by this join (already-present events excluded). */
  readonly applied: number;
}

/** The joining node asks to be let in. */
export interface JoinRequestFrame {
  readonly t: "join";
  readonly v: 1;
  readonly chain: string;
  readonly node: string;
  /** The invite token. Only ever crosses the wire, never a log line. */
  readonly token: string;
  /** Highest seq the joiner already has; 0 for a fresh machine. */
  readonly haveSeq: number;
}

export interface JoinAcceptedFrame {
  readonly t: "joined";
  readonly v: 1;
  readonly chain: string;
  readonly node: string;
  /** Highest seq the server holds; the events frames follow. */
  readonly head: number;
}

export interface JoinRefusedFrame {
  readonly t: "join_refused";
  readonly v: 1;
  readonly code: PairingErrorCode;
  readonly message: string;
}

export interface JoinEventsFrame {
  readonly t: "events";
  readonly events: readonly Event[];
}

export interface JoinDoneFrame {
  readonly t: "join_done";
  readonly v: 1;
  readonly head: number;
}

export type JoinFrame =
  | JoinRequestFrame
  | JoinAcceptedFrame
  | JoinRefusedFrame
  | JoinEventsFrame
  | JoinDoneFrame;

/** The minimum a join needs from a socket; `ws-transport` is not reused because
 *  this handshake happens before replication owns the connection. */
export interface PairingChannel {
  send(text: string): void;
  onMessage(handler: (raw: string) => void): void;
  onClose(handler: (reason?: string) => void): void;
  close(reason?: string): void;
}

/**
 * Constant-time token comparison.
 *
 * Both sides are hashed first so a length difference cannot be timed, and an
 * empty expected token never matches: a server with no token must not accept
 * everyone.
 */
export function verifyToken(presented: string, expected: string): boolean {
  if (typeof presented !== "string" || typeof expected !== "string" || expected.length === 0) {
    return false;
  }
  const a = createHash("sha256").update(presented, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEvent(value: unknown): value is Event {
  if (!isRecord(value)) return false;
  const { v, chain, seq, id, node, ts, type } = value;
  return (
    v === 1 &&
    typeof chain === "string" &&
    chain.length > 0 &&
    typeof seq === "number" &&
    Number.isSafeInteger(seq) &&
    seq >= 1 &&
    typeof id === "string" &&
    id.length > 0 &&
    typeof node === "string" &&
    node.length > 0 &&
    typeof ts === "number" &&
    Number.isSafeInteger(ts) &&
    typeof type === "string" &&
    type.length > 0
  );
}

/**
 * Parse one join frame. Throws `bad-frame` with the problem named; nothing is
 * coerced, so a malformed frame stops the handshake instead of being skipped.
 */
export function parseJoinFrame(raw: string): JoinFrame {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new PairingError("bad-frame", "join frame is not valid JSON");
  }
  if (!isRecord(value)) throw new PairingError("bad-frame", "join frame is not an object");

  const t = value["t"];
  if (t === "join") {
    if (value["v"] !== 1) throw new PairingError("version-mismatch", "join request has an unknown version");
    const chain = value["chain"];
    const node = value["node"];
    const token = value["token"];
    const haveSeq = value["haveSeq"];
    if (typeof chain !== "string" || chain.length === 0) {
      throw new PairingError("bad-frame", "join request has no chain");
    }
    if (typeof node !== "string" || node.length === 0) {
      throw new PairingError("bad-frame", "join request has no node");
    }
    if (typeof token !== "string") throw new PairingError("bad-frame", "join request has no token");
    if (typeof haveSeq !== "number" || !Number.isSafeInteger(haveSeq) || haveSeq < 0) {
      throw new PairingError("bad-frame", "join request has no usable haveSeq");
    }
    return { t: "join", v: 1, chain, node, token, haveSeq };
  }

  if (t === "joined") {
    if (value["v"] !== 1) throw new PairingError("version-mismatch", "join answer has an unknown version");
    const chain = value["chain"];
    const node = value["node"];
    const head = value["head"];
    if (typeof chain !== "string" || typeof node !== "string") {
      throw new PairingError("bad-frame", "join answer has no chain or node");
    }
    if (typeof head !== "number" || !Number.isSafeInteger(head) || head < 0) {
      throw new PairingError("bad-frame", "join answer has no usable head");
    }
    return { t: "joined", v: 1, chain, node, head };
  }

  if (t === "join_refused") {
    const code = value["code"];
    const message = value["message"];
    const known: readonly PairingErrorCode[] = [
      "token-mismatch",
      "chain-mismatch",
      "version-mismatch",
      "refused",
    ];
    if (typeof code !== "string" || !known.includes(code as PairingErrorCode)) {
      throw new PairingError("bad-frame", "refusal has an unknown reason code");
    }
    return {
      t: "join_refused",
      v: 1,
      code: code as PairingErrorCode,
      message: typeof message === "string" ? message : "the peer refused the join",
    };
  }

  if (t === "events") {
    const events = value["events"];
    if (!Array.isArray(events)) throw new PairingError("bad-frame", "events frame has no list");
    const parsed: Event[] = [];
    for (const item of events) {
      if (!isEvent(item)) throw new PairingError("bad-frame", "events frame contains an invalid event");
      parsed.push(item);
    }
    return { t: "events", events: parsed };
  }

  if (t === "join_done") {
    if (value["v"] !== 1) throw new PairingError("version-mismatch", "join done frame has an unknown version");
    const head = value["head"];
    if (typeof head !== "number" || !Number.isSafeInteger(head) || head < 0) {
      throw new PairingError("bad-frame", "join done frame has no usable head");
    }
    return { t: "join_done", v: 1, head };
  }

  throw new PairingError("bad-frame", `unknown join frame type ${String(t)}`);
}

/**
 * Server-side gate: verify the request belongs to this chain and carries the
 * token. Returns the parsed request so the caller can answer `joined`.
 *
 * Refusal is a thrown `PairingError`; the message never contains either token.
 */
export function authorizeJoin(
  raw: string,
  expected: { readonly chain: string; readonly token: string },
): JoinRequestFrame {
  const frame = parseJoinFrame(raw);
  if (frame.t !== "join") {
    throw new PairingError("bad-frame", `expected a join request, got "${frame.t}"`);
  }
  if (frame.chain !== expected.chain) {
    throw new PairingError(
      "chain-mismatch",
      `join request is for chain "${frame.chain}", this node serves "${expected.chain}"`,
    );
  }
  if (!verifyToken(frame.token, expected.token)) {
    throw new PairingError("token-mismatch", `join request from ${frame.node} presented a wrong token`);
  }
  return frame;
}

/** One event applied during a join, or skipped because the store already had it. */
function applyOne(store: NodeStore, chain: string, event: Event, next: number): boolean {
  if (event.chain !== chain) {
    throw new PairingError(
      "chain-mismatch",
      `event ${event.id} belongs to chain "${event.chain}", not "${chain}"`,
      event.seq,
    );
  }
  if (event.v !== 1) {
    throw new PairingError(
      "version-mismatch",
      `event ${event.id} speaks protocol ${String(event.v)}`,
      event.seq,
    );
  }
  if (store.has(event.id)) return false;
  if (event.seq !== next) {
    throw new PairingError(
      "out-of-order",
      `expected seq ${next} from the peer, got ${event.seq} (${event.id})`,
      event.seq,
    );
  }

  const outcome: AppendOutcome = store.append(event);
  if (outcome.status === "appended") return true;
  if (outcome.status === "duplicate") return false;
  throw new PairingError(
    "conflict",
    `seq ${event.seq} already holds id ${outcome.existingId}, peer sent ${event.id}`,
    event.seq,
  );
}

/**
 * Apply a whole chain in order, from an empty (or partial) store.
 *
 * The order is not repaired: a gap, a repeat or a jump is an `out-of-order`
 * error that names the seq. Returns how many events this call wrote.
 */
export function applyJoinEvents(
  store: NodeStore,
  chain: string,
  events: readonly Event[],
): { applied: number; head: number } {
  let applied = 0;
  for (const event of events) {
    if (applyOne(store, chain, event, store.head() + 1)) applied += 1;
  }
  return { applied, head: store.head() };
}

export interface JoinOptions {
  /** Chain id from the invite. */
  readonly chain: string;
  /** Token from the invite. */
  readonly token: string;
  /** This machine's node id, so the peer can name it in logs. */
  readonly node: string;
  readonly store: NodeStore;
  readonly channel: PairingChannel;
  /** Give up after this long; default 30 s. */
  readonly timeoutMs?: number;
}

/**
 * Run the client half of the handshake over `channel`.
 *
 * Resolves only after the peer says `join_done` and every event before that head
 * has been applied; a connection that drops early is a rejection, never a
 * partial success. The token is sent once, in the first frame.
 */
export function joinChain(options: JoinOptions): Promise<JoinReport> {
  const { chain, token, node, store, channel } = options;
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new PairingError("timeout", `invalid join timeout: ${String(timeoutMs)}`));
  }
  if (store.chain !== chain) {
    return Promise.reject(
      new PairingError(
        "chain-mismatch",
        `local store holds chain "${store.chain}" but the invite is for "${chain}"`,
      ),
    );
  }

  return new Promise<JoinReport>((resolve, reject) => {
    let applied = 0;
    let expectedHead: number | null = null;
    let settled = false;

    const finish = (error?: PairingError): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        channel.close(error.code);
        reject(error);
        return;
      }
      channel.close("joined");
      resolve({ chain, head: store.head(), applied });
    };

    const timer = setTimeout(() => {
      finish(new PairingError("timeout", `join did not finish within ${timeoutMs} ms`));
    }, timeoutMs);
    timer.unref?.();

    channel.onClose((reason) => {
      if (settled) return;
      finish(new PairingError("closed", `peer closed the connection during join: ${reason ?? "no reason"}`));
    });

    channel.onMessage((raw) => {
      if (settled) return;
      let frame: JoinFrame;
      try {
        frame = parseJoinFrame(raw);
      } catch (err) {
        finish(err instanceof PairingError ? err : new PairingError("bad-frame", String(err)));
        return;
      }

      if (frame.t === "join_refused") {
        finish(new PairingError(frame.code, `peer refused the join: ${frame.message}`));
        return;
      }
      if (frame.t === "joined") {
        if (frame.chain !== chain) {
          finish(
            new PairingError(
              "chain-mismatch",
              `peer answered for chain "${frame.chain}", the invite is for "${chain}"`,
            ),
          );
          return;
        }
        expectedHead = frame.head;
        if (frame.head === 0) finish();
        return;
      }
      if (frame.t === "events") {
        try {
          applied += applyJoinEvents(store, chain, frame.events).applied;
        } catch (err) {
          finish(err instanceof PairingError ? err : new PairingError("conflict", String(err)));
          return;
        }
        if (expectedHead !== null && store.head() >= expectedHead) finish();
        return;
      }
      if (frame.t === "join_done") {
        if (store.head() < frame.head) {
          finish(
            new PairingError(
              "out-of-order",
              `peer finished at head ${frame.head} but only seq ${store.head()} arrived`,
              frame.head,
            ),
          );
          return;
        }
        finish();
        return;
      }
      finish(new PairingError("bad-frame", `unexpected join request on the client side: "${frame.t}"`));
    });

    const request: JoinRequestFrame = {
      t: "join",
      v: 1,
      chain,
      node,
      token,
      haveSeq: store.head(),
    };
    channel.send(JSON.stringify(request));
  });
}

/** The frames a peer server sends back, kept here so both halves agree. */
export function joinAccepted(chain: string, node: string, head: number): JoinAcceptedFrame {
  return { t: "joined", v: 1, chain, node, head };
}

export function joinRefused(code: PairingErrorCode, message: string): JoinRefusedFrame {
  return { t: "join_refused", v: 1, code, message };
}

export function joinDone(head: number): JoinDoneFrame {
  return { t: "join_done", v: 1, head };
}
