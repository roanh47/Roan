# Architecture

Four layers: one talks to the user's screen, three do not. This page describes
what `src/` implements today; where the code is thinner than `PLAN.md`, the
sentence names the half that exists.

## The four layers

**Core.** `src/agent.ts`, `src/types.ts`, `src/tools.ts`, `src/provider.ts`. Owns
the `model → tool → model` loop for one turn: `Agent` takes a provider config, a
tool list, a system prompt, a `cwd`, an optional history and an optional
`onEvent`, and `send()` replays at most `maxSteps` model calls, default 24,
stopping when the model returns no tool calls. It imports nothing from
`src/chain/` or `src/sync/`, and nothing that renders.

**Chain.** `src/chain/store.ts`. Owns ordering and durability: one SQLite file
holds every chain on the node, and an event is a row whose position is `seq`.
`EventStore` exposes `append`, `read`, `head` and `chains` — no update, no delete.

**Sync / transport.** `src/sync/replicate.ts` against the interfaces in
`src/sync/types.ts`. Owns catch-up and live fan-out between one local store and one
peer: a `hello` carries `chain`, `node` and `haveSeq`, the node behind answers with
the events after `haveSeq`, and each later append goes out as an `append` frame. It
never opens a socket; the transport is only `send`, `close`, `onMessage`, `onClose`.

**App.** `src/daemon/main.ts`, `src/daemon/control.ts`, `src/daemon/turn-runner.ts`.
Owns identity, paths, the local socket the UI talks to, and one turn's execution:
the control server appends the user's message and calls `runTurn`, which takes
the turn lock, replays the chain into the core and appends what the turn produces.

## The boundary

The only thing that leaves the core is the `AgentEvent` union in `src/types.ts`:
`assistant_text`, `tool_start`, `tool_end`, `error`, `turn_end`. `agent.ts` emits
those through `onEvent` and returns the last assistant text; it has no other
output channel and no reference to a UI. `src/daemon/turn-runner.ts` turns that
stream into chain events: `tool_start` to `tool_call`, `tool_end` to `tool_result`,
`error` to `error`, and accumulated `assistant_text` into the single `assistant`
event appended when the turn ends; `turn_end` and its step count stay local.
Because the boundary is one event union, another front end consumes the same
stream unchanged.

## The chain guarantee

**Append-only.** `append` is the only write; the schema has no update path and
the module comment says events are immutable. That matches the code.

**Contiguous `seq`.** `seq` is allocated inside a `BEGIN IMMEDIATE` transaction
as `MAX(seq) + 1` for that chain, so the store cannot hand out a gap or the same
number twice. `(chain, seq)` is the primary key. A remote event reaches `append`
only at exactly `head() + 1`; anything further ahead is buffered in `replicate.ts`
until the gap closes, and a buffer over 10,000 ahead fails the session.

**Idempotent append.** `(chain, id)` is unique. Appending an id the chain already
holds writes nothing and returns the stored event, so a retry or duplicate frame
is a no-op and the first write wins.

**One writer per turn.** The turn is a lock in the chain, not a process owner:
`src/turn/lock.ts` folds the tail into a state from `turn_start`/`turn_end` and
the owner's other events. `acquire` compare-appends `turn_start` at the next
`seq`; if another node won that `seq`, the store raises `SeqConflictError`, the
tail is re-read and the loser gets `busy`, not a second turn. `runTurn` turns
`busy` into an `error` event naming the owner; `release` refuses anyone but the
owner. A turn with no owner activity for the TTL — five minutes by default — is
abandoned and may be superseded.

**Conflicts are not resolved by picking a side.** If two nodes hold different ids
at the same `seq`, `replicate.ts` records a `seq-id-mismatch` conflict, stops the
session and closes the transport; nothing overwrites the local event.

## Where a turn runs, where tools run

A turn runs on the node whose app received the text. `control.ts` appends the
`message` event and calls `runTurn` in that same daemon process; nothing forwards
a turn to another machine to execute it there.

Tools run in that same process, inside the loop. For each tool call, `agent.ts`
looks the tool up by name, calls `run(args, { cwd, signal })` and adds the result
to the conversation as a tool message. The built-ins are `read_file`, `write_file`,
`list_dir` and `run_shell` from `src/tools.ts`; each resolves paths against `cwd`
and refuses anything that escapes it. A failing tool becomes `tool_end` with
`ok: false`; its message returns to the model and the turn continues.

The distributed half is specified but not wired. `src/protocol/types.ts` defines
`tool_req` and `tool_res`, and `src/tools/policy.ts` decides `allow`, `ask` or
`deny` per tool, with path checks that override a declared `allow`. But no code
sends a `tool_req`: `replicate.ts` ignores frames that are not replication, and
the loop always runs tools locally. `policy.ts` is not called by `agent.ts` or
`turn-runner.ts`, and `src/tools/registry.ts`, which builds a registry from a
`Policy`, has no caller in `src/`. Locality is real; the tool split is not. The
daemon starts the control server and no peer listener: nothing calls
`startPeerServer`, so sync runs through `replicate()` with a transport handed in.

## Joining a chain

**Creating** calls `createIdentity` (`src/daemon/identity.ts`), which writes a
`nodeId`, a `chainId` and a 32-byte token, and returns an invite code carrying
chain id, token, host and peer port.

**Joining** decodes that code, creates a fresh local `nodeId`, keeps the code's
`chainId` and token, saves the identity and opens the store. Join adopts: nothing
local is merged in or pushed up, and the chain's history arrives only through sync,
which the join handler does not start.

**Parking before replacing.** `src/env/apply.ts` makes the local env exactly the
chain's env: it parks the current env with `parkEnv`, writes the snapshot's
entries, reads them back and compares hashes — a mismatch is an error, not a
success; applying the same snapshot twice is a no-op. `parkEnv`
(`src/env/park.ts`) moves the previous env to `~/.roan/workspace/parked/<timestamp>/`
with a `park.json` manifest; it moves, never deletes, and returns `null` when there
was nothing to park. Only paths named in `src/env/types.ts` are touched:
`AGENTS.md`, `SOUL.md`, `USER.md`, `MEMORY.md`, `config.json`, `memory/`, `skills/`
and `mcp/`. `secrets/`, `workspace/` and `synced-workspace/` fall outside that set.

**Only a new chain seeds.** Nothing packs a local env into a chain: no code
outside `src/env/` calls `packEnv` or `applyEnvSnapshot`. So joining writes an
identity and opens the store; env adoption exists in `src/env/` but the join
handler in `src/daemon/main.ts` does not call it. `PLAN.md` says joining "parks
whatever was on this device" — the step exists, the call does not; the same gap is
in `docs/invite-flow.md`.
