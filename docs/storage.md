# Where everything lives

One page for the question "where does this actually go". Every device has its own
`~/.roan`, keeps a full copy of the chain, and syncs with the others as a peer.
Nothing here points at a server, because there is no server.

## The home directory, per platform

| Platform | Path | Who makes it |
| --- | --- | --- |
| Linux | `/home/<user>/.roan/` | `ensurePaths()` |
| macOS | `/Users/<user>/.roan/` | `ensurePaths()` |
| Windows | `C:\Users\<user>\.roan\` | `ensurePaths()` |
| Android | `/data/data/dev.roan/files/.roan/` | `RoanNode.ensureStarted()` sets `ROAN_HOME` |

On Android that path is **app-private storage**, not `/storage/emulated/0/.roan`.
The app runs its own daemon inside its own sandbox, so the home is inside the
sandbox too. Nothing else can read it without root, and that is why the app serves
its own log on `127.0.0.1:7413` instead of asking you to fetch a file. `ROAN_HOME`
overrides the path everywhere, which is how the tests and a second instance on one
machine stay apart.

## Inside the home

```
~/.roan/
├── config.json         baseUrl, model, provider, apiKey      ── travels
├── AGENTS.md           how the agent behaves                 ── travels
├── SOUL.md             tone and boundaries                   ── travels
├── USER.md             who you are                            ── travels
├── MEMORY.md           what it remembers                      ── travels
├── memory/             daily notes                            ── travels
├── skills/             procedures, loaded on demand            ── travels
├── mcp/                MCP definitions                         ── travels
├── cron.json           schedules                               ── travels
├── hooks.json          shell hooks per turn                    ── travels
├── secrets/
│   └── identity.json   nodeId, chainId, token                 ── stays here
├── workspace/
│   ├── chain.db        every event of every chain             ── stays, but is rebuilt from peers
│   └── parked/<ts>/    what an adoption moved aside            ── stays
└── synced-workspace/   the turn's working directory            ── travels, per file
```

## What travels, and how

Three kinds of content move between devices, and they move differently.

**1. The env — as one snapshot.** Everything above marked *travels* is packed into
a single `env` event: path, kind, size, sha256 and content per file, plus a hash
over the whole set. The daemon publishes it when the hash changes and adopts a
peer's snapshot when that one is newer. Because the whole set is the unit, the
chain's copy wins as a set: a file you deleted locally that the snapshot still
has comes back, and a file the snapshot does not have is parked rather than
merged. Adoption moves the previous state to `workspace/parked/<timestamp>/` with
a `park.json` manifest — move, never delete.

**2. The workspace — as events per file.** `synced-workspace/` is scanned on a
timer. A changed file becomes a `workspace` event carrying its content; an
arriving one is written to disk. Two nodes writing the same path both keep their
version: the loser is written next to it as `<name>.conflict-<node>-<seq>`.

**3. The conversation — as the chain itself.** Messages, assistant turns, tool
calls and results, sessions, checkpoints and node announcements are events in
`chain.db`. Every node holds all of them; catch-up happens at `hello` and every
later append is forwarded. Two nodes writing the same `seq` with different ids is
a hard conflict: that link stops and says so. Nothing is picked for you.

## What stays on the machine, and why

- **`secrets/identity.json`** — the node id and the peer token. The token is what
  proves a peer belongs to this chain; sending it along would hand anyone who
  reads the log the keys to the chain. A joining device gets its own.
- **`workspace/chain.db`** — the local projection of the chain. It is rebuilt from
  peers, so it never has to be copied.
- **`workspace/parked/`** — the record of what an adoption replaced. Local by
  definition.

The API key is **not** in this list: it lives in `config.json`, that file is part
of the env, so the key travels. That is deliberate — a device that cannot call the
model cannot run a turn, and a node that cannot run a turn is a screen, not a peer.

## Ports

| Port | Bound to | What |
| --- | --- | --- |
| `7411` | `127.0.0.1` | the control socket: the app talks to its own daemon |
| `7412` | `0.0.0.0` | peers: token handshake, then events both ways |
| `7413` | `127.0.0.1` | Android only: the app serving its own daemon log |

## Keeping two instances apart on one machine

`ROAN_HOME=/tmp/roan-b ROAN_CONTROL_PORT=7441 ROAN_PEER_PORT=7442 node dist/daemon/main.js`
gives a second, fully separate node with its own chain, its own identity and its
own database. That is how two devices are simulated without a second device.
