# Protocol

Two nodes exchange JSON frames, one object per message, one chain per session.
`src/protocol/` is the frozen contract; `src/sync/replicate.ts` is the loop that
applies it. `encodeFrame` validates and returns one JSON line without a
newline; `decodeFrame` parses then validates. Both throw `ProtocolError`
(`code`, `path`, `detail`), and validators drop unknown fields. Replication
reports `bad-frame`, `chain-mismatch`, `version-mismatch`, `invalid-event` or
`store-hole` as a `SyncError`.

## Event

| Field | Rule |
| --- | --- |
| `v` | Literal `1`; anything else is rejected. |
| `chain` | Non-empty string. An `events` frame may not mix chains. |
| `seq` | Safe integer `>= 1`, assigned by the writer of the current turn. |
| `id` | Non-empty string, globally unique. Same `seq` means same `id`. |
| `node` | Non-empty string: the event's author. |
| `ts` | Safe integer `>= 0`, Unix ms. |
| `type` | One of the eight names below. Unknown types are rejected. |
| `data` | Required, any JSON value: finite numbers, no cycles, no `undefined`. |

In an `events` frame, seqs must strictly increase and all events must share one
chain. The frame may be empty in `src/protocol`; `src/transport/parse.ts`
rejects an empty list. The codec does not check contiguity; replication buffers
gaps.

## Event types and payloads

`data` is opaque to transport and storage; the shapes below are what current
producers write and consumers read. Only `message`, `assistant` and
`tool_result` are replayed into model history.

| `type` | `data` | Notes |
| --- | --- | --- |
| `message` | `{ text: string }` | User input; empty text is not replayed. |
| `assistant` | `{ text: string }` | Final answer only; stream deltas are not events. |
| `tool_call` | `{ name: string, args: string }` | `args` is the model's raw JSON **string**, not an object. |
| `tool_result` | `{ name: string, ok: boolean, output: string }` | `output` may be empty. |
| `error` | `{ message: string }` | Provider, tool or lock failure. |
| `turn_start` | `{ ttlMs: number }` | Opens a turn owned by `event.node`. |
| `turn_end` | `{ reason: "released" }` | Only the owner may close; `released` is the only value written. |
| `env` | — | Declared and accepted, but nothing in `src/` writes one yet. |

## Frames

| `t` | Shape | Version |
| --- | --- | --- |
| `hello` | `{t, v, chain, node, haveSeq}` | Own `v`. |
| `events` | `{t, events: Event[]}` | Each event's `v`. |
| `append` | `{t, event: Event}` | The event's `v`. |
| `tool_req` | `{t, call, node, tool, args}` | None. |
| `tool_res` | `{t, call, ok, output}` | None. |

- `hello` — `haveSeq` is a safe integer `>= 0`; `0` means an empty chain. A
  hello doubles as the catch-up request: the peer answering sends events from
  `haveSeq` onward, including that seq as an anchor, so a different id there is
  detected. A hello from one's own `node` is ignored.
- `events` — catch-up and fan-out batch, applied in order; at most 200 per frame.
- `append` — one new event, sent live. If it does not land at `head() + 1` the
  peer re-sends the series instead of the single event.
- `tool_req` — `call` is the correlation id and must come back on the matching
  `tool_res`; `args` must be a plain JSON object; `node` names the executor.
- `tool_res` — `ok` is a boolean, `output` any string (including `""`).
  `tool_req`/`tool_res` are turn-local, never chained, and replication ignores
  them rather than treating them as errors.

All names (`chain`, `node`, `id`, `call`, `tool`) are non-empty strings;
`haveSeq` and `ts` are safe integers `>= 0`; `seq >= 1`. `encodeFrame` also
rejects values that cannot be serialised.

## Version rule

- The wire has exactly one version: the literal number `1`, required at
  `hello.v` and every `Event.v`. `assertProtocolVersion` compares with `!==` —
  no negotiation, range or downgrade, so any bump breaks every older peer.
- Frames carrying events inherit the event version; `tool_req`/`tool_res` have
  none and are valid only inside a session that already agreed on one.
- Rejection is `unsupported_version` (`ProtocolError`) in the codec,
  `version-mismatch` (`SyncError`) in replication, and close code `4426` in
  `src/transport`.
- `src/protocol/version.ts` defines a separate `major.minor` scheme for a
  handshake that does not exist yet: two digit runs, no leading zeros, each
  `0..999`, `LATEST = 1.0`; `isCompatible(peer, local)` needs equal majors and
  `peer.minor <= local.minor`. It is neither exported by `src/protocol/index.ts`
  nor called anywhere; do not confuse it with the wire `v`.

## Conflict rule

A conflict is the **same chain, same `seq`, different `id`**. Both sides
already hold an event in that slot, so the chains have diverged and one would
have to be discarded.

- Detected in `applyRemote` when `seq <= head` and `idAt(seq) !== id`, when the
  store's `append` reports an existing id, and when two different events are
  buffered for one `seq`.
- Same `id` is a duplicate: ignored, never rewritten; the chain has one id slot.
- On conflict, `reportConflict` builds one `ConflictReport`:
  `{kind: "seq-id-mismatch", chain, seq, localNode, remoteNode, localId,
  remoteId}`. It sets status `conflicted`, clears `pending`, unsubscribes,
  closes the transport with reason `conflict`, and calls `onConflict` once.
- **No side is chosen.** No event is deleted or overwritten, the session does
  not resume, and there is no merge. Recovery is a human decision about which
  chain to keep.
- Not conflicts: a gap (buffered up to `MAX_PENDING = 10_000` ahead), a
  duplicate id, a `store-hole` (`seq <= head` with nothing stored), another
  chain, a bad frame or a version mismatch. Those set status `failed`, emit a
  `SyncError` and close the transport; only a seq/id mismatch reports a conflict.

## Bounds and helpers

`event-budget.ts` measures a whole serialised event in UTF-8 bytes and names
its largest field; `size.ts` truncates on code-point boundaries with `…`;
`redact.ts` scrubs credentials. All are opt-in: the codec enforces no size cap
and no redaction. Replication remembers 2048 remote ids to suppress echoes.
`src/transport/parse.ts` is a second, stricter parser (512-character names,
non-empty `events`, 1000 events by default, `seq >= 0`); `src/protocol` wins
where they disagree.
