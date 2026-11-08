# AGENTS.md

Instructions for any agent working in this repository. Read this before changing
code. The design rationale lives in `PLAN.md`; this file is the rulebook.

## What this is

Roan is one agent spread over several machines. Today it is the core loop, four
tools and a streaming provider client. Everything else — the chain, remote tools,
the apps — is planned and described in `PLAN.md`.

The interface is an app you open: a desktop app on your machines, the same app on
your phone.

The product is called Roan.

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
   and `src/types.ts` must not import anything that renders. The only way out of the
   core is the `AgentEvent` stream.
6. **Secrets never travel.** Not in events, not in the session log, not in a commit,
   not in an error message. A key that appears in a log line is a leaked key.
7. **Everything happens in the app.** Roan ships as a desktop app (Windows, macOS,
   Linux) and a phone app (Android), built from one UI codebase. Starting, joining,
   inviting a machine, choosing a provider and a model, and approving a tool call are
   screens in that app. Dev scripts (`npm run build`, `typecheck`) are for us.
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
src/daemon/main.ts started by the app; no user-facing command
```

The core has no renderer: UI code lives in `web/` and the app shell in `src-tauri/`.

The interface ships as apps: one desktop app and one phone app built from the same
frontend code, bundled inside the binary. It is opened, not visited.

`PLAN.md` is the design document. `README.md` is the front door. If behaviour
changes, both change in the same commit.

## Commands

```bash
npm run typecheck   # tsc --noEmit, must be clean
npm run build       # tsc -p tsconfig.json → dist/
npm test            # node --test, unit + two-node scenarios
```

These are developer tools, not a product interface: nothing here is a command the
user runs. End-to-end checks drive the daemon directly in a test with a stub
OpenAI-compatible server, never a shipped `-p` flag. Never put a real API key in a
test or a script.

## Code conventions

- TypeScript strict, plus `noUncheckedIndexedAccess`. Indexed access is `T | undefined`;
  handle it instead of asserting.
- ESM with NodeNext: relative imports end in `.js`, even in `.ts` files.
- No `any`. Use `unknown` and narrow it.
- Throw `Error` with a message that says what failed and on what input. The caller
  turns it into an `error` event; the core never prints.
- No `console.log` in the core. Output is events.
- One concern per file. When a file passes ~200 lines, split it rather than adding a
  section.
- New dependency? Ask first. `ws` is the only runtime dependency so far.

## Do not

- Commit `dist/` or `node_modules/`; both are ignored on purpose.
- Commit keys, tokens, personal absolute paths, or server addresses.
- Add a second interface of any kind. There is one: the app.
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