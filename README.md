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

**Everything is synced.** Settings, keys, sign-ins, skills and memory are the
same on every device: connect a service or change a setting once and it holds
everywhere. Only the local `workspace/` folder, and anything outside `.Roan`,
belongs to one device.

## Where Roan lives on a device

Two places, and they have nothing to do with each other.

**1. The app** is the program. It goes wherever that system keeps programs.
Nothing of yours is in it; an update replaces it completely.

**2. `.Roan`** is everything that is yours: settings, keys, conversations,
memory, skills, files. It is always in your home folder, on every system, and the
installer never touches it.

So Roan is not "installed in `.Roan`". The app is installed like any other app,
and `.Roan` is its data.

### 1. The app

| System | Where the app goes | You get it as |
|---|---|---|
| Windows | `C:\Program Files\Roan\` | `.msi` installer |
| macOS | `/Applications/Roan.app` | `.dmg`, drag to Applications |
| Linux | wherever you save the file; it is not installed | `.AppImage`, one file you run |
| Android | the app's own private storage | `.apk` |

The app contains the window you see and the daemon that does the work. The app
starts the daemon, and the daemon keeps running when you close the window.

### 2. `.Roan`, your data

The same folder name on every system:

```
LINUX      /home/<user>/.Roan/
MACOS      /Users/<user>/.Roan/
WINDOWS    C:\Users\<user>\.Roan\
ANDROID    /data/data/dev.roan/files/.Roan/   (inside the app's private storage)
```

What is in it:

```
~/.Roan/
├── config.json          model, provider, key, every switch in Settings
├── providers.json       your saved providers
├── SOUL.md              who Roan is: tone and boundaries
├── IDENTITY.md          its name and voice
├── AGENTS.md            how it writes
├── USER.md              who you are
├── MEMORY.md            what it learned
├── cron.json            scheduled tasks
├── hooks.json           your hooks
├── memory/              memory notes
├── skills/              procedures that load only when relevant
├── mcp/                 connections and their sign-ins
├── imported/            conversations brought in from elsewhere
├── synced-workspace/    files that should be on every device
├── workspace/           this device only: where Roan builds
├── state/               how syncing works: this device's copy of the chain
└── secrets/             how syncing works: the id that tells your devices apart
```

### What is synced

**Everything is synced.** Every setting, key, sign-in, token, permission, skill,
memory and conversation is the same on all your devices. Change something on
your phone and it is changed on your PC and your server.

Two things are not synced, and that is the whole list:

- **`workspace/`**, the local workspace. Roan clones, installs and builds here,
  and none of that should be copied to your phone.
- **Anything outside `.Roan`** (a project in `~/code`, your Documents). It
  belongs to that device.

`state/` and `secrets/` are how the syncing itself works: each device's own copy
of the chain, and the id that tells your devices apart. Nothing you set or save
lives there, and you never open them.

### The two workspaces

- **`workspace/`** is local. Roan works here: scratch files, a cloned repository,
  a build.
- **`synced-workspace/`** is shared. A file goes here only when it should be on
  every device.

They are siblings, so moving a file from one to the other is a move on one disk.
A file put in `synced-workspace/` appears on every device; taking it out removes
it there too.

Roan is told all of this at the start of every conversation, and to ask when it
is not clear where something belongs. It does not put work in `.Roan` itself:
that folder holds who it is.

More detail per file is in [docs/storage.md](docs/storage.md).

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
| Desktop app (msi/dmg/AppImage) | **working** — Tauri shell, daemon as a sidecar; AppImage proven, macOS dmg not built yet |
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
