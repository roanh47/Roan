import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SeqConflictError, TurnLockError } from "./errors.js";
import {
  acquire,
  release,
  type Event,
  type TurnEventDraft,
  type TurnLogger,
  type TurnStore,
} from "./lock.js";

/**
 * Rule under test: one writer per turn.
 *
 * The lock is testable in-process: everything hangs off a `TurnStore`, so a
 * local in-memory store suffices and no temp path or second process is
 * needed. Every test builds a fresh store so chains do not leak.
 *
 * Note: a second `acquire` throws nothing. `acquire` returns a result
 * (`state: "busy"`); only a `release` by a non-owner throws `TurnLockError`.
 * The tests below follow that behaviour, not an assumed throw.
 */

const CHAIN = "chain-1";
const HOLDER = "node-a";
const OTHER = "node-b";
const T0 = 1_700_000_000_000;

/** In-memory `TurnStore` with atomic compare-and-append per chain. */
class MemoryStore implements TurnStore {
  readonly #chains = new Map<string, Event[]>();
  #appends = 0;

  /** Number of accepted appends; useful to prove "no write happened". */
  get appendCount(): number {
    return this.#appends;
  }

  events(chain: string): readonly Event[] {
    return this.#chains.get(chain) ?? [];
  }

  tail(chain: string, limit: number): readonly Event[] {
    const list = this.#chains.get(chain) ?? [];
    return list.slice(Math.max(0, list.length - limit));
  }

  append(
    chain: string,
    expectedSeq: number,
    draft: TurnEventDraft,
  ): Event {
    const list = this.#chains.get(chain) ?? [];
    const head = list.at(-1)?.seq ?? 0;
    if (expectedSeq !== head + 1) {
      // Same contract as the real store: the lock recognises this via
      // `instanceof SeqConflictError`, so it must be the real class.
      throw new SeqConflictError(expectedSeq, head + 1);
    }

    const event: Event = {
      v: 1,
      chain,
      seq: expectedSeq,
      id: `${chain}-${expectedSeq}`,
      node: draft.node,
      ts: T0 + expectedSeq,
      type: draft.type,
      data: draft.data,
    };
    this.#chains.set(chain, [...list, event]);
    this.#appends += 1;
    return event;
  }
}

interface CapturedLog {
  readonly level: "debug" | "warn";
  readonly message: string;
  readonly fields: Readonly<Record<string, unknown>> | undefined;
}

function capturingLogger(sink: CapturedLog[]): TurnLogger {
  return {
    debug(message, fields) {
      sink.push({ level: "debug", message, fields });
    },
    warn(message, fields) {
      sink.push({ level: "warn", message, fields });
    },
  };
}

function isTurnLockError(
  error: unknown,
  code: TurnLockError["code"],
): error is TurnLockError {
  return error instanceof TurnLockError && error.code === code;
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail("expected a rejection, but the promise resolved");
}

describe("turn lock: one writer per turn", () => {
  it("grants the first acquire and reports the holder it got", async () => {
    const store = new MemoryStore();

    const result = await acquire(store, CHAIN, HOLDER, { now: T0 });

    assert.equal(result.state, "granted");
    if (result.state !== "granted") assert.fail("unreachable");
    assert.equal(result.event.type, "turn_start");
    assert.equal(result.event.node, HOLDER);
    assert.equal(result.event.chain, CHAIN);
    assert.equal(result.event.seq, 1);
    assert.equal(store.appendCount, 1);
  });

  it("refuses a second acquire while the turn is held", async () => {
    const store = new MemoryStore();
    const logs: CapturedLog[] = [];

    const first = await acquire(store, CHAIN, HOLDER, { now: T0 });
    assert.equal(first.state, "granted");

    const second = await acquire(store, CHAIN, OTHER, {
      now: T0 + 10,
      logger: capturingLogger(logs),
    });

    // The module does not throw here: it reports `busy` with the existing holder.
    assert.equal(second.state, "busy");
    if (second.state !== "busy") assert.fail("unreachable");
    assert.equal(second.owner, HOLDER);
    assert.equal(typeof second.startedAt, "number");
    assert.equal(typeof second.lastActivityAt, "number");
    assert.ok(second.expiresAt > second.lastActivityAt);

    // No second `turn_start`: the loser wrote nothing.
    assert.equal(store.appendCount, 1);
    assert.equal(store.events(CHAIN).length, 1);

    const busyLog = logs.find((entry) => entry.message === "turn busy");
    assert.ok(busyLog, `expected a "turn busy" log, got ${JSON.stringify(logs)}`);
    assert.equal(busyLog.level, "warn");
    assert.equal(busyLog.fields?.["owner"], HOLDER);
  });

  it("allows acquiring again after the turn is released", async () => {
    const store = new MemoryStore();

    await acquire(store, CHAIN, HOLDER, { now: T0 });
    const released = await release(store, CHAIN, HOLDER, { now: T0 + 5 });

    assert.equal(released.type, "turn_end");
    assert.equal(released.node, HOLDER);
    assert.equal(released.seq, 2);

    const again = await acquire(store, CHAIN, OTHER, { now: T0 + 10 });

    assert.equal(again.state, "granted");
    if (again.state !== "granted") assert.fail("unreachable");
    assert.equal(again.event.node, OTHER);
    assert.equal(again.event.seq, 3);
  });

  it("throws on a second release with code no-open-turn (no silent second turn_end)", async () => {
    const store = new MemoryStore();

    await acquire(store, CHAIN, HOLDER, { now: T0 });
    await release(store, CHAIN, HOLDER, { now: T0 + 5 });

    // Pinned behaviour: the module does throw here, with code "no-open-turn".
    const error = await rejectionOf(release(store, CHAIN, HOLDER, { now: T0 + 6 }));

    assert.ok(
      isTurnLockError(error, "no-open-turn"),
      `expected TurnLockError/ no-open-turn, got ${String(error)}`,
    );
    assert.match(error.message, /no turn is open/);
    assert.equal(store.appendCount, 2);
    assert.equal(store.events(CHAIN).length, 2);
  });

  it("refuses a release by a node other than the holder", async () => {
    const store = new MemoryStore();

    await acquire(store, CHAIN, HOLDER, { now: T0 });

    const error = await rejectionOf(release(store, CHAIN, OTHER, { now: T0 + 5 }));

    assert.ok(
      isTurnLockError(error, "not-turn-owner"),
      `expected TurnLockError/ not-turn-owner, got ${String(error)}`,
    );
    // The message names the real owner, not the intruder.
    assert.match(error.message, new RegExp(`"${HOLDER}"`));

    // The lock stayed: no `turn_end`, the holder can still release.
    assert.equal(store.events(CHAIN).length, 1);

    const stillBusy = await acquire(store, CHAIN, OTHER, { now: T0 + 6 });
    assert.equal(stillBusy.state, "busy");

    const released = await release(store, CHAIN, HOLDER, { now: T0 + 7 });
    assert.equal(released.node, HOLDER);
    assert.equal(released.seq, 2);
  });
});
