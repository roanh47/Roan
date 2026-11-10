# The daemon

The daemon is the process that owns this machine's chain: it opens the SQLite
store, holds the identity, and runs one turn at a time. It is not a server in
the network sense. Everything below is what `src/daemon/` does today; section 5
lists what it does not do yet.

## 1. Startup

`src/daemon/main.ts` is the entry point. `src-tauri/src/lib.rs` only boots
Tauri — it spawns no child process, so the app does not currently start the
daemon. The only script in `package.json` that launches it is the dev script
`npm run dev` (`tsx src/daemon/main.ts`).

`main()` runs in this order:

1. `resolvePaths()` and `await ensurePaths(paths)` — creates the directories.
2. `await loadSettings(paths)` — provider settings from `config.json`.
3. `await loadIdentity(paths)` — if `secrets/identity.json` exists, the session
   is `{ identity, store: EventStore.open(paths.database) }`; otherwise it stays
   `null` and `DaemonState.onboarding` is `true`.
4. `startControlServer({ port: CONTROL_PORT, ... })`, which binds
   `127.0.0.1` (the `host` default in `control.ts`) and resolves with the port
   actually bound.
5. One line to stderr: `roan daemon: waiting for a chain (control port N)` or
   `roan daemon: chain …, node …, control port N`.

Ports come from the environment: `ROAN_CONTROL_PORT` (default `7411`),
`ROAN_PEER_PORT` (default `7412`, used only inside an invite code),
`ROAN_PEER_HOST` (default `127.0.0.1`). `ROAN_HOME` overrides the state root.
Provider settings never come from the environment; they come from `config.json`.

On the other side, `web/src/App.tsx` builds a `ChainClient` against
`ws://127.0.0.1:7411/ws` unless `window.__ROAN__.socket` says otherwise. The
`/ws` path is not inspected by the server; any path connects.

## 2. The control protocol

One WebSocket, JSON text per frame, local only — this is not the peer protocol
and a peer never sees these frames. Types live in `control-protocol.ts`.

App → daemon:

| frame | fields | handler |
| --- | --- | --- |
| `state` | `t` | reply with `StateResponse` |
| `create_chain` | `t` | `onCreate()`, then reply + `greet()` |
| `join_chain` | `t`, `code` | `onJoin(code)`, then reply + `greet()` |
| `append` | `t`, `event` | append a user message, broadcast, run a turn |
| `hello` | `t`, `v`, `chain`, `node`, `haveSeq` | ignored |

`append` is strict: `event.type` must be `"message"`, `event.data.text` must be
a non-empty string, and the id is `event.id` when it is a string, else
`` `${st.node}-${Date.now()}` `` from the current `DaemonState`.

Daemon → app, three plain replies:

```
{ t: "state", data: { onboarding, chain, node, head, peers } }
{ t: "chain", chain, node, invite? }        // invite only after create_chain
{ t: "control_error", message }
```

`peers` is typed `readonly string[]` and is always `[]` in `main.ts`. `head` is
`store.head(chain)`, `0` for an empty chain.

Daemon → app, chain frames go through `encodeFrame` from
`src/protocol/codec.ts`, which validates and version-checks them:

```
{ t: "hello", v: 1, chain, node, haveSeq }
{ t: "events", events: Event[] }
{ t: "append", event: Event }
```

On connect, `greet()` sends `hello` + `state` + one `events` frame with
`store.read(chain, 1, 10_000)` — the first ten thousand events, not the ones the
client says it is missing. With no store it sends only `state`, and
`onboarding` is `true`.

The socket has no authentication: any local process that can open the port can
send these frames, including `append`.

## 3. Where state lives

All of it hangs off `RoanPaths` in `paths.ts`, rooted at
`process.env["ROAN_HOME"] ?? join(homedir(), ".roan")`.

| `RoanPaths` field | path | written by |
| --- | --- | --- |
| `home` | `~/.roan` | `ensurePaths` |
| `secrets` | `~/.roan/secrets` | `ensurePaths` |
| `workspace` | `~/.roan/workspace` | `ensurePaths` |
| `syncedWorkspace` | `~/.roan/synced-workspace` | `ensurePaths`; the turn's `cwd` |
| `database` | `~/.roan/workspace/chain.db` | `EventStore` — one SQLite file, every chain |
| `configFile` | `~/.roan/config.json` | `loadSettings` reads `baseUrl`, `model`, `apiKey`, `provider` |
| `identityFile` | `~/.roan/secrets/identity.json` | `saveIdentity`, mode `0600` |

`loadSettings` returns `DEFAULTS` when the file is missing or not JSON, and
falls back per field when a value is not a string. `loadIdentity` returns
`null` when the file is missing, and throws `identity file is missing <key>`
when a required field is absent. `identity.json` holds `nodeId`, `chainId`,
`token`, `createdAt`.

`history.ts` stores nothing: `historyFromEvents` maps a slice of the chain into
`ChatMessage[]` — `message` to `user`, `assistant` to `assistant`,
`tool_result` to `tool` with `tool_call_id: replay-<id>`. `tool_call` is not
replayed.

`log-rotate.ts` stores nothing either. `parsePolicy` and `planRotation` are pure
and return `renames` / `remove`; no daemon code calls them and `paths.ts` has no
log path. The daemon writes to stderr only.

## 4. One turn end to end

1. The app sends `{ t: "append", event: { type: "message", data: { text } } }`.
2. `control.ts` appends the `message` event, broadcasts
   `{ t: "append", event: stored }` to every client, then calls `onMessage(text)`.
3. `main.ts` `runMessage` returns if there is no session. Otherwise it calls
   `runTurn({ store, chain, node, provider, cwd: paths.syncedWorkspace,
   systemPrompt: SYSTEM_PROMPT, onAppend }, text)` and does not await it.
4. `runTurn` calls `acquire(asTurnStore(store), chain, node)`: it reads the last
   `1_000` events, derives the open turn, and compare-appends `turn_start` with
   `data: { ttlMs }` at the next free seq. If another node holds the turn, it
   appends an `error` event — `<owner> is already working on this chain` — and
   returns without calling the model.
5. It builds history with `historyFromEvents(store.read(chain, 1, 10_000))` and
   constructs `new Agent({ provider, tools: builtinTools, systemPrompt, cwd,
   history, onEvent })`.
6. `agent.send(text)` drives `model → tool → model`. Its events become chain
   events: `tool_start` → `tool_call` `{ name, args }`, `tool_end` →
   `tool_result` `{ name, ok, output }`, `error` → `error` `{ message }`.
   Assistant text is accumulated, not streamed to the chain.
7. When `send` returns, the accumulated text is appended once as
   `assistant` `{ text }` if it is not blank.
8. `finally` calls `release(turns, chain, node)`, which appends `turn_end`; a
   throw there is swallowed because the turn already ended.

Events appended by `runTurn`'s own `append` helper — `tool_call`,
`tool_result`, `error`, `assistant` — go through `onAppend`, so every open
window receives `{ t: "append", event }` for them. `turn_start` and `turn_end`
are written through `asTurnStore`, which never calls `onAppend`, so a connected
window only sees them when it reconnects.

## 5. Not built yet

- The desktop shell does not start or supervise the daemon, and there is no
  port handshake — the client hardcodes `7411`.
- No handler for the `peers` request; `DaemonState.peers` is always `[]`.
- The daemon starts no peer listener. `startPeerServer` in
  `src/transport/server.ts` is never called here, and `ROAN_PEER_HOST` /
  `ROAN_PEER_PORT` only fill the invite string.
- `tool_req` / `tool_res` are unused: no remote tools, no forwarding.
- `onJoin` writes the chain id and token from the code but dials nothing and
  pulls nothing. It also overwrites an existing `identity.json` without parking
  the old state aside (`AGENTS.md` rule 9).
- The client's `hello` / `haveSeq` is ignored; catch-up is always the first
  `10_000` events.
- No authentication on the control socket.
- The replayed history already contains the message just appended, and
  `Agent.send` pushes the same text again, so the model sees it twice.
- `turn_start` / `turn_end` are the only lifecycle events written; no `env`
  events. `ControlServer.sendState()` is exported and never called.
- `log-rotate.ts` is policy only: no log file is opened, written or rotated.
