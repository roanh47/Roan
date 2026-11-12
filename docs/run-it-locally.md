# Run it locally

Checked on Node 22.22.2. There is no CLI yet: the daemon is a local WebSocket
server, started by hand while the app is unbuilt.

## Build

```sh
npm install
npm run build       # tsc -p tsconfig.json, writes dist/
npm run typecheck   # tsc --noEmit, when you only want errors
```

`package.json` says Node >=22, but `src/chain/store.ts` imports `node:sqlite`,
unflagged only from Node 22.13; the `ExperimentalWarning: SQLite is an
experimental feature` line on stderr is harmless.

## Start the daemon

```sh
npm run dev                  # tsx src/daemon/main.ts, no build
node dist/daemon/main.js     # after npm run build
```

Both bind `127.0.0.1:7411` and print one stderr line:

```
roan daemon: waiting for a chain (control port 7411)
```

That means `~/.roan/secrets/identity.json` does not exist; once a chain exists
the line names the chain and node. It runs in the foreground; Ctrl-C stops it.

No flag creates a chain. The app sends `{ t: "create_chain" }`, or
`{ t: "join_chain", code }`, over `ws://127.0.0.1:7411/ws`; the daemon answers
`state`, then `chain` with an `invite` code, then `hello` and `state`. The socket
is local and unauthenticated: any process that can open 7411 can run turns.

## Where ~/.roan lives

`~/.roan` is the root; `ROAN_HOME` overrides it (meant for tests, not users).

| path | contents |
| --- | --- |
| `config.json` | provider settings, read only: `baseUrl`, `model`, `apiKey`, `provider`. Missing file means `http://127.0.0.1:1234/v1`, `local-model`, an empty key, `lmstudio`. |
| `secrets/identity.json` | `nodeId`, `chainId`, `token`, `createdAt`, mode 0600. Its existence ends onboarding. |
| `workspace/chain.db` | one SQLite file for every chain, created once an identity exists. |
| `workspace/` | scratch space, plus `chain.db`. |
| `synced-workspace/` | the turn's cwd; tools read and write here. |

Startup creates `secrets/`, `workspace/` and `synced-workspace/`; it never
creates `config.json`. Throwaway instance:

```sh
ROAN_HOME=/tmp/roan-scratch node dist/daemon/main.js
```

## Ports 7411 and 7412

| port | env var | today |
| --- | --- | --- |
| 7411 | `ROAN_CONTROL_PORT` | the only listener: WebSocket on `127.0.0.1`. The path is not inspected, so `/ws` and `/` both connect. |
| 7412 | `ROAN_PEER_PORT` | not bound. It only goes into an invite code as the port a peer should dial; `main.ts` never starts the peer server. |

`ROAN_PEER_HOST` (default `127.0.0.1`) fills the same invite. If 7411 is taken
the daemon exits 1 with `listen EADDRINUSE ... 127.0.0.1:7411`.

## Tests

```sh
npm run build   # tests execute dist/, so build first
npm test        # node --test dist/**/*.test.js
```

466 tests in 75 suites pass here in about a second. No test touches the network
or a real key; provider tests use `src/testing/stub-provider.ts`. Tests live
beside the code as `*.test.ts` and must be under `src/` — the two files in
`tests/` are not compiled, so `npm test` skips them. More in `docs/testing.md`
(harness) and `docs/daemon.md` (protocol).
