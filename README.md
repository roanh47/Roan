# Roan

One agent, several machines. Your PC, your server and your phone sit next to each
other, all running the same agent, all holding the same conversation. No central
server, no head agent, no cloud account.

```
        PC                    SERVER                PHONE
┌────────────────┐    ┌────────────────┐    ┌────────────────┐
│ agent loop     │    │ agent loop     │    │ agent loop     │
│ tools: files   │◄──►│ tools: services│◄──►│ tools: itself  │
│ the chain      │    │ the chain      │    │ the chain      │
└────────────────┘    └────────────────┘    └────────────────┘
                     direct, encrypted
```

## What it is

- **One interface, and it is an app.** Roan is a desktop app for Windows, macOS and
  Linux, and a phone app for Android, built from one UI codebase. You open it like any
  other application.
- **A chain.** An append-only log of numbered events that every node keeps in full.
- **A peer network.** Nodes find each other directly over Tailscale. Nothing in the
  middle forwards or stores your session.

## What it is not

- Not a hosted service. There is no account to create and no server to trust.
- Not a remote control. Your phone isn't a window onto your PC; it runs the agent.
- Not a chat product. It exists to do work on your machines, for one person.

## Principles

**Everyone is equal.** No node owns a session. A session has an ID and exists on
every node; the only thing that is local is the turn, and only while it runs.

**The turn runs where you type.** Type on the phone and the phone calls the model.
There is no dispatch to a central brain.

**Tools are distributed, sessions are not.** The PC has your project folders, the
server has your containers, the phone has what it can do itself. A tool call that
can't run locally becomes a request to a node that can.

**One writer per turn.** Only the node running the turn appends events, so the order
is unambiguous without anyone being in charge. Two nodes can't start a turn at the
same time; that's a lock, not ownership.

**Joining adopts the chain.** When you join a chain, its data becomes yours. Your
device doesn't push its local state into the chain; only creating a new chain seeds
it, once per person.

**Secrets stay local.** Keys are encrypted at rest and never enter the chain.

## Home folder

Everything the agent is lives in `~/.roan/`:

```
~/.roan/
├── config.json
├── AGENTS.md            how it behaves
├── SOUL.md              tone and boundaries
├── USER.md              who you are
├── MEMORY.md            what it remembers
├── memory/              daily notes
├── skills/              procedures that load only when relevant
├── mcp/
├── secrets/             per machine, encrypted
├── workspace/           per machine — scratch work, caches
└── synced-workspace/    identical everywhere — projects live here
```

`workspace/` and `synced-workspace/` are siblings, so moving a file between them is
an `mv` on one disk. Anything in `synced-workspace/` appears on every machine;
anything you take out of it disappears there too.

Same paths on all systems:

```
LINUX      /home/<user>/.roan/
MACOS      /Users/<user>/.roan/
WINDOWS    C:\Users\<user>\.roan\
ANDROID    /storage/emulated/0/.roan/
```

## Repository layout

```
src/types.ts       AgentEvent union, ChatMessage, Tool, ToolContext
src/tools.ts       read_file, write_file, list_dir, run_shell + path guard
src/provider.ts    OpenAI-compatible streaming client (SSE + tool calls)
src/agent.ts       the loop: model → tool → model, emits AgentEvent
src/config.ts      environment variables and the system prompt
src/daemon/main.ts the daemon the app starts; no user-facing command
```

## First launch

You open the app, and the first screen offers two things: **create a chain**, or
**join one** with a code from a device that already has it.

Provider and model are picked in the app, from the models.dev catalog (235 providers,
8,940 models). Nothing is configured by environment variable.

The daemon that keeps the chain in sync is started by the app and keeps running when
you close the window.

## Status

| Part | State |
|------|-------|
| Core loop, streaming, tools | **working** |
| The chain (events, storage, catch-up) | planned |
| Remote tools between nodes | planned |
| Desktop app (exe/dmg/AppImage) | planned |
| Phone app (apk) | planned |
| Distribution (binaries, npm) | planned |

Neither app is built yet, so there is no way in for now. Nothing is published.

## Requirements for the full setup

- Node 22+ on every machine that runs the agent.
- Tailscale, so the nodes can reach each other anywhere without a relay you operate.
- Syncthing for `synced-workspace` (on Android: Syncthing-Fork).

## License

MIT.

## Running it

The quickest way to a Roan you can open is the web UI on one machine:
`scripts/webui.mjs` serves the bundle and proxies the socket to the daemon.
See [docs/webui.md](docs/webui.md).
