# cli

`roan` — the headless face of the app. One command, one socket, no
dependencies: it speaks the daemon's control port through `sdk/client.ts` and
nothing else.

```
npx tsx cli/roan.ts state
npx tsx cli/roan.ts send "summarise TODO.md"
npx tsx cli/roan.ts export chain --out ~/chain.jsonl
```

## Commands

| Command | What it does |
| --- | --- |
| `state` | The chain, node, head, peers, model and active conversation |
| `sessions` | Every conversation in this chain, with message counts |
| `send <text> [--session id]` | Appends a message and runs the turn |
| `new [--title text]` | Starts a conversation and prints its id |
| `export <chain\|session> --out <path>` | Copies the daemon's export to `<path>` |

`--help` prints the same table with the exit codes; that text is the
documented interface, and `tests/cli.test.ts` fails if a verb disappears from
it.

## Options and exit codes

- `--url <ws-url>` — the control port. Without it: `ROAN_CONTROL_URL`, then
  `ROAN_HOST`/`ROAN_PORT` (the old `ROAN_CONTROL_*` names still work), then
  `ws://127.0.0.1:6769/`.
- `--json` — the daemon's answer as JSON, for scripts.
- `--` — everything after it is text, so a message may start with a dash.

`0` the command did what it said · `1` the daemon refused, was unreachable, or
the export did not land · `2` the arguments were wrong and nothing was sent.
Failures are one line on stderr, never a stack trace.

## Notes

`new_session` is the one fire-and-forget frame in the protocol: the daemon
starts a conversation and sends no reply. `cli/link.ts` writes that single
frame on the socket it hands to `ControlClient` — when the sdk grows a
`notify()`, that can go. Because a `state` request carries no id, the greeting
the daemon sends on connect can take the first waiter slot, so `new` reads the
roster back until it actually gained a conversation instead of trusting one
reading.

## Build and typecheck

The CLI sits outside `tsconfig.json`'s `src` tree and imports the sdk, so it has
its own config with the repo root as `rootDir`:

```
npx tsc -p cli/tsconfig.json --noEmit   # typecheck
npx tsc -p cli/tsconfig.json            # emit to build/cli/ (build/cli/cli/roan.js)
```

Tests live in `tests/cli.test.ts` and drive every verb against a fake daemon on
`127.0.0.1` — never a real chain: `npx tsx --test tests/cli.test.ts`.
