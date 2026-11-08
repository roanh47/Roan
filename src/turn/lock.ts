import { SeqConflictError, TurnLockError } from "./errors.js";
import type {
  Event,
  TurnEventDraft,
  TurnLogger,
  TurnStore,
} from "./types.js";

export { SeqConflictError, TurnLockError } from "./errors.js";
export type { Event, TurnEventDraft, TurnLogger, TurnStore } from "./types.js";

/** A turn silent for this long may be reclaimed by another node. */
export const DEFAULT_TURN_TTL_MS = 5 * 60_000;

/** How many trailing events are inspected by default. */
export const DEFAULT_TAIL_SIZE = 1_000;

const DEFAULT_MAX_ATTEMPTS = 3;

export interface DeriveTurnStateOptions {
  /** Wall clock used for expiry; defaults to `Date.now()` when `ttlMs` is set. */
  readonly now?: number;
  /** Silence after which the turn is considered abandoned. Omit to never expire. */
  readonly ttlMs?: number;
}

/**
 * A turn that is genuinely open always has an owner and timestamps, so the
 * open case is a separate member instead of a bag of optional fields.
 */
export type TurnState =
  | {
      readonly open: true;
      readonly owner: string;
      readonly startedAt: number;
      readonly lastActivityAt: number;
      readonly expired?: false;
    }
  | {
      readonly open: false;
      /** Present when a turn existed but ended or expired. */
      readonly owner?: string;
      readonly startedAt?: number;
      readonly lastActivityAt?: number;
      /** True when a turn was structurally open but has gone silent past `ttlMs`. */
      readonly expired?: boolean;
    };

export interface AcquireOptions extends DeriveTurnStateOptions {
  readonly tailSize?: number;
  readonly maxAttempts?: number;
  readonly logger?: TurnLogger;
}

export type AcquireResult =
  | { readonly state: "granted"; readonly event: Event }
  | {
      readonly state: "busy";
      readonly owner: string;
      readonly startedAt: number;
      readonly lastActivityAt: number;
      readonly expiresAt: number;
    };

export interface ReleaseOptions {
  readonly ttlMs?: number;
  readonly now?: number;
  readonly tailSize?: number;
  readonly logger?: TurnLogger;
}

interface OpenTurn {
  readonly owner: string;
  readonly startedAt: number;
  lastActivityAt: number;
}

/**
 * Pure fold over a chain tail. No clock is consulted unless `ttlMs` is given,
 * so the structural result is deterministic and testable without a store.
 *
 * Rules, in seq order:
 *  - `turn_start` opens a new turn for its sender (a later start supersedes an
 *    earlier one; that is how an expired turn is reclaimed).
 *  - `turn_end` closes the turn only when sent by the current owner. A foreign
 *    end is ignored, so a stray event cannot release someone else's lock.
 *  - Any other event from the owner counts as activity; other events do not.
 */
export function deriveTurnState(
  events: readonly Event[],
  options: DeriveTurnStateOptions = {},
): TurnState {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  let turn: OpenTurn | undefined;

  for (const event of ordered) {
    validateEvent(event);

    if (event.type === "turn_start") {
      turn = {
        owner: event.node,
        startedAt: event.ts,
        lastActivityAt: event.ts,
      };
      continue;
    }

    if (turn === undefined) continue;
    if (event.type === "turn_end") {
      if (event.node === turn.owner) turn = undefined;
      continue;
    }
    if (event.node === turn.owner) {
      turn.lastActivityAt = Math.max(turn.lastActivityAt, event.ts);
    }
  }

  if (turn === undefined) return { open: false };

  const ttlMs = options.ttlMs;
  if (ttlMs !== undefined) {
    const now = options.now ?? Date.now();
    if (now - turn.lastActivityAt >= ttlMs) {
      return {
        open: false,
        expired: true,
        owner: turn.owner,
        startedAt: turn.startedAt,
        lastActivityAt: turn.lastActivityAt,
      };
    }
  }

  return {
    open: true,
    owner: turn.owner,
    startedAt: turn.startedAt,
    lastActivityAt: turn.lastActivityAt,
  };
}

/**
 * Open a turn for `node`, or report who holds it.
 *
 * Reads the tail, derives the state, and only then compare-appends a
 * `turn_start` at the next free seq. If another node won that seq in between,
 * the store raises `SeqConflictError`, the tail is re-read, and the loser sees
 * `busy` instead of a second turn.
 *
 * An open turn with no owner activity for `ttlMs` is treated as abandoned: the
 * new `turn_start` supersedes it. Whether the old owner is still alive is
 * unknowable without a network round-trip, so expiry is the explicit policy.
 */
export async function acquire(
  store: TurnStore,
  chain: string,
  node: string,
  options: AcquireOptions = {},
): Promise<AcquireResult> {
  assertName("chain", chain);
  assertName("node", node);

  const ttlMs = resolveTtl(options.ttlMs);
  const tailSize = resolveTailSize(options.tailSize);
  const maxAttempts = resolveAttempts(options.maxAttempts);
  const now = options.now ?? Date.now();
  const logger = options.logger;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const tail = await store.tail(chain, tailSize);
    assertTailBelongsToChain(tail, chain);

    const state = deriveTurnState(tail, { now, ttlMs });
    if (state.open) {
      log(logger, "warn", "turn busy", {
        chain,
        node,
        owner: state.owner,
        attempt,
      });
      return {
        state: "busy",
        owner: state.owner,
        startedAt: state.startedAt,
        lastActivityAt: state.lastActivityAt,
        expiresAt: state.lastActivityAt + ttlMs,
      };
    }

    if (state.expired) {
      log(logger, "warn", "reclaiming expired turn", {
        chain,
        node,
        previousOwner: state.owner,
        startedAt: state.startedAt,
        lastActivityAt: state.lastActivityAt,
        ttlMs,
      });
    }

    const draft: TurnEventDraft = {
      node,
      type: "turn_start",
      data: { ttlMs },
    };

    try {
      const event = await store.append(chain, nextSeq(tail), draft);
      log(logger, "debug", "turn granted", { chain, node, seq: event.seq });
      return { state: "granted", event };
    } catch (error) {
      if (isSeqConflict(error) && attempt < maxAttempts) {
        log(logger, "debug", "turn_start race, retrying", {
          chain,
          node,
          attempt,
        });
        continue;
      }
      if (isSeqConflict(error)) {
        throw new TurnLockError(
          "append-conflict",
          `could not open a turn on chain "${chain}" for node "${node}" after ${maxAttempts} attempts: the chain head kept moving`,
          { cause: error },
        );
      }
      throw error;
    }
  }

  // The loop either returns or throws; this satisfies the compiler.
  throw new TurnLockError(
    "append-conflict",
    `could not open a turn on chain "${chain}" for node "${node}"`,
  );
}

/**
 * Close the turn for `node`. Only its owner may do so; anyone else gets a
 * `TurnLockError` and the chain is left untouched.
 *
 * An owner whose turn already expired may still close it, as long as nobody
 * has reclaimed it — that is tidier history, not a privilege.
 */
export async function release(
  store: TurnStore,
  chain: string,
  node: string,
  options: ReleaseOptions = {},
): Promise<Event> {
  assertName("chain", chain);
  assertName("node", node);

  const ttlMs = resolveTtl(options.ttlMs);
  const now = options.now ?? Date.now();
  const tail = await store.tail(chain, resolveTailSize(options.tailSize));
  assertTailBelongsToChain(tail, chain);

  const state = deriveTurnState(tail, { now, ttlMs });
  if (!state.open && !state.expired) {
    throw new TurnLockError(
      "no-open-turn",
      `node "${node}" cannot release chain "${chain}": no turn is open`,
    );
  }
  if (state.owner !== node) {
    throw new TurnLockError(
      "not-turn-owner",
      `node "${node}" cannot release chain "${chain}": the turn belongs to "${
        state.owner ?? "unknown"
      }"`,
    );
  }

  const draft: TurnEventDraft = {
    node,
    type: "turn_end",
    data: { reason: "released" },
  };
  const event = await store.append(chain, nextSeq(tail), draft);
  log(options.logger, "debug", "turn released", { chain, node, seq: event.seq });
  return event;
}

/** True when an open turn has been silent for `ttlMs` at `now`. */
export function isTurnExpired(
  state: TurnState,
  now: number,
  ttlMs: number,
): boolean {
  if (state.expired === true) return true;
  if (!state.open || state.lastActivityAt === undefined) return false;
  return now - state.lastActivityAt >= ttlMs;
}

function nextSeq(events: readonly Event[]): number {
  let head = 0;
  for (const event of events) {
    if (event.seq > head) head = event.seq;
  }
  return head + 1;
}

function assertName(field: string, value: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TurnLockError(
      "invalid-argument",
      `${field} must be a non-empty string, got ${JSON.stringify(value)}`,
    );
  }
}

function assertTailBelongsToChain(
  events: readonly Event[],
  chain: string,
): void {
  for (const event of events) {
    if (event.chain !== chain) {
      throw new TurnLockError(
        "wrong-chain",
        `store returned an event for chain "${event.chain}" while reading "${chain}"`,
      );
    }
  }
}

function validateEvent(event: Event): void {
  if (event.v !== 1) {
    throw new TurnLockError(
      "bad-event",
      `unsupported event version ${String(event.v)} at seq ${String(event.seq)}`,
    );
  }
  if (!Number.isInteger(event.seq) || event.seq < 1) {
    throw new TurnLockError(
      "bad-event",
      `event seq must be a positive integer, got ${String(event.seq)}`,
    );
  }
  if (!Number.isFinite(event.ts)) {
    throw new TurnLockError(
      "bad-event",
      `event ts must be finite at seq ${event.seq}, got ${String(event.ts)}`,
    );
  }
  if (typeof event.node !== "string" || event.node === "") {
    throw new TurnLockError(
      "bad-event",
      `event node must be a non-empty string at seq ${event.seq}`,
    );
  }
}

function resolveTtl(ttlMs: number | undefined): number {
  const value = ttlMs ?? DEFAULT_TURN_TTL_MS;
  if (!Number.isFinite(value) || value <= 0) {
    throw new TurnLockError(
      "invalid-argument",
      `ttlMs must be a positive finite number, got ${String(value)}`,
    );
  }
  return value;
}

function resolveTailSize(tailSize: number | undefined): number {
  const value = tailSize ?? DEFAULT_TAIL_SIZE;
  if (!Number.isInteger(value) || value < 1) {
    throw new TurnLockError(
      "invalid-argument",
      `tailSize must be a positive integer, got ${String(value)}`,
    );
  }
  return value;
}

function resolveAttempts(attempts: number | undefined): number {
  const value = attempts ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isInteger(value) || value < 1) {
    throw new TurnLockError(
      "invalid-argument",
      `maxAttempts must be a positive integer, got ${String(value)}`,
    );
  }
  return value;
}

function isSeqConflict(error: unknown): error is SeqConflictError {
  return error instanceof SeqConflictError;
}

function log(
  logger: TurnLogger | undefined,
  level: "debug" | "warn",
  message: string,
  fields?: Readonly<Record<string, unknown>>,
): void {
  const write = logger?.[level];
  if (write !== undefined) write.call(logger, message, fields);
}
