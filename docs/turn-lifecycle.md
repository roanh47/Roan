# The turn lifecycle

A turn is the work between the user pressing enter and the agent answering. In
the chain it is also a lock: one `turn_start` and one `turn_end` from the same
node, with only that node appending in between. This page follows one turn
through the code and says where the code stops short.

## 1. Two things called `turn_end`

| Name | Where | What it is |
| --- | --- | --- |
| `AgentEvent` `turn_end` | `src/types.ts`, emitted in `src/agent.ts` | The core saying "the loop is done", carrying `steps`. Never leaves the process. |
| chain event `turn_end` | `src/turn/lock.ts` (in `release`) | The lock being released, `data: { reason: "released" }`. This is the one that goes into the chain. |

`src/daemon/turn-runner.ts` never forwards the core's `turn_end`: its `onEvent`
switch handles `assistant_text`, `tool_start`, `tool_end` and `error`, and drops
the rest, so the step count is lost.

## 2. From a typed message to `runTurn`

1. **The app sends an `append` frame.** `src/daemon/control.ts` accepts a frame
   `{ t: "append", event: { id?, type: "message", data: { text } } }` on the
   local control socket. Anything whose `type` is not `"message"`, or whose text
   is blank, is ignored. This socket never replicates.
2. **The daemon stores the message.** `control.ts` appends the `message` event
   with `node` taken from `DaemonState`, broadcasts it to every open window, and
   only then calls `onMessage(text)`.
3. **`main.ts` starts the turn.** `runMessage` in `src/daemon/main.ts` returns
   immediately (`void runTurn(...)`). Nothing tracks the promise, so a second
   `append` frame is not queued or rejected by the socket layer — it goes
   straight into a second `runTurn`.
4. **`runTurn` takes the lock** (`src/daemon/turn-runner.ts`). The turn runs in
   the daemon process that received the text, on `paths.syncedWorkspace` as
   `cwd`. Nothing forwards it to another machine.
5. **History is replayed.** `historyFromEvents(store.read(chain, 1, 10_000))`
   (`src/daemon/history.ts`) turns `message`, `assistant` and `tool_result`
   events into chat messages. Tool calls are not replayed, only their results, as
   plain `tool` messages with synthetic `replay-<id>` ids.

## 3. The one-writer lock

`src/turn/lock.ts` is a pure fold over the chain tail plus one
compare-and-append. It has no clock of its own and does not touch the store
beyond `tail` and `append` (`TurnStore` in `src/turn/types.ts`).

**`deriveTurnState(events, { ttlMs, now })`** sorts the tail by `seq` and:

- `turn_start` opens a turn for its sender. A later `turn_start` supersedes an
  earlier one — that is how an expired turn is reclaimed.
- `turn_end` closes the turn only if `event.node` is the current owner. A
  foreign `turn_end` is ignored, so a stray event cannot release someone else's
  lock.
- Any other event from the owner updates `lastActivityAt`; events from other
  nodes do not.
- With `ttlMs` set, an open turn whose `now - lastActivityAt >= ttlMs` is
  reported as `{ open: false, expired: true }` rather than open. Default TTL is
  `DEFAULT_TURN_TTL_MS`, five minutes.

**`acquire(store, chain, node)`** reads the tail (default 1,000 events) and
derives the state. **It does not throw on a busy chain**: it returns
`{ state: "busy", owner, startedAt, lastActivityAt, expiresAt }`. If no turn is
open it compare-appends a `turn_start` with `data: { ttlMs }` at
`nextSeq(tail)`. If the store rejects that because the head moved, it retries —
three attempts by default — and then throws
`TurnLockError("append-conflict", ...)`. Argument and tail checks (`assertName`,
`assertTailBelongsToChain`, `validateEvent`) raise `TurnLockError` with
`invalid-argument`, `wrong-chain` or `bad-event`.

**`release(store, chain, node)`** re-derives the state and appends `turn_end`
with `reason: "released"`. It throws `no-open-turn` when nothing is open and
`not-turn-owner` when someone else holds it; the chain is left untouched. An
owner whose turn merely expired may still close it, provided nobody reclaimed
it.

### What a second turn sees

In `src/daemon/turn-runner.ts` the busy result becomes an event, not a thrown
error — `append({ type: "error", data: { message: lock.owner + " is already
working on this chain" } })` — and the function returns. The second turn writes
one `error` event and no `turn_start`. Two nodes that read the same tail and both
try are separated the same way: one wins the `seq`, the other's `append` raises
`SeqConflictError`, the tail is re-read, and the loser now sees the winner's open
turn and reports busy. That is the whole mechanism; there is no queue, no wait
and no retry interval.

## 4. Cancellation

`src/turn/cancel.ts` defines `CancelToken`, deliberately inert — no timer, no
clock, no I/O:

- `cancel(reason)` validates a non-empty reason, records the **first** one, and
  ignores later calls. The reason is set before listeners run, so a listener
  already sees `isCancelled === true`.
- `onCancel(listener)` returns an unsubscribe. A listener registered after
  cancellation is called immediately with the stored reason and the unsubscribe
  is a no-op, so there is no check-then-subscribe gap.
- Listeners run once, in registration order, then are dropped. A throwing
  listener does not stop the others; the first failure is rethrown afterwards as
  an `AggregateError`.
- `throwIfCancelled()` throws `Error("operation cancelled: <reason>")` with the
  reason verbatim.

**Where it is observed today: nowhere.** Nothing in `src/` or `web/src/`
imports `CancelToken`; the only `cancel(` hits are stream-reader cancellations
in `src/tools/http.ts`. The path that does exist is a plain `AbortSignal`:
`Agent` accepts `signal` and passes it to `chat(...)` and to each
`ToolContext`, and `src/providers/retry.ts` checks `signal.aborted` between
attempts (throwing an `AbortError` rather than retrying). But
`runTurn` never sets `signal`, the control protocol (`src/daemon/control-protocol.ts`)
has no cancel request, and no UI affordance sends one. So a turn can only be
stopped by stopping the daemon. See §6.

## 5. Where errors become events

The convention from `AGENTS.md`: throw an `Error` that says what failed; the
caller turns it into an event; the core never prints. On the turn path:

- **Provider/model failure.** `Agent.send` catches it, emits
  `{ type: "error", message }`, then rethrows. `turn-runner`'s `onEvent` appends
  that as an `error` event; the rethrow lands in `runTurn`'s `catch`, which
  appends `{ type: "error", data: { message } }` again. A failed model call
  therefore writes **two** `error` events with the same message.
- **Tool failure is not an `error` event.** `agent.ts` catches a tool throw,
  sets `ok: false`, and returns the message as the tool's output. It reaches the
  chain as a `tool_result` and goes back to the model; the turn continues. A tool
  name the model invented becomes `ok: false` with `onbekende tool: <name>`.
- **Lock failure while busy** becomes an `error` event as shown in §3.
- **`acquire`/`release` throwing** (`append-conflict`, `bad-event`) is only
  partly covered: `acquire` runs *before* `runTurn`'s `try`, so a throw there
  escapes the function and, since `main.ts` discards the promise, becomes an
  unhandled rejection. The `finally` swallows a failing `release` on purpose
  ("the turn already ended or was reclaimed"), so broken cleanup leaves no trace.

Nothing on this path calls `console.log`: the core emits events, and the daemon
keeps its startup and fatal lines on `process.stderr` in `src/daemon/main.ts`.

## 6. Not built yet

- **Cancellation end-to-end.** `CancelToken` has tests (`src/turn/cancel.test.ts`)
  and no caller. No control frame cancels a turn, `runTurn` passes no `signal`,
  and there is no `turn_end` with `reason: "cancelled"`.
- **Mid-flight expiry.** The TTL is only read inside `acquire` and `release`.
  A turn that hangs past five minutes keeps running; nobody preempts it. The
  reclaim only happens when the *next* turn tries to acquire.
- **A queued second turn.** A busy chain produces an `error` event and returns.
  Nothing retries or waits.
- **Live `turn_start` for open windows.** `acquire` writes through the
  `TurnStore` adapter in `turn-runner.ts`, which calls `store.append` directly
  and not `onAppend`. The event is durable but not broadcast; a connected window
  learns about it only from the backlog it gets on connect (`greet` in
  `control.ts`) or by re-reading.
- **The step count.** `turn_end`'s `steps` is emitted by the core and dropped
  before it reaches the chain.
- **A deadline on `chat`.** The turn imposes none; the only `AbortSignal.timeout`
  in the tree is in `src/tools/http.ts`, for outbound HTTP tools.
