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

- **One interface.** A web UI served by every node, identical on a laptop, a server
  and a phone. The Android app is that same UI in a shell. There is no terminal UI.
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
src/index.ts       argument parsing, one-shot mode
```

## Running it today

```bash
npm install
npm run build
node dist/index.js -p "list the files here"
```

Configuration is by environment variable:

```
ROAN_API_URL    OpenAI-compatible endpoint, default http://127.0.0.1:1234/v1
ROAN_API_KEY    optional, may be empty for a local model
ROAN_MODEL      model name, default local-model
```

Requires Node 22 or newer.

## Status

| Part | State |
|------|-------|
| Core loop, streaming, tools, one-shot mode | **working** |
| The chain (events, storage, catch-up) | planned |
| Remote tools between nodes | planned |
| Web UI | planned |
| Android app | planned |
| Distribution (binaries, npm) | planned |

The web UI does not exist yet, so `-p` is the only way in for now. Nothing is
published.

## Requirements for the full setup

- Node 22+ on every machine that runs the agent.
- Tailscale, so the nodes can reach each other anywhere without a relay you operate.
- Syncthing for `synced-workspace` (on Android: Syncthing-Fork).

## License

MIT.
