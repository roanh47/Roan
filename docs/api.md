# Control API

The daemon's local control port, frame by frame. This is the protocol the
desktop window, the Android shell and `sdk/client.ts` speak; it is not the peer
protocol (`docs/protocol.md`) and nothing here crosses the network to another
node.

Every shape below was read from the code, not designed here:

- `src/daemon/control.ts` — the socket, the frames it routes, the greeting.
- `src/daemon/control-protocol.ts` — the typed control frames (`state`,
  `create_chain`, `join_chain`, `peers`) and the join code.
- `src/daemon/main.ts` — the `onRequest` handler: every other request kind and
  its reply, plus `state()`.
- `sdk/client.ts` — the client half of the subset an embedder needs.

Where the code has no answer, this document says so instead of inventing one.

## 1. Where it listens

| Fact | Value | Source |
| --- | --- | --- |
| URL | `ws://127.0.0.1:6769/ws` (`/` still works; both speak the same frames) | `control.ts`, `web/src/socket.ts` |
| Port | `ROAN_PORT`, default `6769` (alias `ROAN_CONTROL_PORT`) | `main.ts`, `autostart.ts` |
| Host | `ROAN_HOST`, default `127.0.0.1` (alias `ROAN_CONTROL_HOST`) | `main.ts` |
| Other paths | `/` static UI, `/peer` peer sync, `/log` daemon log, `/healthz` | `control-http.ts` |
| Transport | plain WebSocket text frames, JSON only | `control.ts` |
| Auth | none — any local process that can open the port can send `append`; non-loopback callers are refused unless `ROAN_ALLOW_REMOTE_CONTROL=1` | `control.ts` |
| TLS | none | — |

One socket carries two protocols, and the server does not distinguish them by
path or by a handshake:

- **control frames** — plain `JSON.stringify` of the objects in this document.
- **chain frames** — `hello`, `events`, `append`, encoded by
  `src/protocol/codec.ts` (`encodeFrame`), which validates them against protocol
  version `1` and drops unknown fields.

A frame that is not a JSON object is dropped silently (`control.ts` returns on a
parse failure); nothing is sent back to say so.

## 2. Connect greeting

`greet()` runs on every new connection (`control.ts`).

With a chain:

```
{ t: "hello", v: 1, chain, node, haveSeq }     // encodeFrame, v is the literal 1
{ t: "state", data: DaemonState }
{ t: "events", events: Event[] }               // only if the store has events
```

`haveSeq` is `state.head`. The backlog is `store.read(chain, 1, 10_000)` — the
first ten thousand events, not the ones the client is missing — and the frame is
omitted when the chain is empty.

Without a chain (onboarding):

```
{ t: "state", data: DaemonState }              // onboarding: true
```

There is no per-client id and no subscription: every connected socket receives
every broadcast and every `sendState()`.

## 3. Daemon → client control frames

| `t` | Shape | When |
| --- | --- | --- |
| `state` | `{ t, data: DaemonState }` | Greeting, an answered `state` request, and pushes after create/join, a provider pick, a node or session rename, an archive or a delete (§4.4) |
| `chain` | `{ t, chain, node, invite? }` | Answer to `create_chain` / `join_chain`; `invite` only after a successful create |
| `control_error` | `{ t, message }` | `create_chain` / `join_chain` threw |
| `reply` | `{ t, id, data }` | Answer to a request/reply kind; `id` echoes the request's `req` |

`DaemonState`, from `state()` in `main.ts` (the interface in
`control-protocol.ts` is the same, minus `ephemeral`):

| Field | Type | Meaning |
| --- | --- | --- |
| `onboarding` | `boolean` | True when there is no chain on this machine |
| `chain` | `string \| null` | Chain id |
| `node` | `string \| null` | This machine's node id |
| `head` | `number` | `store.head(chain)`; `0` with no chain |
| `peers` | `string[]` | Node ids connected right now |
| `nodes` | `{ node, name, host, port, live? }[]` | Every node that ever announced itself, newest fact per node |
| `invite` | `string \| null` | The `v2` join code another device pastes in; `null` before a chain |
| `model` | `string?` | Current model |
| `provider` | `string?` | Current provider id |
| `sessions` | `{ id, title, messages, ephemeral? }[]?` | Conversations in the order they started; deleted and finished ephemeral ones are left out |
| `activeSession` | `string \| null?` | The conversation a bare `append` lands in |

`nodes[].live` is true for the local node while its daemon runs, and for a peer
that is connected or spoke recently. `sessions[].ephemeral` is written by
`main.ts` even though `control-protocol.ts` does not declare it — an older typed
client simply ignores it.

## 4. Client → daemon frames

### 4.1 `state`

```
→ { t: "state" }
← { t: "state", data: DaemonState }
```

### 4.2 `create_chain` and `join_chain`

```
→ { t: "create_chain" }
→ { t: "join_chain", code }          // code: the pasted/scanned invite, opaque
← { t: "chain", chain, node, invite? }
← { t: "control_error", message }    // on a throw
```

- `create_chain` is idempotent: with a chain already present it answers the
  existing `chain`, `node` and `invite` and writes nothing (`onCreate` in
  `main.ts`).
- `join_chain` decodes the code (`decodeJoinCode`), writes a new identity, and
  answers `{ t: "chain", chain, node }` with **no** `invite` (there is no
  `invite` in a join reply, even on success).
- A bad code makes the promise reject, which surfaces as `control_error` with
  the decoder's message (`this is not a Roan invite code`, `invite code has no
  usable port`, …).
- Neither handler refuses when a chain already exists; `join_chain` replaces the
  local identity.
- After either answer, the server also runs `greet()` on that socket, so a
  `hello` / `state` / backlog follows.

### 4.3 `append`

```
→ { t: "append", event: { id?, data: { text, session?, image? } } }
```

No reply is sent. `control.ts` reads only `event.data` and `event.id`; every
other field is ignored — the daemon writes chain, seq, node and ts itself.

| Field | Rule |
| --- | --- |
| `data.text` | Required. A blank or missing text is dropped **silently**, no error frame |
| `data.session` | Optional; which conversation the message belongs to |
| `data.image` | Optional `{ mime, data }`; both strings and `data` between 1 and 1,599,999 characters, else ignored while `text` still lands |
| `event.id` | Optional non-empty string; travels as the echo id so a UI can drop its pending bubble |

The daemon then appends the `message` event and broadcasts
`{ t: "append", event }` to every client.

### 4.4 Frames with no reply

These reach a dedicated handler and nothing is sent back:

| `t` | Fields | Effect |
| --- | --- | --- |
| `new_session` | `title?` | Starts a conversation |
| `rename_session` | `session`, `title` | Appends `session_title`; ignored unless both are non-blank |
| `rename_node` | `node`, `name` | Appends a `node` event for a known node |
| `checkpoint` | `label?` | Appends `checkpoint` with `label ?? "checkpoint"` |
| `rewind` | `seq` | Opens a new conversation from that seq; nothing is deleted |
| `leave_chain` | — | Archives the identity and stops the daemon; this socket drops |

Where a mutation changes what a window shows, `main.ts` calls `sendState()`
afterwards, so a `state` frame may arrive without anyone asking.

### 4.5 One-shot requests

Everything else is a request/reply kind handled by `onRequest` in `main.ts`:

```
→ { t: "<kind>", req: "<correlation id>", …request data }
← { t: "reply", id: "<same id>", data: <any JSON> }
```

- `req` is the correlation id. `id` **inside the frame body is request data**
  (a provider account id, for example) and is never used as the reply address.
- One kind reuses that field as data: `tool_approve` reads `req` as the pending
  approval it answers, and the reply still echoes it as `id`. A client that
  wants to answer an approval must use the approval id as the correlation id —
  `sdk/client.ts` takes it as the third argument of `request()`.
- Without a `req` string, no reply is sent at all — not even an error.
- An unknown kind is answered as data:
  `{ t: "reply", id, data: { error: "unknown request: <kind>" } }`.
- Replies go only to the socket that asked; they are never broadcast.
- A handler that throws is caught and answered with `{ error: "<message>" }`.
- Whether a refusal uses `{ ok: false, error }` or bare `{ error }` varies by
  kind; the tables below show what each one actually writes.

## 5. Request kinds

`—` means the request carries no fields beyond `t` and `req`.

### Workspace (the synced workspace on this machine)

| Kind | Request data | Reply data |
| --- | --- | --- |
| `workspace_list` | — | `{ files: { path, bytes, hash }[] }`, sorted by path |
| `workspace_read` | `path` | `{ path, content }` or `{ error: "outside the workspace" }` |
| `workspace_write` | `path`, `content` | `{ ok: true, hash }` or `{ error }`; also appends a `workspace` event |

### Cron

| Kind | Request data | Reply data |
| --- | --- | --- |
| `cron_list` | — | `{ jobs }` — the parsed `cron.json`, shape owned by `src/cron` |
| `cron_save` | `jobs: CronJob[]` | `{ ok: true }` |

### Turns and conversations

| Kind | Request data | Reply data |
| --- | --- | --- |
| `regenerate` | `seq` | `{ ok: true }` or `{ error }`; marks a checkpoint and re-asks the question before that seq |
| `cancel_turn` | — | `{ ok: true }`, or `{ ok: false, error: "no turn is running" }` |
| `steer` | `text` | `{ ok: true, replaced, previous }` (see `src/turn/steer.ts`), or `{ ok: false, error: "no turn is running" }` |
| `checkpoints_list` | — | `{ checkpoints: { seq, label, ts, session? }[] }`, newest first |
| `session_archive` | `id`, `archived?` | `{ ok: true }` or `{ ok: false, error }`; appends a `session` event |
| `session_delete` | `id` | `{ ok: true }`; appends a `session` event with `deleted: true` |

### Providers, models and settings

| Kind | Request data | Reply data |
| --- | --- | --- |
| `providers_list` | — | `{ presets, source, active, accounts: { id, label, baseUrl, keySet, preset }[] }` |
| `provider_save` | `label`, `baseUrl`, `apiKey?`, `preset?`, `id?` | `{ ok: true, id, keySet }` or `{ error }` |
| `provider_remove` | `id` | `{ ok: true }` |
| `provider_pick` | `id`, `model?` | `{ ok: true, provider, model }` or `{ error: "unknown provider" }` |
| `models_list` | `id` | `{ models, error? }` or `{ error: "unknown provider" }` |
| `models_search` | `query?` | `{ models: { provider, providerName, model, modelName, context? }[], total, source }` (at most 200) |
| `settings_save` | any of `apiKey`, `baseUrl`, `model`, `provider` | `{ ok: true, model, provider, keySet }` or `{ error: "nothing to save" }`; the key is never echoed |
| `model_set` | `provider`, `model` | `{ ok: true, model, baseUrl }` or `{ error }` |
| `effort` | `effort: "low" \| "normal" \| "high"` | `{ ok: true, effort }` or `{ ok: false, error }`; appends nothing |

### MCP servers and tools

| Kind | Request data | Reply data |
| --- | --- | --- |
| `mcp_list` | — | `{ path, text, started: false }` — the raw `mcp.json` |
| `mcp_save` | `text` (whole file) | `{ ok: true }` or `{ error: "that is not valid JSON" }` |
| `mcp_server_save` | `id`, `label?`, `transport?: "stdio" \| "http"`, `url?`, `command?`, `enabled?` | `{ ok: true, id }` or `{ ok: false, error }`; appends an `mcp_server` event |
| `mcp_server_delete` | `id` | `{ ok: true, id }` or `{ ok: false, error }`; appends a removal event |
| `tools_list` | — | `{ tools: { name, description }[], engine }` |
| `tools_state` | — | `{ ok: true, tools: { name, source, enabled, ask, approved }[], servers }` |
| `tool_rule` | `tool`, `enabled?`, `ask?` | `{ ok: true, tool }` or `{ ok: false, error }`; appends a `tool_rule` event |
| `tool_approve` | `req`, `allow?` | `{ ok: true, tool, learned }` or `{ ok: false, error: "no pending approval for that req" }` |
| `tool_approval_reset` | `tool` | `{ ok: true, tool }` or `{ ok: false, error }` |
| `skills_list` | — | `{ skills: { name, description, files }[], root }` |

### Export, import and device

| Kind | Request data | Reply data |
| --- | --- | --- |
| `export` | `what`: `"chain"` or a session id | `{ ok: true, path, shared, count }` or `{ ok: false, error: "unknown conversation" \| "no chain to export yet" }` |
| `take_shared` | — | `{ ok: true, text }` — the Android share inbox, one read clears it |
| `storage_window` | — | `{ ok, created, existed, refused }` (see `src/daemon/storage-window.ts`) |
| `import_discover` | `candidates: string[]` | `{ ok: true, files: { path, kind, bytes }[] }` or `{ ok: false, error: "no chain" }` |
| `import_plan` | `candidates: string[]` | `{ ok: true, plan: { adds, conflicts } }` or `{ ok: false, error: "no chain" }` |

Those two `import_*` kinds are the only ones with that prefix in `main.ts`
today. There is no `import_apply`.

### Plan mode and goals

| Kind | Request data | Reply data |
| --- | --- | --- |
| `plan_mode` | `session?`, `enabled?`, `approve?` | `{ ok: true, session, enabled }` or `{ ok: false, error }`; appends a `plan_mode` event (`approve: true` records an approval) |
| `goal` | `text` | `{ ok: true }` or `{ ok: false, error: "no chain or empty goal text" }`; appends a `goal` event |
| `goal_update` | `id`, `status: "open" \| "done" \| "cancelled"`, `note?` | `{ ok: true }` or `{ ok: false, error }`; appends a `goal_update` event |

## 6. What the code does not do

Named so a client does not wait for them:

- **`peers` is typed but not handled.** `PeersRequest` exists in
  `control-protocol.ts`, but `control.ts` has no branch for it, so it falls into
  the generic request path and is answered
  `{ error: "unknown request: peers" }` — and only if the frame carries `req`.
  Peer ids come from `state.peers` instead.
- **A client `hello` is not a request.** `control.ts` has no branch for it
  either; without a `req` it gets no answer at all.
- **No auth, no TLS, no per-client identity.** Loopback is the security
  boundary; `ROAN_CONTROL_HOST` widens it on purpose.
- **No acknowledgement of `append`.** Nothing comes back except the broadcast
  echo of the stored event.
- **`new_session`, `rename_session`, `leave_chain`, `rename_node`, `checkpoint`
  and `rewind` never reply**, not even on failure (a blank title, an unknown
  node id or an unknown seq is dropped where it stands).
- **No `state` after `append`.** A message changes `head`; the daemon does not
  push a fresh `state` for it. Ask for `state` if you need the new head.
- **The frames are not independently versioned.** Control frames carry no `v`;
  only the chain frames do (literal `1`).
- **`docs/daemon.md` §2 is older than this file** where it says `peers` is always
  `[]`, `append` requires `event.type`, or `sendState()` is never called; the
  code above is current.

## 7. The SDK

`sdk/client.ts` is a dependency-free typed client over this port (the runtime's
global `WebSocket`; Node 22 has one). It is not part of `tsconfig`'s `src` tree;
`sdk/tsconfig.json` type-checks it and `tests/sdk-client.test.ts` runs it against
a fake server.

```ts
import { connect, ControlClientError } from "./sdk/client.js";

const client = connect("ws://127.0.0.1:6769/ws");
const state = await client.state();              // DaemonState
await client.send("hello", state.activeSession ?? undefined);
await client.append({ id: "mine", data: { text: "with image", image: { mime: "image/png", data } } });
const result = await client.export("chain");     // { ok, path, shared, count } | { ok: false, error }
const plan = await client.request("plan_mode", { enabled: true });
client.close();
```

| Member | Behaviour |
| --- | --- |
| `connect(url, options?)` | Returns at once; the first call waits for the handshake. `options`: `timeoutMs` (default 15 000), `socket(url)`, `newId()` |
| `state()` | Sends `{ t: "state" }`, resolves with `DaemonState` |
| `append(event)` | Writes `{ t: "append", event }`; resolves with the event id once written, not when the daemon stored it |
| `send(text, session?)` | `append` with `{ text, session? }` |
| `export(what)` | `export` request; a refusal is returned as `{ ok: false, error }`, not thrown |
| `request(kind, data?)` | Any other request kind from §5; `data` is returned untouched |
| `request(kind, data, correlation)` | Same, with the reply address chosen by the caller — needed for `tool_approve`, whose request data (`req`) is the correlation id |
| `close()` | Closes the socket; anything in flight rejects with `closed` |

Every failure is a `ControlClientError` with a `code`:
`connect_failed` (the port did not answer), `timeout` (no reply in time),
`closed` (the socket went away), `bad_reply` (a `control_error`, a non-JSON
frame, or a request the client refuses to send). There is no reconnect loop and
no outbox: a caller that wants either builds it on top.
