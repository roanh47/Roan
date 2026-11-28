# How this is tested

The suite is `node --test` over compiled JavaScript, plus three helpers under
`src/testing/` — a scripted provider, a chain fixture builder, a two-node harness
— that keep tests in one process and off the network.

## Tests sit next to the code

Test files are `*.test.ts` next to the module they cover, for example `src/chain/verify.test.ts`,
`src/sync/replicate.test.ts`, `src/sync/ws-transport.test.ts`,
`src/protocol/redact.test.ts`, `src/providers/factory.test.ts`,
`src/tools/{search,glob,secrets-scan,shell-allowlist}.test.ts`,
`src/turn/lock.test.ts` and `src/testing/{stub-provider,two-node}.test.ts`. They use
`node:test` and `node:assert/strict`; no runner dependency, no mocking library.

The placement is not stylistic. `tsconfig.json` sets `rootDir` and `include` to
`src`, and `npm test` is `node --test dist/**/*.test.js`; a test outside `src` falls
outside `rootDir`, fails typecheck and is never compiled. Two older files,
`tests/store.test.ts` and `tests/turn.test.ts`, sit in a top-level `tests/` the
build does not see; `npm test` does not pick them up.

## Running them

```
npm run typecheck
npm run build
npm test
```

`build` comes first: `npm test` executes `dist/`, so editing a test and running
`npm test` alone re-runs the previous compile. `typecheck` is `tsc --noEmit`, the
faster loop when you only want errors. `node --test` runs every matching file and
exits non-zero if any failed.

Tests build their own world: an in-memory `EventStore` closed in a `finally`, or a
`fs.mkdtemp` directory under `os.tmpdir()` removed in a `finally`.

## The stub provider

`src/testing/stub-provider.ts` starts a scripted server on an ephemeral loopback port.

- `createStubProvider(script)` resolves to `{ baseUrl, port, requests, enqueue,
  close }`; `baseUrl` already ends in `/v1` and `close()` frees the port.
- One route, `POST /v1/chat/completions`, one queue entry per request: `chunks`
  (text deltas, tool-call fragments, a `usage` chunk) or a scripted HTTP `error`. A
  dry queue answers with fixed text, so a forgotten `enqueue` is not a timeout.
- Tool-call fragments split as real streams split them: `id` and `name` first,
  `arguments` after; `usage` follows `finish_reason`. `requests` records method,
  URL and parsed body in arrival order.

It binds `127.0.0.1` and checks no credentials. The wire format is the one
`src/providers/openai-compat.ts` consumes — `data: {...}` frames and a closing
`data: [DONE]` — and `stub-provider.test.ts` drives it with `fetch` and asserts on
those frames. No test drives the adapter through it yet, so its SSE reassembly and
tool-call merging remain unverified; `factory.test.ts` only constructs adapters.

## Chain fixtures

`src/testing/chain-fixture.ts` builds synthetic chains against the `Event` contract
in `src/protocol/types.ts` (`v`, `chain`, `seq`, `id`, `node`, `ts`, `type`, `data`).

- `buildChain(count, { sender, startSeq })` returns contiguous events with ids
  `id-<seq>` and fixed timestamps; bad counts and senders throw by name.
- `withGap`, `withDuplicate` and `withReordered` take `(events, atSeq)`, return a
  new array and break one invariant each: a missing event, one id on two seqs, two
  swapped seqs.
- Nothing in the module touches a store or the filesystem.

`src/chain/verify.test.ts` still builds events with local `makeEvent()`,
`healthyChain()` and `codes()` helpers: healthy chain, empty chain, gap mid-chain,
gap at seq 1, duplicate id, out-of-order events, 50-event chain; `verifyStore` runs
against a real in-memory store.

## The two-node harness

`src/testing/two-node.ts` runs two real on-disk `EventStore`s in sibling temp
directories, wraps each in the `NodeStore` interface replication speaks, and links
them with a synchronous in-memory duplex transport driven by the real `replicate()`.

- `withTwoNodes(async (a, b) => { ... })` creates both stores and removes the
  directories afterwards, also on throw. `TEST_CHAIN` is `"gesprek"`.
- `a.append(type, data)` catches up from the peer, then writes at `head() + 1`. The
  gate makes `Promise.all([a.append(...), b.append(...)])` safe: concurrent calls,
  serial writes. A hard conflict is never resolved by picking a winner, so two first
  appends to empty stores would both claim seq 1; the harness catches up first.
- `syncBothWays(a, b)` replicates both directions and throws on a conflict, a
  protocol error or a failed session. `assertConverged(a, b)` throws naming node,
  seq and id when heads, contiguity or events differ.

`two-node.test.ts` uses it for an append on either side, concurrent appends
converging on contiguous seqs, a diverged chain being named, and temp cleanup on
success and on throw. `ws-transport.test.ts` goes further with a real
`WebSocketServer` on `127.0.0.1:0`, waiting on a 3-second `until()` poll instead of
sleeps: a loopback socket on one machine, not a two-machine test.

## No test holds a real key

- Nothing in the suite reads a provider key from the environment. The only
  `process.env` read in any test is `TMPDIR` in `secrets-scan.test.ts`.
- `factory.test.ts` builds its `AdapterConfig` with a placeholder key and a base
  URL on a closed port, and only constructs adapters.
- Strings that look like keys (`sk-…`) appear in `redact.test.ts` and
  `secrets-scan.test.ts` because masking them is what is under test.
- The stub accepts any `Authorization` header and needs no key. A new test that
  seems to need a real key is wrong; point it at the stub.

## What is not covered

- **Real network flakiness.** Retry, backoff and timeout paths never meet a slow or
  disappearing peer: loopback never shows a lossy link or a half-open socket.
- **The GUI.** `web/` and `src-tauri/` have no tests; nothing asserts a component
  renders or the shell opens a window.
- **Real Android devices.** The mobile nodes in `docs/mobile.md` — foreground
  service, notification channel, share intake — have no test and no device in the loop.
- **Real provider APIs.** `anthropic.ts` and `google.ts` are never sent to.
  `openai-compat.ts` reaches only the stub, so no test has seen a live endpoint.
- **Packaging and signing.** Checksums and semver have unit tests; notarization,
  winget submission and the release artifacts are manual steps from `docs/packaging.md`.
- **Discovery and transport setup.** `src/net/` (Tailscale status, peer addressing)
  is not tested.
