/**
 * Append-only event store for the Roan chain.
 *
 * One SQLite file holds every chain. Events are immutable: this module offers no
 * update and no delete. `seq` is assigned here, by the node that appends, and is
 * strictly increasing per chain starting at 1.
 *
 * Concurrency: `seq` allocation and the insert happen inside a single
 * `BEGIN IMMEDIATE` transaction, so two processes appending to the same chain
 * cannot hand out the same number. `(chain, seq)` is the primary key and
 * `(chain, id)` is unique, which makes an append with an id already present a
 * no-op that returns the stored event.
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  DatabaseSync,
  type SQLOutputValue,
  type StatementSync,
} from "node:sqlite";

// The protocol module (`src/protocol/types.ts`) is not in the tree yet; the task
// contract is mirrored here. When that module lands, this block should become
// `export type { Event, EventType } from "../protocol/types.js";`.
export type EventType =
  | "message"
  | "assistant"
  | "tool_call"
  | "tool_result"
  | "error"
  | "turn_start"
  | "turn_end"
  | "env";

export interface Event {
  v: 1;
  chain: string;
  seq: number;
  id: string;
  node: string;
  ts: number;
  type: EventType;
  data: unknown;
}

/** An event as handed to `append`: the store assigns `chain` (if absent) and `seq`. */
export interface NewEvent {
  v?: 1;
  chain?: string;
  id: string;
  node: string;
  ts?: number;
  type: EventType;
  data?: unknown;
}

export interface ChainSummary {
  chain: string;
  /** Number of events in the chain. */
  count: number;
  /** Highest seq in the chain. */
  head: number;
}

export class StoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreError";
  }
}

const EVENT_TYPES: ReadonlySet<string> = new Set<EventType>([
  "message",
  "assistant",
  "tool_call",
  "tool_result",
  "error",
  "turn_start",
  "turn_end",
  "env",
]);

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 10_000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  chain TEXT    NOT NULL,
  seq   INTEGER NOT NULL,
  id    TEXT    NOT NULL,
  node  TEXT    NOT NULL,
  ts    INTEGER NOT NULL,
  type  TEXT    NOT NULL,
  data  TEXT    NOT NULL,
  PRIMARY KEY (chain, seq),
  UNIQUE (chain, id)
) STRICT;
`;

interface EventRow {
  chain: string;
  seq: number;
  id: string;
  node: string;
  ts: number;
  type: string;
  data: string;
}

function asString(value: SQLOutputValue | undefined, field: string): string {
  if (typeof value !== "string") {
    throw new StoreError(`corrupt row: ${field} is not text`);
  }
  return value;
}

function asNumber(value: SQLOutputValue | undefined, field: string): number {
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return value;
  }
  // node:sqlite can return bigint for integers when readBigInts is enabled.
  if (typeof value === "bigint" && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(value);
  }
  throw new StoreError(`corrupt row: ${field} is not an integer`);
}

function toEvent(row: Record<string, SQLOutputValue>): Event {
  const type = asString(row["type"], "type");
  if (!EVENT_TYPES.has(type)) {
    throw new StoreError(`corrupt row: unknown event type ${type}`);
  }
  const raw = asString(row["data"], "data");
  let data: unknown;
  try {
    data = JSON.parse(raw) as unknown;
  } catch {
    throw new StoreError("corrupt row: data is not valid JSON");
  }
  return {
    v: 1,
    chain: asString(row["chain"], "chain"),
    seq: asNumber(row["seq"], "seq"),
    id: asString(row["id"], "id"),
    node: asString(row["node"], "node"),
    ts: asNumber(row["ts"], "ts"),
    type: type as EventType,
    data,
  };
}

function requireId(value: string, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new StoreError(`${field} must be a non-empty string`);
  }
  return value;
}

function normalizeNewEvent(chain: string, input: NewEvent): {
  id: string;
  node: string;
  ts: number;
  type: EventType;
  data: string;
} {
  requireId(chain, "chain");
  if (input === null || typeof input !== "object") {
    throw new StoreError("event must be an object");
  }
  if (input.v !== undefined && input.v !== 1) {
    throw new StoreError(`unsupported event version: ${String(input.v)}`);
  }
  if (input.chain !== undefined && input.chain !== chain) {
    throw new StoreError(
      `event chain ${JSON.stringify(input.chain)} does not match append chain ${JSON.stringify(chain)}`,
    );
  }
  const id = requireId(input.id, "event.id");
  const node = requireId(input.node, "event.node");
  if (!EVENT_TYPES.has(input.type)) {
    throw new StoreError(`unknown event type: ${String(input.type)}`);
  }
  const ts = input.ts ?? Date.now();
  if (!Number.isSafeInteger(ts) || ts < 0) {
    throw new StoreError("event.ts must be a non-negative integer");
  }
  const serialized = JSON.stringify(input.data ?? null);
  if (serialized === undefined) {
    throw new StoreError("event.data is not JSON-serializable");
  }
  return { id, node, ts, type: input.type, data: serialized };
}

/** Block the thread for `ms`; DatabaseSync has no async variant to await. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function journalMode(db: DatabaseSync): string {
  const row = db.prepare("PRAGMA journal_mode").get();
  const mode = row?.["journal_mode"];
  return typeof mode === "string" ? mode.toLowerCase() : "";
}

/**
 * Switch the file to WAL. Several processes may open the same fresh file at
 * once, and the mode change needs a brief exclusive lock, so retry while the
 * busy timeout does its part.
 */
function enableWal(db: DatabaseSync): void {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      db.exec("PRAGMA journal_mode = WAL;");
      return;
    } catch (err) {
      if (journalMode(db) === "wal") {
        return;
      }
      if (attempt === 5) {
        throw err;
      }
      sleepSync(50 * attempt);
    }
  }
}

export class EventStore {
  private readonly db: DatabaseSync;
  private closed = false;

  private readonly selectById: StatementSync;
  private readonly selectNextSeq: StatementSync;
  private readonly insertEvent: StatementSync;
  private readonly selectRange: StatementSync;
  private readonly selectHead: StatementSync;
  private readonly selectChains: StatementSync;

  private constructor(path: string) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.db = new DatabaseSync(path);
    // busy_timeout first: every later statement, including the WAL switch and
    // schema creation, may race another process opening the same file.
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    if (journalMode(this.db) !== "wal") {
      enableWal(this.db);
    }
    this.db.exec(SCHEMA);

    this.selectById = this.db.prepare(
      "SELECT chain, seq, id, node, ts, type, data FROM events WHERE chain = :chain AND id = :id",
    );
    this.selectNextSeq = this.db.prepare(
      "SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM events WHERE chain = :chain",
    );
    this.insertEvent = this.db.prepare(
      `INSERT INTO events (chain, seq, id, node, ts, type, data)
       VALUES (:chain, :seq, :id, :node, :ts, :type, :data)`,
    );
    this.selectRange = this.db.prepare(
      `SELECT chain, seq, id, node, ts, type, data FROM events
       WHERE chain = :chain AND seq >= :from
       ORDER BY seq ASC
       LIMIT :limit`,
    );
    this.selectHead = this.db.prepare(
      "SELECT COALESCE(MAX(seq), 0) AS seq FROM events WHERE chain = :chain",
    );
    this.selectChains = this.db.prepare(
      `SELECT chain, COUNT(*) AS count, MAX(seq) AS head
       FROM events GROUP BY chain ORDER BY chain ASC`,
    );
  }

  /** Open (creating if needed) the database file at `path`. Use `:memory:` for tests. */
  static open(path: string): EventStore {
    if (typeof path !== "string" || path.length === 0) {
      throw new StoreError("database path must be a non-empty string");
    }
    return new EventStore(path);
  }

  /**
   * Append one event to `chain`, assigning the next `seq`.
   *
   * If an event with the same id already exists in the chain, nothing is written
   * and the stored event is returned (first write wins; the store never updates).
   */
  append(chain: string, event: NewEvent): Event {
    const normalized = normalizeNewEvent(chain, event);
    this.assertOpen();

    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.selectById.get({ chain, id: normalized.id });
      if (existing !== undefined) {
        this.db.exec("COMMIT");
        return toEvent(existing);
      }

      const next = this.selectNextSeq.get({ chain });
      if (next === undefined) {
        throw new StoreError("could not allocate seq");
      }
      const seq = asNumber(next["seq"], "seq");

      this.insertEvent.run({
        chain,
        seq,
        id: normalized.id,
        node: normalized.node,
        ts: normalized.ts,
        type: normalized.type,
        data: normalized.data,
      });
      this.db.exec("COMMIT");

      return {
        v: 1,
        chain,
        seq,
        id: normalized.id,
        node: normalized.node,
        ts: normalized.ts,
        type: normalized.type,
        data: JSON.parse(normalized.data) as unknown,
      };
    } catch (err) {
      this.rollback();
      throw err;
    }
  }

  /**
   * Read events from `fromSeq` (inclusive) upward, at most `limit`, oldest first.
   * `fromSeq` defaults to 1; `limit` defaults to 1000 and is capped at 10000.
   */
  read(chain: string, fromSeq = 1, limit = DEFAULT_LIMIT): Event[] {
    this.assertOpen();
    requireId(chain, "chain");
    if (!Number.isSafeInteger(fromSeq) || fromSeq < 1) {
      throw new StoreError("fromSeq must be a positive integer");
    }
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new StoreError("limit must be a positive integer");
    }
    const capped = Math.min(limit, MAX_LIMIT);
    const rows = this.selectRange.all({ chain, from: fromSeq, limit: capped });
    return rows.map(toEvent);
  }

  /** Highest seq in `chain`, or 0 when the chain has no events. */
  head(chain: string): number {
    this.assertOpen();
    requireId(chain, "chain");
    const row = this.selectHead.get({ chain });
    if (row === undefined) {
      return 0;
    }
    return asNumber(row["seq"], "seq");
  }

  /** Every known chain with its event count and head. Ordered by chain name. */
  chains(): ChainSummary[] {
    this.assertOpen();
    return this.selectChains.all().map((row) => ({
      chain: asString(row["chain"], "chain"),
      count: asNumber(row["count"], "count"),
      head: asNumber(row["head"], "head"),
    }));
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.db.close();
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new StoreError("event store is closed");
    }
  }

  private rollback(): void {
    try {
      this.db.exec("ROLLBACK");
    } catch {
      // The transaction is already gone (e.g. the commit itself failed); the
      // original error is the one worth surfacing.
    }
  }
}
