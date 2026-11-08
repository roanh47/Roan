# AGENTS.md

Instructions for any agent working in this repository. Read this before changing
code. The design rationale lives in `PLAN.md`; this file is the rulebook.

## What this is

Roan is one agent spread over several machines. Today it is the core loop, four
tools and a streaming provider client. Everything else — the chain, remote tools,
the web UI, the app — is planned and described in `PLAN.md`.

There is no terminal UI and there will not be one: the interface is a web UI served
by every node, so a laptop, a server and a phone show the same thing.

The package is `roan-cli`; the command is `roan`.

## Ground rules

These are not style preferences. Breaking one of them means the design is broken,
even if the tests pass.

1. **No central service.** No node owns a session, and no component may assume it
   does. There is no gateway, no hub, no dispatcher.
2. **The session is an event chain.** Ordered events with a sender. A session has an
   ID, not an address. Nothing may address a session "on machine X".
3. **One writer per turn.** Only the node running the turn appends events. The others
   read and send requests. Two nodes may not run a turn at the same time.
4. **The turn runs where the user typed.** Never forward a whole turn to another
   machine to "execute it there". Tools are distributed, sessions are not.
5. **The core is renderer-agnostic.** `src/agent.ts`, `src/provider.ts`, `src/tools.ts`
   and `src/types.ts` must not import `ink`, `react`, or anything that renders. The
   only way out of the core is the `AgentEvent` stream.
6. **Secrets never travel.** Not in events, not in the session log, not in a commit,
   not in an error message. A key that appears in a log line is a leaked key.
7. **One UI, and it is not a terminal one.** The interface is the web UI, and it is
   the same on every device — PC, server, phone. The Android app is that same UI in a
   shell. **Do not build a terminal UI in this project**: no Ink, no curses, no
   readline renderer, no per-platform layouts. A terminal is one of the machines you
   run the agent on, not a different product.
8. **Everything is shared.** Anything that changes how the agent behaves travels in
   the chain: config, skills, MCP definitions, identity files, tool settings. Stays
   local only when it physically can't be shared: caches, logs, running processes,
   secrets. "Local" is the exception and it needs a reason.
9. **Joining adopts the chain.** When you join a chain, that chain's data becomes
   yours: its sessions, its env, its skills. Your device does not merge its local
   state into the chain and does not push it up. The only way local data becomes
   chain data is **creating a new chain**, and that happens once per person. Before
   joining replaces the local state, park it aside so nothing is lost silently.

## Layout

```
src/types.ts       AgentEvent union, ChatMessage, Tool, ToolContext
src/tools.ts       read_file, write_file, list_dir, run_shell + path guard
src/provider.ts    OpenAI-compatible streaming client (SSE + tool calls)
src/agent.ts       the loop: model → tool → model, emits AgentEvent
src/config.ts      environment variables and the system prompt
src/index.ts       argument parsing, one-shot mode
```

The Ink TUI from the first build has been **removed**, along with the `ink` and
`react` dependencies — see ground rule 7. Don't bring it back in any form, and don't
add a renderer to the core.

The interface comes later as a web UI served by every node, so the same screens run
on a laptop, a server and a phone.

`PLAN.md` is the design document. `README.md` is the front door. If behaviour
changes, both change in the same commit.

## Commands

```bash
npm run typecheck   # tsc --noEmit, must be clean
npm run build       # tsc -p tsconfig.json → dist/
npm run dev         # tsx src/index.ts, no build step
npm start           # node dist/index.js
```

End-to-end check without a real provider: run a stub OpenAI-compatible server that
streams one tool call, then

```bash
ROAN_API_URL=http://127.0.0.1:8899/v1 ROAN_MODEL=mock node dist/index.js -p "test"
```

Never put a real API key in a test or a script.

## Code conventions

- TypeScript strict, plus `noUncheckedIndexedAccess`. Indexed access is `T | undefined`;
  handle it instead of asserting.
- ESM with NodeNext: relative imports end in `.js`, even in `.ts` files.
- No `any`. Use `unknown` and narrow it.
- Throw `Error` with a message that says what failed and on what input. The TUI turns
  it into an `error` event; the core never prints.
- No `console.log` in the core. Output is events.
- One concern per file. When a file passes ~200 lines, split it rather than adding a
  section.
- New dependency? Ask first. The current two runtime dependencies (`ink`, `react`) are
  the entire budget for this phase.

## Do not

- Commit `dist/` or `node_modules/`; both are ignored on purpose.
- Commit keys, tokens, personal absolute paths, or server addresses.
- Add a terminal UI, a curses screen, an Ink component or a platform-specific
  layout. There is one interface, and it is the web one.
- Let a joining device push its local state into the chain. Join adopts; only a new
  chain seeds.
- Restructure `src/` or rename an event type without updating `PLAN.md`.
- Add a feature that assumes a server exists.
- Add a "prompts" folder or similar third home for instructions. Always true →
  `AGENTS.md`; sometimes true → a skill.

## Definition of done

Typecheck clean, build clean, exercised end-to-end against the stub (not just
compiled), and docs updated when behaviour changed. A change that was never run is
not done.
