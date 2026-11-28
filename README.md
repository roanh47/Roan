# Roan

One agent, several machines. Your PC, your server and your phone sit next to each
other, all running the same agent, all holding the same conversation. No central
server, no head agent, no cloud account.

Roan is its own harness. Its inspiration is Hermes Agent.

```
        PC                    SERVER                PHONE
┌────────────────┐    ┌────────────────┐    ┌────────────────┐
│ agent loop     │    │ agent loop     │    │ agent loop     │
│ tools: files   │◄──►│ tools: services│◄──►│ tools: itself  │
│ the chain      │    │ the chain      │    │ the chain      │
└────────────────┘    └────────────────┘    └────────────────┘
                     direct, encrypted
```

## What is in this branch (0.0.23)

The branch turns the design into a working node: the daemon (chain, peers,
discovery, one turn at a time), the desktop and Android shells, plan mode,
auto-memory, goals, effort levels, usage per turn, schedules, steer, export,
slash commands, the tool guard (risky shell lines always ask, tool hooks),
the workspace panel, the CLI and the SDK — each wired through the
daemon or the app, each with tests.

A second set of modules is written and tested but **not yet wired into a turn or
a screen**: deep research, side questions and message queueing, the safety layer,
the knowledge store, computer use, image generation, the voice
loop and speech capture, webhooks and connectors, and the git panel. The
documents below say per feature which half it is in.

Three documents carry the detail:

- [docs/api.md](docs/api.md) — the control port frame by frame, read from
  `control.ts` / `control-protocol.ts` / `main.ts`, plus the SDK's subset.
- [docs/a2a.md](docs/a2a.md) — why there is no agent-to-agent protocol here, and
  what covers the same need (webhooks, peer replication, read-only connectors).
- [docs/history/goals-progress.md](docs/history/goals-progress.md) — the ledger: feature by
  feature, what was built and which proof or test it rests on.

Per-concept status against every mainstream harness is in
[docs/history/feature-groups.md](docs/history/feature-groups.md); the reasoning per verdict is
[docs/feature-parity.md](docs/feature-parity.md).

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

**Secrets stay local.** Keys are meant to stay local and never enter the chain.
Today that rule is not held by the code: a key entered in the app is saved into
`config.json`, which travels in the env snapshot — see
[docs/security.md](docs/security.md) §1 for the exact path and TODO.md for the
open defect.

## Home folder

Everything the agent is lives in `~/.Roan/`:

```
~/.Roan/
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
LINUX      /home/<user>/.Roan/
MACOS      /Users/<user>/.Roan/
WINDOWS    C:\Users\<user>\.Roan\
ANDROID    /data/data/dev.roan/files/.Roan/   (app-private)
```

Where each of these lives, what travels between devices and what stays on the
machine is in [docs/storage.md](docs/storage.md).

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

Provider and model are picked in the app, from the live models.dev catalog
(300+ providers); nothing is configured by environment variable.

The daemon that keeps the chain in sync is started by the app and keeps running when
you close the window.

## Status

| Part | State |
|------|-------|
| Core loop, streaming, tools | **working** — `src/agent.ts`, `src/tools.ts` |
| The chain (events, storage, catch-up) | **working** — SQLite in `~/.Roan/state/`, replication over the peer port |
| Remote tools between nodes | **working** — `run_on_node` over `tool_req`/`tool_res` |
| Desktop app (exe/dmg/AppImage) | **working** — Tauri shell, daemon as a sidecar; AppImage proven, macOS dmg not built yet |
| Phone app (apk) | **working** — daemon in the apk via `libnode`, foreground service; the start on a real phone is not proven yet |
| Distribution (binaries, npm) | **partial** — CI builds four installers; no published release, no npm package |

What each part proves, and what is still open, is in
[docs/history/goals-progress.md](docs/history/goals-progress.md) and
[docs/history/feature-groups.md](docs/history/feature-groups.md). Nothing is published yet.

## Requirements for the full setup

- Node 22+ on every machine that runs the agent.
- Tailscale, so the nodes can reach each other anywhere without a relay you operate.
- Syncthing for `synced-workspace` (on Android: Syncthing-Fork).

## License

MIT.

## Running it

The quickest way to a Roan you can open is the web UI on one machine:
`scripts/webui.mjs` serves the bundle and proxies the socket to the daemon.
See [docs/app/webui.md](docs/app/webui.md).
