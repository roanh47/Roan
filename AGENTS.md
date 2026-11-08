# AGENTS.md

Instructions for any agent working in this repository. Read this before changing
code. The design rationale lives in `PLAN.md`; this file is the rulebook.

## What this is

Roan is a terminal-first agent harness that becomes one agent spread over several
machines. Today it is the core loop, four tools, a streaming provider client and an
Ink TUI. Everything else — the chain, remote tools, the web UI, the app — is planned
and described in `PLAN.md`.

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

## Layout

```
src/types.ts       AgentEvent union, ChatMessage, Tool, ToolContext
src/tools.ts       read_file, write_file, list_dir, run_shell + path guard
src/provider.ts    OpenAI-compatible streaming client (SSE + tool calls)
src/agent.ts       the loop: model → tool → model, emits AgentEvent
src/config.ts      environment variables and the system prompt
src/index.ts       argument parsing, one-shot mode, TUI entry
src/tui/app.tsx    Ink view; owns no logic
```

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
- Restructure `src/` or rename an event type without updating `PLAN.md`.
- Add a feature that assumes a server exists.
- Add a "prompts" folder or similar third home for instructions. Always true →
  `AGENTS.md`; sometimes true → a skill.

## Definition of done

Typecheck clean, build clean, exercised end-to-end against the stub (not just
compiled), and docs updated when behaviour changed. A change that was never run is
not done.
