# The chain

One append-only log per session, stored in SQLite, replicated event by event.
This page describes the shape of an event, what the store guarantees, and what
each module around it does today.

## What a chain is

A chain is a named, ordered list of events. The name is a string (`chain`), not
an address; nothing in storage points at a machine. One SQLite file holds every
chain on a node: a single `events` table, keyed by `(chain, seq)`. A node opens
the file with `EventStore.open(path)` from `src/chain/store.ts`;
`src/daemon/main.ts` opens it at `paths.database` once identity exists.

## The event shape

From `src/sync/types.ts`. Every event is one immutable JSON object.

| Field | Type | Meaning |
| --- | --- | --- |
| `v` | `1` | Protocol version of the event itself. Anything else is rejected. |
| `chain` | `string` | Chain name. Events from different chains are never mixed. |
| `seq` | `number` | Position in the chain, 1-based and contiguous. |
| `id` | `string` | Globally unique id. Same `seq` on two nodes must mean the same `id`. |
| `node` | `string` | Node that produced the event. |
| `ts` | `number` | Unix time in milliseconds. |
| `type` | `string` | Kind of entry. Replication does not read it. |
| `data` | `unknown` | Payload. Opaque to storage and transport; shape belongs to `type`. |

`type` is a plain string in `src/sync/types.ts`, because sync must not care. The
layers that do care narrow it: `src/protocol/types.ts` and `src/chain/store.ts`
both list the same eight values — `message`, `assistant`, `tool_call`,
`tool_result`, `error`, `turn_start`, `turn_end`, `env` — and the store rejects
an append carrying anything else.

## The three guarantees

**Append-only.** `src/chain/store.ts` exposes `append`, `read`, `head`, `chains`
and `close`. There is no update and no delete, in the class or in the table, and
`append` returns the same event it wrote. `(chain, id)` is unique, so appending
an id the chain already holds writes nothing and returns the stored event: a
retry or a duplicate frame is a no-op and the first write wins.

**`seq` is contiguous from 1.** `seq` is assigned by the store, not by the
caller: `NewEvent` has no `seq` field. Inside one `BEGIN IMMEDIATE` transaction
the store reads `COALESCE(MAX(seq), 0) + 1` for that chain and inserts, so two
processes appending to the same file cannot take the same number or leave a hole.
`head()` returns 0 only for an empty chain.

**One writer per turn.** The node running the turn appends; every other node
reads and asks. This is a lock on the turn, not ownership of the file, and it is
enforced above the store, in `src/turn/`: `acquire` compare-appends a
`turn_start` at the next `seq`, and a node that loses that `seq` gets `busy`, not
a second turn. The store cannot see this — the table accepts an append from any
process holding the file.

## The modules

**`src/chain/store.ts`** — the only writer. Opens the file (creating the
directory if needed), sets `busy_timeout = 5000` and `synchronous = NORMAL`,
switches to WAL with a short retry loop, and creates the table. `append` stores
`data` as JSON text and validates the input: non-empty `chain`/`id`/`node`, known
`type`, `v` of 1 or absent, `ts` a non-negative safe integer, a `chain` argument
that matches the event's own, JSON-serialisable `data`. `read(chain, fromSeq,
limit)` returns events from `fromSeq` upward, oldest first, default 1000 and
capped at 10 000. `chains()` lists every chain with its count and head.

**`src/chain/schema.sql` and `src/chain/schema.ts`** — the same DDL as a file,
readable by `sqlite3` and by reviewers, plus the typed access to it:
`SCHEMA_VERSION = 1`, `readSchema()`, `statements()`, `versionFrom(db)` (the
`PRAGMA user_version` value) and `initSchema(db)`, which applies the statements
once and refuses to open a database newer than the code. `schema.ts` resolves the
`.sql` file from its own directory, from `../../src/chain/`, or from the working
directory, because `tsc` does not copy `.sql` into `dist/`.

**`src/chain/lockfile.ts`** — `StoreLock.acquire(storePath)` creates
`<storePath>.lock` with `O_EXCL` and writes `{version, pid, host, startedAt}`. A
second caller gets `StoreLockedError` naming the holder, unless the lock is
stale: dead pid on this host, older than `staleMs` (10 minutes by default), or
unreadable for more than five seconds. A lock from another host is only ever
reclaimed by age. `release()` deletes the file only while it still holds this
acquisition's record, and never throws.

**`src/chain/export.ts`** — `exportChain(store, chain, outPath)` writes the whole
chain as JSONL, one event per line, oldest first, reading in pages of 10 000 and
returning `{count, head}`. `importChain(store, chain, inPath)` requires an empty
chain, keeps file order, drops `seq` and `chain` so the store assigns both, skips
blank lines and ids already seen in the file, and fails with `line N:` in the
message on a malformed line.

**`src/chain/verify.ts`** — `verifyChain(events)` needs no database; it checks
that seqs start at 1 and are contiguous, strictly increasing in the given order,
unique per seq and per id, all on one chain, and well-shaped. `verifyStore(store,
chain)` pages the whole chain and adds `head-mismatch` when `store.head()`
disagrees with the highest seq it read. Every defect is a `ChainProblem` in the
returned `ChainReport`; a broken chain is reported, never thrown.

**`src/chain/gc.ts`** — `planCompaction(store, chain, options?)` answers what
*would* be worth compacting and compacts nothing: it calls only `store.read` and
`store.head`, and returns a `CompactionReport`. Candidates are `same-type-run`
(consecutive events of one type longer than `minRunLength`, default 20, keeping
the last `keepRunTail`, default 1), `large-old-tool-event` (a `tool_call` or
`tool_result` outside the last `keepRecent` 50 events whose payload is at least
4096 bytes) and `duplicate-id` (corruption, since the schema forbids it). Savings
are estimated from `JSON.stringify(event.data)`.

**`src/sync/backfill.ts`** — `Backfiller` serves one chain to one lagging peer.
The peer's `hello` is the request: `planBackfill` computes `haveSeq + 1 .. head`,
and the class sends one `events` frame per page, 200 events by default and never
more than 2000. It reads through `NodeStore.since`, refuses to send if the store
has a hole in that range or an event without a usable id, skips ids it already
sent to this peer, and retries a failed `send` on a one-second timer before
giving up with status `failed`. `progress()` reports status
(`idle`/`sending`/`complete`/`failed`/`stopped`), cursor and counters.

## What is not done yet

- **`schema.ts` is never called.** `src/chain/store.ts` creates the table from
  its own inline `SCHEMA` string and imports nothing from `schema.ts`;
  `initSchema`, `SCHEMA_VERSION` and `versionFrom` have no caller in `src/`. The
  two DDL copies must be kept in step by hand, and a file that store.ts created
  still reports `user_version = 0`, because only `schema.sql` sets it.
- **The lockfile is never acquired.** Nothing in `src/` calls
  `StoreLock.acquire`; `src/daemon/main.ts` opens the store directly. Two daemons
  pointed at one file are therefore serialised only by SQLite, not refused, and
  the "one writer" of the third guarantee rests entirely on the turn lock in
  `src/turn/`.
- **`EventStore` is not a `NodeStore`.** It has no `idAt`, `has`, `since` or
  `subscribe`, and `append` takes a `NewEvent` and assigns `seq` itself, so it
  cannot receive a remote event that already has one. The adapter lives in
  `src/testing/two-node.ts`, which is test code; `src/daemon/turn-runner.ts` has
  its own, narrower `TurnStore` adapter.
- **Nothing constructs a `Backfiller`.** `src/sync/replicate.ts` already answers a
  `hello` with the events the peer lacks, and `Backfiller` is a second
  implementation of that catch-up with no caller outside its own file, so
  catch-up today ships over the `replicate` path, not this one.
- **Export, import, verify and compaction have no caller outside tests.** Nothing
  in `src/daemon/` calls `exportChain`, `importChain`, `verifyStore` or
  `planCompaction`, and there is no user-facing command for them. `gc.ts` only
  plans: no code rewrites a chain, and the store offers no path to — folding a
  payload would need an update the schema deliberately forbids.
- **`exportChain` is not streaming.** It reads page by page but accumulates every
  serialised line in an array and writes the file once at the end.
- **The event shape exists three times.** `src/sync/types.ts` (`type: string`),
  `src/protocol/types.ts` (`readonly`, eight types, the declared source of truth)
  and a copy inside `src/chain/store.ts`, whose comment still says it will
  re-export from the protocol module "when that module lands". It has landed;
  the copy is stale.
