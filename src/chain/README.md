# The chain

Reference for anyone changing the chain layer: the guarantee the rest of the system
may assume, and where it is actually enforced.

## What an event is

An event is one immutable entry: `v`, `chain`, `seq`, `id`, `node`, `ts`, `type`,
`data`. The shape and the wire contract live in `src/protocol/types.ts`; that file is
the source of truth. `src/chain/store.ts` carries its own copy of `Event`/`EventType`
so storage does not depend on the protocol module; if they disagree, the protocol
wins.

Storage is one SQLite file holding every chain: one `events` table, `(chain, seq)`
primary key, `(chain, id)` unique, `STRICT` on. The DDL exists twice — inline in
`store.ts`, and in `schema.sql` which `schema.ts` reads (`initSchema`,
`SCHEMA_VERSION`). `store.ts` opens with its inline copy, so keep them in step.

## The four guarantees

1. **Append only.** `EventStore` exposes `append`, `read`, `head`, `chains`, `close`.
   There is no update and no delete, in the class or in the SQL.
2. **`seq` starts at 1 and is contiguous.** `selectNextSeq` is
   `COALESCE(MAX(seq), 0) + 1` for the chain, read inside the same `BEGIN IMMEDIATE`
   transaction as the insert, so a chain never skips a number and never repeats one.
   `head()` returns `0` for an empty chain, the only legal "nothing yet" value.
3. **One writer per turn.** The node running the turn appends; every other node reads
   and sends tool requests. Two nodes may not run a turn at once. This is a lock on
   the turn, not ownership of the chain, and it is the caller's obligation.
4. **Ids are unique per chain.** `UNIQUE (chain, id)`. An append carrying an id the
   chain already holds writes nothing and returns the stored event, so a retried
   append is a no-op. The same id may exist in another chain.

## SQL versus the caller

The store enforces, in SQLite:

- `NOT NULL` everywhere and `STRICT` typing, so a bad writer fails instead of storing
  `seq` as text.
- `(chain, seq)` primary key — two appends cannot claim the same slot, even from
  different processes; `(chain, id)` unique makes a repeated id a no-op.
- Atomic `seq` allocation: reading `MAX(seq)` and inserting are one transaction, with
  WAL and a 5000 ms busy timeout for the multi-process case.
- Rejecting malformed input: empty `chain`/`id`/`node`, unknown `type`, non-integer or
  negative `ts`, a `chain` that disagrees with the append argument, `v` other than `1`,
  non-JSON `data`. Also `read` with `fromSeq < 1`.

The caller must enforce, because the store cannot:

- **One writer per turn.** The table accepts an append from any process holding the
  file. Nothing in SQL knows which node holds the turn. `lockfile.ts` can hold a
  store file to one process, but `store.ts` does not acquire it on your behalf.
- **Contiguity is not re-checked on read.** `read` returns whatever rows exist from
  `fromSeq` up; it does not prove the range has no hole. Only the append path keeps
  the sequence dense, so a migration, a hand-run statement or an import that writes
  around `append` can break the invariant silently.
- **Id generation.** The store only rejects an id already in that chain. That two nodes
  never mint the same id is the id format's job, not the database's.
- **Correct `seq` on anything replicated.** The `NodeStore` contract in
  `src/sync/types.ts` requires `append` to accept only `head() + 1`;
  `src/sync/memory-store.ts` is the reference implementation and throws `store gap`
  for a jump. `EventStore.append` assigns the number itself and ignores any `seq` in
  `NewEvent`, so the storage path cannot be fed a foreign one.
- **What `data` means.** The store treats it as opaque JSON; its shape belongs to
  `type` and the reducer.

## What replication may never do

Replication is an appender of remote events, never an author.

- **Never writes `seq`.** `ReplicationSession` in `src/sync/replicate.ts` takes the
  `seq` from the incoming event and checks it against `head() + 1`. Anything further
  ahead is buffered, and beyond `MAX_PENDING` it is a hard error.
- **Never fills a hole with a different event.** Out-of-order events wait in `pending`
  keyed by `seq` and are flushed only when the missing predecessor arrives. A second,
  different id for a buffered `seq` is a conflict. If `seq <= head` and the store has
  nothing there, the session fails with `store-hole` instead of writing into the gap.
- **Never overwrites.** `applyRemote` checks `has(id)` first, then `idAt(seq)`. Equal
  id means "already had it"; different id means conflict. No path writes over a stored
  event, because the store offers none.

## What a conflict is

A conflict is the same `seq` with a different `id`. Both sides already hold an event
there, so the chains have diverged; one would have to be discarded, and nothing here
picks.

`reportConflict` records a `ConflictReport` of kind `seq-id-mismatch` — `chain`, `seq`,
both node ids, both event ids — sets the status to `conflicted`, clears `pending`,
unsubscribes, closes the transport with reason `conflict`, and calls `onConflict` once.
No event is deleted, no winner is chosen, the session does not resume; recovery is a
human decision about which chain to keep.

A `store-hole` or a malformed frame is not a conflict: those fail the session (status
`failed`, `SyncError` with a code) without a `ConflictReport`.

## Checking a chain

- `verify.ts` — `verifyChain(events: Event[])` checks an array with no database;
  `verifyStore(store, chain)` pages the store and adds the `head-mismatch` check
  against `store.head()`. Both return a `ChainReport`: `ok`, `chain`, `count`, `head`,
  `problems`. Problem codes are `gap`, `duplicate-seq`, `duplicate-id`, `bad-order`,
  `wrong-chain`, `bad-shape`, `head-mismatch`. A broken chain is reported, not thrown.
- `gc.ts` — `planCompaction(store, chain, options?)` returns a `CompactionReport`. It
  plans and never compacts: no `fs`, no `append`, no `DELETE`. Candidate kinds are
  `same-type-run`, `duplicate-id` (corruption, since the schema forbids it) and
  `large-old-tool-event`.
- `export.ts` — `exportChain(store, chain, outPath)` writes JSONL, one event per line,
  oldest first, returning `{ count, head }`. `importChain(store, chain, inPath)`
  requires an empty chain, strips `seq` and `chain` so the store assigns both, and
  rejects a bad line with its 1-based number.
- `lockfile.ts` — `StoreLock.acquire(storePath)` creates `<storePath>.lock` with
  `O_EXCL`. A live holder raises `StoreLockedError`; a stale one (dead pid on this
  host, or older than `staleMs`) is reclaimed. `release()` belongs in `finally`.
- `npm test` — `src/sync/replicate.test.ts` covers ordering, holes and conflicts
  against `memory-store.ts`; `verify.test.ts` covers the report codes.

Read a chain through `EventStore` and judge it with `verifyChain`/`verifyStore`.
Opening the SQLite file with another client is how holes get made.
