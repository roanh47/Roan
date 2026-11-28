# The daemon

The daemon is the process that owns this machine's chain: it opens the SQLite
store, holds the identity, listens for peers, and runs one turn at a time. It is
not a server in the network sense. Everything below is what `src/daemon/` does
today; section 6 lists what it does not do yet.

## 1. Startup

`src/daemon/main.ts` is the entry point. Three things start it:

- the Tauri desktop shell, as a sidecar (`spawn_daemon` in
  `src-tauri/src/lib.rs`, binary `roan-daemon`; output is forwarded to the
  shell's stderr and the child is killed on window exit);
- the Android service, through `RoanNode.kt`, which sets `ROAN_SHELL=android`
  before handing the event loop to Node;
- `npm run dev` (`tsx src/daemon/main.ts`) on a dev machine.

`src/daemon/autostart.ts` can start and stop a detached daemon after probing the
control port, but nothing imports it: the sidecar and the systemd unit in
`docs/app/webui.md` are the real startups.

`main()` runs in this order (`main.ts`, `main()`):

1. `resolvePaths()` and `migrateLegacyHome(paths)` — a pre-capital `~/.roan` is
   renamed to `~/.Roan` once, before anything opens the database.
2. `setWebConfigSource()`, `loadPlugins(paths.home)` — bundled plugins first,
   then `<home>/plugins/<id>/plugin.json`. A broken plugin is reported and
   skipped; boot never depends on one.
3. `migrateStateSplit(paths)` — `workspace/chain.db` (+ `-wal`, `-shm`) moves to
   `state/chain.db` once; `workspace/` becomes the agent's own desk.
4. `ensureBootstrapFiles(paths)` — on a fresh home it writes `SOUL.md`,
   `IDENTITY.md` and `AGENTS.md`, never over an existing file.
5. `ensurePaths(paths)` — creates `home`, `secrets`, `workspace`,
   `synced-workspace`, `state`.
6. `loadSettings(paths)` — provider settings from `config.json`. If
   `settings.engine` is `hermes` and no `hermes` binary answers, it falls back to
   `builtin` and says so in one log line.
7. The agent's context: `MemoryStore`, `SkillLibrary`, `allTools()` +
   `contextTools()`, and an `McpRuntime`. `agentContext.prompt()` rebuilds the
   system prompt per turn from `SOUL.md`, `AGENTS.md`, memory, user profile and
   the skill index.
8. `loadIdentity(paths)` — with `secrets/identity.json` the session is
   `{ identity, store: EventStore.open(paths.database) }`; without it `session`
   stays `null` and `DaemonState.onboarding` is `true`.
9. `startReplication()` (only with a session) — peer listener, discovery, live
   broadcast of events a peer appends.
10. `startEnvLoop()`, `startWorkspaceLoop()`, `startCron()` (only with a
    session) — the three timers that keep this copy equal to the chain.
11. `startControlServer({ port, host, ... })` — one HTTP server on one port
    (`127.0.0.1` by default) that serves `web/dist`, upgrades `/ws` to the
    control socket and carries `/peer` for sync.
12. Peer sync is mounted on that same server (`/peer`), then one line to
    stderr: `roan daemon: waiting for a chain (port N, http://host:N)` or
    `roan daemon: chain …, node …, port N (http://host:N)`.

### The one port

There is one listener. `http://host:PORT/` is the built UI, `/ws` is the
control socket, `/peer` is peer sync, `/log` is the daemon's own output and
`/healthz` answers whether the UI was built. Nothing else opens a socket: no
webui proxy process, no log server, no second peer port.

| variable | default | meaning |
| --- | --- | --- |
| `ROAN_PORT` | `6769` | the one port (alias: `ROAN_CONTROL_PORT`) |

The shell never sets the port or the host. `RoanNode.kt` (Android), the Tauri
sidecar (desktop) and the systemd unit (server) pass only what they alone know:
`ROAN_HOME`, `ROAN_LOG_PATH`, `ROAN_ENGINE`, `ROAN_SHELL`. Port, bind address and
the control gate are the daemon's defaults, identical on every platform —
overriding them per platform is how the phone ended up listening on loopback
while its own invite named the tailnet address.
| `ROAN_HOST` | `0.0.0.0` | bind address — every interface, so loopback and the tailnet both work (alias: `ROAN_CONTROL_HOST`); `lan`/`tailscale` resolve to an interface |
| `ROAN_WEB_DIST` | `web/dist` next to the package root | where the built UI lives |
| `ROAN_ALLOW_REMOTE_CONTROL` | unset | `1` lets a non-loopback caller open `/ws` |
| `ROAN_PEER_ADVERTISE` | unset | comma-separated hosts to put in the invite instead of the derived ones |
| `ROAN_DISCOVERY` | on | `off` disables the Tailscale scan |
| `ROAN_HOME` | `~/.Roan` | state root |
| `ROAN_SHELL` | unset | `android` changes shutdown behaviour (section 4) |

`ROAN_PEER_BIND` is gone as a listen switch: peering uses the one bind. A
`lan`/`tailscale` value in `ROAN_HOST` is resolved through the same code, and
`ROAN_PEER_ADVERTISE` still overrides what an invite carries.

### What one port costs

Loopback stays the default, so by default nothing off this machine can reach
the daemon — including peers. Sync needs a wider bind
(`ROAN_HOST=tailscale` or `lan`), and then:

- `/peer` still requires the chain token in the upgrade (`Authorization: Bearer
  …` or `?token=`) and the chain id in the hello, exactly as before;
- `/ws` refuses every non-loopback caller with `403` unless
  `ROAN_ALLOW_REMOTE_CONTROL=1`. The control socket has no token of its own —
  that is the missing piece, and it is not pretended otherwise;
- the static UI is public to whoever can reach the port. It is a bundle, not
  data: the chain only moves over `/ws`, which is gated.

When the bind is loopback the invite is `null`: there is no address another
machine can dial, and a code without one fails at the first handshake.
`ROAN_PEER_ADVERTISE` is the way to say "I am at this address anyway" (a proxy,
a port forward, or two daemons on one machine).

On the other side, `web/src/App.tsx` derives the socket from
`window.location` when the page came over http(s), so the served UI dials
`ws://<same host>/ws` by itself; `window.__ROAN__.socket` still wins. The native
shells (Tauri desktop, Android) load the bundle from their own origin and fall
back to a hardcoded loopback URL — that literal must be the new port, or the
shell must inject `window.__ROAN__`.

## 2. The control protocol

One WebSocket, JSON text per frame, local only — this is not the peer protocol
and a peer never sees these frames. `control.ts` routes, `control-protocol.ts`
types, `docs/api.md` documents every kind.

Client → daemon:

| frame | fields | what happens |
| --- | --- | --- |
| `state` | `t` | reply with `StateResponse` |
| `create_chain` | `t` | `onCreate()`, then the reply + `greet()`; twice is still one chain |
| `join_chain` | `t`, `code` | `onJoin(code)`, then the reply + `greet()` |
| `append` | `t`, `event` | `event.data.text` must be a non-empty string; the daemon picks the session, keeps `event.id` as the echo id, broadcasts, runs a turn |
| `new_session` | `t`, `title?` | starts a conversation, never touches the old one |
| `rename_session` | `t`, `session`, `title` | appends a `session_title` event |
| `rename_node` | `t`, `node`, `name` | appends a fresh `node` announcement |
| `checkpoint` | `t`, `label?` | appends a `checkpoint` event at the head |
| `rewind` | `t`, `seq` | starts a new conversation from that point; nothing is deleted |
| `leave_chain` | `t` | archives identity + chain, then stops into onboarding |
| anything else | `req?` | goes to `onRequest(kind, data, reply)`; the answer is `{ t: "reply", id, data }` with `id` echoing `req` |

`append` is no longer strict about `event.type`: only `event.data.text` is
checked, and the daemon writes the `message` event itself — with
`data.session` resolved here and the client's id reused, so the app's pending
bubble clears on the echo instead of showing the message twice.

The request kinds (`main.ts`, `onRequest`):

`workspace_list`, `workspace_read`, `workspace_write`, `cron_list`,
`cron_save`, `regenerate`, `cancel_turn`, `skills_list`, `tools_list`,
`mcp_list`, `mcp_save`, `mcp_server_save`, `mcp_server_delete`, `tools_state`,
`tool_rule`, `tool_approve`, `tool_approval_reset`, `providers_list`,
`provider_save`, `provider_remove`, `provider_pick`, `models_list`,
`models_search`, `settings_save`, `model_set`, `checkpoints_list`, `export`,
`storage_window`, `take_shared`, `import_discover`, `import_plan`, `steer`,
`session_archive`, `session_delete`, `goal`, `goal_update`, `effort`,
`plan_mode`. Anything else is answered `{ error: "unknown request: <kind>" }`.

Daemon → client, three plain replies:

```
{ t: "state", data: { onboarding, chain, node, head, peers, nodes, invite,
                      model, provider, sessions, activeSession } }
{ t: "chain", chain, node, invite? }        // invite only after create_chain
{ t: "control_error", message }
```

`peers` is `peerList()` from `peers.ts`: the node ids linked right now, inbound
and outbound. `nodes` is the roster folded from `node` events, each with
`live: true` for this machine, for a connected peer, or for one that spoke
within the presence TTL. `head` is `store.head(chain)`, `0` for an empty chain.
`invite` is a v2 join code carrying every dialable host.

Daemon → client, chain frames go through `encodeFrame` from
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

Every event the daemon appends itself is broadcast as `{ t: "append", event }`
through `onAppend`, including `turn_start` and `turn_end` (the turn lock writes
through an adapter that calls `onAppend`). Events a peer appends are broadcast
the same way by the replication watcher, and a `session` / `session_title` event
from anywhere also triggers a fresh `state`.

The socket has no authentication: any local process that can open the port can
send these frames, including `append`.

## 3. Where state lives

All of it hangs off `RoanPaths` in `paths.ts`, rooted at
`process.env["ROAN_HOME"] ?? join(homedir(), ".Roan")`.

| `RoanPaths` field | path | written by |
| --- | --- | --- |
| `home` | `~/.Roan` | `ensurePaths`, `migrateLegacyHome` |
| `secrets` | `~/.Roan/secrets` | `ensurePaths` |
| `workspace` | `~/.Roan/workspace` | `ensurePaths`; holds `cron-state.json` |
| `syncedWorkspace` | `~/.Roan/synced-workspace` | `ensurePaths`; the turn's `cwd` |
| `state` | `~/.Roan/state` | `ensurePaths`, `migrateStateSplit` |
| `database` | `~/.Roan/state/chain.db` | `EventStore` — one SQLite file, every chain |
| `configFile` | `~/.Roan/config.json` | `loadSettings` reads `baseUrl`, `model`, `apiKey`, `provider`, `effort`, `engine`; `saveSettings` writes it |
| `identityFile` | `~/.Roan/secrets/identity.json` | `saveIdentity`, mode `0600` |

Other files in the home, written by the handler that needs them:
`cron.json` (`cron_save`; also part of the env), `hooks.json` (read at every
turn), `mcp.json` (`mcp_save`), `providers.json` (`provider_save`/`_remove`/
`_pick`), `plugins/<id>/plugin.json`, `exports/` (`export`), and
`shared-inbox.txt` next to the home (`take_shared`, the Android share slot).

`loadSettings` returns `DEFAULTS` when the file is missing or not JSON, and
falls back per field when a value is not a string. `loadIdentity` returns
`null` when the file is missing, and throws `identity file is missing <key>`
when a required field is absent. `identity.json` holds `nodeId`, `chainId`,
`token`, `createdAt`.

`history.ts` stores nothing: `historyFromEvents` maps a slice of the chain into
`ChatMessage[]` — `message` to `user`, `assistant` to `assistant`,
`tool_result` to `tool` with `tool_call_id: replay-<id>`. `tool_call` is not
replayed. `runTurn` prefers `sessionMessages(events, session)` when a session
is known, so a turn only sees its own conversation.

`log-rotate.ts` stores nothing. `parsePolicy` and `planRotation` are pure;
`logging.ts` wraps them into a scrubbed, rotated `roan.log`, but nothing imports
`logging.ts` — the daemon writes to stderr only.

## 4. One turn end to end

1. The app sends `{ t: "append", event: { id, data: { text, session?, image? } } }`.
2. `control.ts` validates the text, lifts `data.session`, `event.id` (echo id)
   and an optional image (mime + base64 under 1.6 M), then calls
   `onMessage(text, session, echoId, image)`.
3. `main.ts` `runMessage` resolves the conversation (`resolveSession`, else a
   new one titled after the first words), appends the `message` event with the
   client's id, broadcasts it, and auto-titles a conversation on its first
   message (`autoTitleFor` → `session_title`).
4. It folds goals (`foldGoals` → `goalContext`) into the front of the system
   prompt, runs `turn_start` hooks from `hooks.json`, and creates an
   `AbortController` plus a steer inbox before calling `runTurn` (not awaited).
5. `runTurn` calls `acquire()`, which reads the last `1_000` events, derives the
   open turn, and compare-appends `turn_start` with `data: { ttlMs }` at the
   next free seq. If another node holds the turn it appends an `error` event —
   `<owner> is already working on this chain` — and returns without calling the
   model.
6. It builds history (`sessionMessages`), compacts past 40 messages into a
   digest attached to the prompt (`compactMessages`), and gates the tool list:
   in plan mode only `planModeTools` are offered, the rest are answered with a
   refusal sentence (`planModeForbidden` / `planModeRefusal`), and the turn runs
   on the builtin loop even when the device normally uses the hermes engine.
7. `new Agent({ provider, tools, systemPrompt, cwd, history, effort, signal,
   onBeforeRequest })` drives `model → tool → model`. Its events become chain
   events: `tool_start` → `tool_call` `{ name, args }`, `tool_end` →
   `tool_result` `{ name, ok, output }`, `error` → `error` `{ message }`.
   Assistant text is accumulated, not streamed to the chain.
8. A steer arriving mid-turn is only injected after a round's tool results and
   before the next request (`onBeforeRequest`), never on top of the live
   question. It is recorded as a `message` event flagged `steer`, so it stays in
   the conversation where it was typed.
9. When the loop returns, the accumulated text is appended once as `assistant`
   `{ text }` if it is not blank; an empty return appends an `error` saying so.
10. `finally` calls `release()`, which appends `turn_end` — through the same
    adapter, so the turn's `usage` (tokens and cost, when the provider reported
    them) rides on that event and the app can print a line under the answer.
11. Back in `runMessage`: `activeTurn`/`activeSteer` are cleared, the line
    `notify:turn-done` goes to stderr (the Android service tails it), the
    `turn_end` hooks run, and `distilMemories` writes at most three durable
    facts as `memory` events plus a folded `MEMORY.md`. A failed distil is
    logged and never breaks the turn.

Shutdown: `SIGINT`/`SIGTERM` stop discovery and the peer links and exit.
`stopDaemon("left the chain")` closes the control server and peers; on
`ROAN_SHELL=android` it returns without `process.exit`, because exiting from the
node thread there aborts the whole app.

## 5. Peers, discovery and the background loops

`startReplication()` (once per process) builds a `ChainNodeStore` over the
store, watches applied events (presence, broadcast to the app windows, workspace
and blob application, `serveDelegation` for `run_on_node`), then
`startPeers({ store, token, host: bindListenHost(bind), port: PEER_PORT })` —
`startPeerServer` mounted on `control.mountUpgrade("/peer", …)` — the same
HTTP server, so there is no peer port — replication handshake included, plus an outbound
`PeerClient` per joined peer with backoff.

With `ROAN_DISCOVERY` not `off`, `startDiscovery` asks Tailscale for the
network every 20 s, probes the peer port on every address, and calls `addPeer`
for whatever answers. The invitation is not a security boundary: the handshake
refuses a wrong token or a different chain.

Three timers keep this device's copy equal to the chain:
`startEnvLoop` (10 s, adopts a peer's env snapshot and publishes this one, then
announces the node), `startWorkspaceLoop` (5 s, scan → `workspace` and `blob`
events for changed files, applies events that arrive), and `startCron` (30 s,
`dueJobs` from `cron.json`, each job runs as a turn in a conversation named
after it; `cron-state.json` in `workspace/` is per machine, so two awake
devices do not both fire).

## 6. Not built yet

- The control socket has no authentication of its own. It is refused for
  non-loopback callers, but any local process can open it, and
  `ROAN_ALLOW_REMOTE_CONTROL=1` opens it to the network with no token on the
  frame.
- There is no handler for the `peers` request type (`control-protocol.ts`
  declares it); the live list rides on `state` instead. A `{ t: "peers" }` frame
  is answered `unknown request: peers`.
- The client's `hello` / `haveSeq` is ignored; catch-up is always the first
  `10_000` events.
- `health.ts` and `diagnostics.ts` exist and have no caller: there is no
  `health` or `diagnostics` request kind, and both modules are untested, so the
  daemon cannot report its own state beyond `state`.
- `logging.ts` (scrubbed, rotated `roan.log`) and `log-rotate.ts` are still not
  called by the daemon. `/log` serves the last 64 KB of what it wrote to stderr,
  kept in memory; there is no file and no log port.
- The HTTP server exists now, but `webhooks` (`dispatch.ts`, `sign.ts`) and
  `connectors` (`github.ts`) are still only modules: no route reaches them, so
  both start nothing.
- `autostart.ts` (probe, spawn, stop, pid file) is not imported by the app.
- `tool_req` / `tool_res` events exist and `serveDelegation` answers them for
  `run_on_node`, but there is no forwarding hop: a tool call the target node
  cannot run is not relayed a second time.
- `onJoin` writes the chain id and token from the code; it does not park an
  existing identity aside before overwriting it (`AGENTS.md` rule 10).
