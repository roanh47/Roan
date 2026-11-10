# Tools

A tool is the only way the model reaches the outside world. It is a plain object:
a name, prompt text, a JSON-schema for its arguments, and an async `run()`.

## The Tool interface

Declared in `src/types.ts`:

```ts
export interface ToolContext {
  cwd: string;
  signal?: AbortSignal;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;                         // JSON schema, sent to the provider verbatim
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}
```

- `name` is unique across the registry; `buildRegistry` throws on duplicates.
- `description` and `parameters` are prompt material: they go to the model
  unchanged via `toToolSpecs()` in `src/tools.ts`, so write them for the model,
  not for the docs. `required` is the only schema keyword the loop relies on.
- `run()` returns a string, which becomes the `tool` message content. Throw an
  `Error` to report failure; the message is shown to the model as the result.
- `ctx.cwd` is the workspace root; `ctx.signal` aborts when the turn is cancelled.

## Implementing a tool

`src/tools/*.ts` holds the implementations (`git.ts`, `http.ts`, `patch.ts`,
`search.ts`, `tree.ts`). They export typed functions and result shapes, not
`Tool` objects, so they stay usable outside the agent. The wrapper is what adds
the schema and binds the workspace:

```ts
// src/tools/wordcount.ts
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Tool } from "../types.js";
import { isInsideWorkspace } from "./policy.js";

export const wordCount: Tool = {
  name: "word_count",
  description: "Count words in a file inside the workspace.",
  parameters: {
    type: "object",
    properties: { path: { type: "string", description: "Relative to the workspace" } },
    required: ["path"],
  },
  async run(args, ctx) {
    const rel = String(args["path"] ?? "");
    if (!isInsideWorkspace(ctx.cwd, rel)) {
      throw new Error(`path escapes the workspace: ${rel}`);
    }
    const text = await fs.readFile(path.resolve(ctx.cwd, rel), "utf8");
    return `${text.split(/\s+/).filter(Boolean).length} words`;
  },
};
```

Register it by adding it to the array the agent passes to `buildRegistry`, next
to `builtinTools` in `src/tools.ts`, and add a `word_count` entry to the policy.
A policy that names an unknown tool makes `buildRegistry` throw, so the two lists
cannot drift.

## Path guard

Every path argument is resolved inside the workspace, at two layers:

1. **In the tool** — `resolveInside(cwd, p)` in `src/tools.ts` resolves, compares
   with `path.relative`, and throws on `..` or an absolute path outside `cwd`.
   New wrappers use `isInsideWorkspace` from `policy.ts` for the same check.
2. **In the policy** — `decide(policy, name, args)` walks the arguments four
   levels deep, collects values under path-like keys (`path`, `file`, `dir`,
   `cwd`, `target`, `source`, `dest`, …), and resolves each, following symlinks
   for the part that exists. It denies paths outside `policy.workspace`, under
   `extraDenyDirs`, inside the protected `secrets`, `.ssh` or `.gnupg`
   directories at any depth, and every `*.pem` file.

A path violation always wins: even a tool the policy sets to `allow` is denied
when one of its arguments points outside. The first violation is returned as the
reason, so the UI can show it verbatim (`path "…" escapes the workspace …`).

## Decisions

`src/tools/policy.ts` exports `Decision = "allow" | "ask" | "deny"`, a `Policy`
(`tools`, `workspace`, optional `extraDenyDirs`), `decide()`, `defaultPolicy()`
and `isInsideWorkspace()`. Rules are name-based first, then refined by paths:

| decision | meaning | model | UI | registry |
| --- | --- | --- | --- | --- |
| `allow` | runs without asking | tool is offered and may be called | runs the call, shows the result | in `allowed()` |
| `ask` | needs a human yes | tool is offered and may be called | blocks on a confirmation prompt before `run()` | in `allowed()` and `needsApproval()` |
| `deny` | never runs | tool is not offered at all | nothing to approve; may list it as denied | only in `all()`; `get()`/`has()` return `undefined`/`false` |

Defaults with no explicit entry: write-capable names (`write_file`,
`apply_patch`, `run_shell`, `delete_file`) become `ask`; everything else is
`deny`. `defaultPolicy()` allows reading, listing, searching and web access, and
asks for the four write tools.

## Registry

`buildRegistry(tools, policy)` in `src/tools/registry.ts` evaluates names once, at
build time, and returns `all()`, `allowed()`, `needsApproval()`, `get()` and
`has()`. Hidden (`deny`) tools are still reachable through `all()` for the UI, but
lookup fails, so a hallucinated name cannot reach the loop. The per-call gate is
`decide(policy, name, args)`: the registry decides whether a tool exists for the
agent, `decide()` decides whether this particular call may run.
