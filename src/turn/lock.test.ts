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
 * Regel onder test: één schrijver per beurt ("one writer per turn").
 *
 * De lock is in-process testbaar: alles hangt aan een `TurnStore`, dus een
 * eigen in-memory store volstaat en er is geen temp-pad of tweede proces
 * nodig. Elke test maakt een verse store, zodat ketens niet lekken.
 *
 * Let op: een tweede `acquire` gooit niets. `acquire` levert een resultaat
 * (`state: "busy"`), pas `release` door een niet-eigenaar gooit `TurnLockError`.
 * De tests hieronder volgen dat gedrag, niet een aangenomen throw.
 */

const CHAIN = "chain-1";
const HOLDER = "node-a";
const OTHER = "node-b";
const T0 = 1_700_000_000_000;

/** In-memory `TurnStore` met atomische compare-and-append per keten. */
class MemoryStore implements TurnStore {
  readonly #chains = new Map<string, Event[]>();
  #appends = 0;

  /** Aantal geaccepteerde appends; handig om "geen schrijfactie" te bewijzen. */
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
      // Zelfde contract als de echte store: de lock herkent dit via
      // `instanceof SeqConflictError`, dus het moet de echte klasse zijn.
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
  assert.fail("verwachtte een rejection, maar de promise resolvde");
}

describe("turn lock: one writer per turn", () => {
  it("geeft de eerste acquire en meldt de houder die hij kreeg", async () => {
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

  it("weigert een tweede acquire zolang de beurt gehouden wordt", async () => {
    const store = new MemoryStore();
    const logs: CapturedLog[] = [];

    const first = await acquire(store, CHAIN, HOLDER, { now: T0 });
    assert.equal(first.state, "granted");

    const second = await acquire(store, CHAIN, OTHER, {
      now: T0 + 10,
      logger: capturingLogger(logs),
    });

    // De module gooit hier niet: hij rapporteert `busy` met de bestaande houder.
    assert.equal(second.state, "busy");
    if (second.state !== "busy") assert.fail("unreachable");
    assert.equal(second.owner, HOLDER);
    assert.equal(typeof second.startedAt, "number");
    assert.equal(typeof second.lastActivityAt, "number");
    assert.ok(second.expiresAt > second.lastActivityAt);

    // Geen tweede `turn_start`: de verliezer heeft niets geschreven.
    assert.equal(store.appendCount, 1);
    assert.equal(store.events(CHAIN).length, 1);

    const busyLog = logs.find((entry) => entry.message === "turn busy");
    assert.ok(busyLog, `verwachtte een "turn busy"-log, kreeg ${JSON.stringify(logs)}`);
    assert.equal(busyLog.level, "warn");
    assert.equal(busyLog.fields?.["owner"], HOLDER);
  });

  it("laat opnieuw acquiren toe nadat de beurt is vrijgegeven", async () => {
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

  it("gooit bij een tweede release met code no-open-turn (geen stille tweede turn_end)", async () => {
    const store = new MemoryStore();

    await acquire(store, CHAIN, HOLDER, { now: T0 });
    await release(store, CHAIN, HOLDER, { now: T0 + 5 });

    // Vastgelegd gedrag: de module gooit hier wél, met code "no-open-turn".
    const error = await rejectionOf(release(store, CHAIN, HOLDER, { now: T0 + 6 }));

    assert.ok(
      isTurnLockError(error, "no-open-turn"),
      `verwachtte TurnLockError/ no-open-turn, kreeg ${String(error)}`,
    );
    assert.match(error.message, /no turn is open/);
    assert.equal(store.appendCount, 2);
    assert.equal(store.events(CHAIN).length, 2);
  });

  it("weigert een release door een andere node dan de houder", async () => {
    const store = new MemoryStore();

    await acquire(store, CHAIN, HOLDER, { now: T0 });

    const error = await rejectionOf(release(store, CHAIN, OTHER, { now: T0 + 5 }));

    assert.ok(
      isTurnLockError(error, "not-turn-owner"),
      `verwachtte TurnLockError/ not-turn-owner, kreeg ${String(error)}`,
    );
    // De melding noemt de echte eigenaar, niet de indringer.
    assert.match(error.message, new RegExp(`"${HOLDER}"`));

    // De lock bleef staan: geen `turn_end`, de houder kan nog vrijgeven.
    assert.equal(store.events(CHAIN).length, 1);

    const stillBusy = await acquire(store, CHAIN, OTHER, { now: T0 + 6 });
    assert.equal(stillBusy.state, "busy");

    const released = await release(store, CHAIN, HOLDER, { now: T0 + 7 });
    assert.equal(released.node, HOLDER);
    assert.equal(released.seq, 2);
  });
});
