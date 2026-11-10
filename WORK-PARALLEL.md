# Parallel backlog

Each batch is ten independent jobs. One batch per loop run. Every job owns files
nobody else touches; if a job needs a change in a shared file it says so in its
report instead of editing it.

Rules for every job:

- Create only the files named in your brief. Touch nothing else, ever.
- Run `npx tsc --noEmit` and only pay attention to errors in your own files.
- No `any`, ESM imports end in `.js`, no `console.log` in library code.
- Report the files you created and anything you had to decide.

## Batch 1 — tools (the agent's hands)

- [x] `src/tools/search.ts` — `grep(pattern, path, options)` over text files, capped
      results, binary files skipped, regex errors reported as text not thrown.
- [x] `src/tools/glob.ts` — `glob(pattern, cwd)` returning sorted relative paths,
      `**` support, ignore `node_modules` and `.git`, capped at 500.
- [x] `src/tools/patch.ts` — `apply_patch(path, oldText, newText)`, refuses when the
      old text appears zero or more than once, returns a unified diff.
- [x] `src/tools/http.ts` — `fetch_url(url)` returning status, content type and at most
      20k characters of text, with a timeout and a clear error per failure mode.
- [x] `src/tools/git.ts` — read-only `git_status`, `git_diff`, `git_log` for a repo path.
- [x] `src/tools/tree.ts` — `list_tree(path, depth)` printing a compact indented tree,
      capped, skipping ignored directories.
- [x] `src/tools/registry.ts` — a typed registry that takes tool definitions and hands
      the agent only those allowed by a policy object; unknown tool names rejected.
- [x] `src/tools/policy.ts` — a policy type: per tool `allow` | `ask` | `deny`, plus path
      rules (inside the workspace, never inside `secrets/`), with tests.
- [x] `src/tools/search.test.ts` + `src/tools/glob.test.ts` — real temp directories.
- [x] `src/tools/README.md` — one page: how a tool is defined, how policy applies.

## Batch 2 — providers

- [x] `src/providers/anthropic.ts` — messages API adapter with the same streaming
      interface the OpenAI adapter exposes; tool calls mapped both ways.
- [x] `src/providers/google.ts` — Gemini generateContent adapter, same interface.
- [x] `src/providers/openai-compat.ts` — extract the current OpenAI code so there is one
      adapter and `src/provider.ts` delegates to it.
- [x] `src/providers/factory.ts` — pick an adapter from a provider id in the catalog,
      with a clear error naming the provider when it is unsupported.
- [x] `src/providers/retry.ts` — exponential backoff on 429 and 5xx only, honouring
      `retry-after`, with a cap and jitter; never retries 400 or 401.
- [x] `src/providers/usage.ts` — count tokens from the response `usage` field and keep a
      running total per chain in memory.
- [x] `src/providers/models-filter.ts` — filter the catalog by tool support, context size
      and price ceiling, used by the picker.
- [x] `src/providers/display.ts` — provider and model labels, ordering, and a search
      function over id and name.
- [x] `src/providers/factory.test.ts` — every provider id in the catalog resolves or is
      explicitly unsupported; no silent failures. (Lives in `src/` because `tsconfig`
      only includes `src` and `npm test` runs `dist/**/*.test.js`.)
- [x] `src/providers/README.md` — how to add a provider in one page.

## Batch 3 — app UI (one component per file)

- [ ] `web/src/components/Onboarding.tsx` — the two-button screen, props only, no socket.
- [ ] `web/src/components/ProviderPicker.tsx` — searchable provider list from a prop.
- [ ] `web/src/components/ModelPicker.tsx` — models of the chosen provider, with context
      size and price shown.
- [ ] `web/src/components/InviteCard.tsx` — the code, a copy button, and a "send to
      another device" hint.
- [ ] `web/src/components/SettingsPanel.tsx` — provider, model, workspace path.
- [ ] `web/src/components/ToolCard.tsx` — one tool call and its result, collapsible.
- [ ] `web/src/components/ErrorBanner.tsx` — a daemon error, dismissible.
- [ ] `web/src/components/PeerList.tsx` — connected nodes, their tailnet name, head seq.
- [ ] `web/src/components/Shortcuts.tsx` — keyboard help overlay.
- [ ] `web/src/theme.ts` — the colour and spacing tokens, one source, used by new files.

## Batch 4 — chain, sync and storage edge cases

- [ ] `src/chain/export.ts` — export a chain to JSONL and import it into an empty store.
- [ ] `src/chain/gc.ts` — report what could be compacted; never deletes anything.
- [ ] `src/chain/verify.ts` — walk a chain and report gaps, duplicate ids, bad order.
- [ ] `src/sync/backfill.ts` — request a range by seq when a gap is detected.
- [ ] `src/sync/presence.ts` — track which nodes are live and their heads.
- [ ] `src/transport/metrics.ts` — per peer counters: frames in, out, reconnects, lag.
- [ ] `src/chain/lockfile.ts` — refuse to open the store twice from two processes.
- [ ] `tests/chain-verify.test.ts` — cases with a hole, a duplicate and a good chain.
- [ ] `src/chain/README.md` — the guarantee: append only, seq contiguous, one writer.
- [ ] `src/chain/schema.sql` — the schema as a real file the store reads, with a version.

## Families to extend when the list runs low

- mobile (Android manifest, foreground service for sync, share sheet, notifications)
- packaging (winget manifest, notarization, AppImage desktop file, icons at new sizes)
- docs (README sections, one page per subsystem, the invite flow explained with pictures)
- testing (integration: two daemons on one machine, join, conflict, resume)
- safety (secrets scanning, path guards, command allowlist, dry run for shell)
- polish (empty states, loading skeletons, error copy, dutch and english strings)
