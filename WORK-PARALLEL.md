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

- [x] `web/src/components/Onboarding.tsx` — the two-button screen, props only, no socket.
- [x] `web/src/components/ProviderPicker.tsx` — searchable provider list from a prop.
- [x] `web/src/components/ModelPicker.tsx` — models of the chosen provider, with context
      size and price shown.
- [x] `web/src/components/InviteCard.tsx` — the code, a copy button, and a "send to
      another device" hint.
- [x] `web/src/components/SettingsPanel.tsx` — provider, model, workspace path.
- [x] `web/src/components/ToolCard.tsx` — one tool call and its result, collapsible.
- [x] `web/src/components/ErrorBanner.tsx` — a daemon error, dismissible.
- [x] `web/src/components/PeerList.tsx` — connected nodes, their tailnet name, head seq.
- [x] `web/src/components/Shortcuts.tsx` — keyboard help overlay.
- [x] `web/src/theme.ts` — the colour and spacing tokens, one source, used by new files.

## Batch 4 — chain, sync and storage edge cases

- [x] `src/chain/export.ts` — export a chain to JSONL and import it into an empty store.
- [x] `src/chain/gc.ts` — report what could be compacted; never deletes anything.
- [x] `src/chain/verify.ts` — walk a chain and report gaps, duplicate ids, bad order.
- [x] `src/sync/backfill.ts` — request a range by seq when a gap is detected.
- [x] `src/sync/presence.ts` — track which nodes are live and their heads.
- [x] `src/transport/metrics.ts` — per peer counters: frames in, out, reconnects, lag.
- [x] `src/chain/lockfile.ts` — refuse to open the store twice from two processes.
- [x] `src/chain/verify.test.ts` — cases with a hole, a duplicate and a good chain.
      (In `src/` not `tests/`: `tsconfig` includes only `src`, so a test under
      `tests/` would never compile or be run by `npm test`.)
- [x] `src/chain/README.md` — the guarantee: append only, seq contiguous, one writer.
- [x] `src/chain/schema.sql` + `src/chain/schema.ts` — the schema as a real file the
      store reads, with a version. Wiring `EventStore.open` to `initSchema` and to
      `StoreLock.acquire` is a follow-up on `store.ts`, deliberately not done here.

## Batch 5 — safety, diagnostics, polish

- [x] `src/tools/secrets-scan.ts` + `src/tools/secrets-scan.test.ts` — scan a directory
      for likely secrets (provider keys, bearer tokens, private-key blocks, `.env`
      values); findings carry file, line, kind and a redacted preview only.
- [x] `src/tools/shell-allowlist.ts` + `src/tools/shell-allowlist.test.ts` — classify a
      command line as `allow` | `ask` | `deny` from a rule list; `deny` for things that
      escape the workspace or pipe into a shell, never guesses.
- [x] `src/tools/dry-run.ts` — describe what a mutating call would do (write, patch,
      shell) as a short human summary, executing nothing.
- [x] `src/protocol/redact.ts` + `src/protocol/redact.test.ts` — redact secrets and the
      home directory out of any string bound for an event or an error message.
- [x] `src/daemon/diagnostics.ts` — collect a redacted diagnostics object (versions,
      paths with home collapsed, chain head, provider id) with no secret fields.
- [x] `web/src/components/EmptyState.tsx` — the empty-session screen, props only.
- [x] `web/src/components/LoadingSkeleton.tsx` — skeleton rows for a pending turn.
- [x] `web/src/i18n.ts` — typed dutch and english strings for the app shell.
- [x] `docs/invite-flow.md` — the invite flow end to end, no screenshots claimed that
      do not exist.
- [x] `src/turn/lock.test.ts` — one writer per turn: second acquire fails, release
      allows reacquire, in-process only.

## Batch 6 — packaging, docs and polish

- [x] `src/packaging/winget.ts` — build a winget manifest object from a `PackageInfo`
      (id, name, publisher, version, licence, installer url + sha256); validate the id
      and version, escape the YAML strings, return a typed object, throw with the bad
      field named.
- [x] `src/packaging/desktop-entry.ts` — generate a Linux `.desktop` entry from app
      name, comment, exec path, icon and categories; quote/escape per the spec, mark
      `%U` only when the app takes urls, and round-trip parse its own output.
- [x] `src/packaging/notarize.ts` — describe the macOS notarization steps as data
      (`sign`, `zip`, `submit`, `staple`) from an app path plus the *names* of the
      credential env vars; never read or echo their values, refuse with a clear error
      when a required name is missing.
- [x] `src/packaging/icons.ts` — the icon size matrix per platform (Windows `.ico`
      sizes, macOS `.icns` sizes, Linux png sizes) and a function that reports which
      sizes are missing from a list of provided ones, sorted, no throwing on odd input.
- [x] `src/packaging/semver.ts` — strict `major.minor.patch` parse and bump, with
      optional prerelease kept intact; reject anything else with the offending string
      in the message. No dependency.
- [x] `src/packaging/checksums.ts` — sha256 over a list of files, returned sorted by
      path, plus a `sha256sum`-compatible listing string; skips nothing silently —
      missing files are reported per file.
- [x] `docs/packaging.md` — one page: what a release contains per platform, how it is
      signed, which steps are manual. No screenshots claimed that do not exist.
- [x] `docs/mobile.md` — the Android app plan: foreground service for sync, share
      sheet intake, notification channel, what is not built yet.
- [x] `web/src/components/ReleaseBadge.tsx` — app version and platform, props only,
      no socket, uses `web/src/theme.ts` tokens.
- [x] `web/src/components/CostBadge.tsx` — token count and cost from props, hidden
      when the provider reports no price, props only.

## Batch 7 — integration harness and the Android side

- [x] `src/testing/stub-provider.ts` + `src/testing/stub-provider.test.ts` — a scripted
      OpenAI-compatible streaming server on `node:http`: replies with a queued list of
      SSE bodies (text deltas, tool-call deltas, usage), records the requests it got,
      returns its base url and a `close()`. Test drives it with `fetch`.
- [x] `src/testing/chain-fixture.ts` — build a synthetic event chain in code (sender,
      seq, payload) with helpers to punch a gap, duplicate an id and reorder; used by
      the chain tests instead of hand-written literals.
- [x] `src/testing/two-node.ts` + `src/testing/two-node.test.ts` — an in-process
      two-node harness over temp dirs: two stores, replicate both ways, assert
      convergence and one-writer safety. Read `src/sync/replicate.ts` and
      `src/sync/memory-store.ts` first; do not change them.
- [x] `src/mobile/manifest.ts` + `src/mobile/manifest.test.ts` — build an Android
      manifest fragment as typed data (package, permissions, foreground-service
      declaration, share intent filter), escape attribute values, throw naming the
      bad field; test the escaping and the missing-field error.
- [x] `src/mobile/sync-service.ts` — the foreground service described as data
      (service name, channel id, start/stop actions, wake-lock note, retry policy),
      validated ids, no platform calls.
- [x] `src/mobile/share-intake.ts` — normalise a share-sheet payload (`text`, `url`,
      `file`) into an intake record with a title and a dedupe key; refuse empty
      payloads with a message that names what was missing.
- [x] `src/mobile/notifications.ts` — notification channels as data (id, name,
      importance, description) with the importance mapping validated and a
      `describeChannels()` used by the app shell.
- [x] `docs/testing.md` — one page: how the stub provider, fixtures and the two-node
      harness are used, what is covered and what is not. No claims about runs that
      did not happen.
- [x] `web/src/components/UpdateBanner.tsx` — "a newer version is available" banner,
      props only, dismissible, uses `web/src/theme.ts` tokens.
- [x] `web/src/components/MobileSyncCard.tsx` — the phone-sync status card (last sync,
      peers paired, a copy button), props only, no socket.

## Batch 8 — resume, tools for the loop, packaging and polish

- [x] `src/sync/resume.ts` + `src/sync/resume.test.ts` — pure `planResume(local, remote)`
      where each side is `{ head: number; have(id: string): boolean }`; returns
      `{ action: "none" | "pull" | "push" | "conflict"; from: number; reason: string }`.
      Equal heads → none; remote ahead → pull from local.head + 1; local ahead → push;
      overlapping tail with a mismatched id → conflict naming the seq. No I/O, no sockets.
- [x] `src/sync/dedupe.ts` + `src/sync/dedupe.test.ts` — `dedupeEvents(events)` keeps the
      first event per id in input order and returns `{ kept: Event[]; dropped: Event[];
      duplicateIds: string[] }` with ids sorted. Import the `Event` type from
      `./types.js`; import nothing else. Report a seq/id mismatch as dropped too.
- [x] `src/transport/heartbeat.ts` + `src/transport/heartbeat.test.ts` — heartbeat policy
      as pure data plus `isPeerStale(lastSeenAt, now, policy)` and `nextBeatAt(now, policy)`;
      clamp the interval to 1000–60000 ms and the miss threshold to 2–10, throwing with
      the bad field named; never schedules a timer itself.
- [x] `src/tools/todo.ts` + `src/tools/todo.test.ts` — an in-memory `TodoStore` for the
      session todo list: `add(text)`, `complete(id)`, `remove(id)`, `list()` returning a
      frozen copy, sequential ids; empty text and unknown ids throw with a message naming
      the input. No file system, no console.
- [x] `src/tools/read-many.ts` + `src/tools/read-many.test.ts` — `readMany(paths, options)`
      over `node:fs/promises`: per-path union `{ path, ok: true, text }` or
      `{ path, ok: false, error }`, results sorted by path, total characters capped
      (default 40000) with a truncation flag, binary files reported as an error rather
      than decoded. Tests use real temp directories under `node:os` tmpdir.
- [x] `src/packaging/appimage.ts` — an AppImage build plan as data: `AppDir` layout
      entries, an argv array per step (`appimagetool`, `linuxdeploy`), the `.desktop`
      file name and icon path; validate app name (no spaces or slashes) and version,
      throw naming the bad field, never build a shell string.
- [x] `src/packaging/changelog.ts` + `src/packaging/changelog.test.ts` — parse a Keep a
      Changelog style markdown into typed releases `{ version, date, sections: { kind;
      entries: string[] }[] }`, newest first; reject a bad `## [x] - date` heading with
      the offending line in the message, ignore text before the first release.
- [x] `src/mobile/pairing.ts` + `src/mobile/pairing.test.ts` — encode and decode a pairing
      payload (`code`, `tailnetName`, `chainId`, `expiresAt`) as a url-safe base64 JSON
      string; reject a payload that is expired, has a code shorter than 8 chars, or is
      not decodable, each with its own message; round-trip test.
- [x] `web/src/components/CommandPalette.tsx` — props only, no socket: a query input,
      filtered action list from a prop, arrow/enter handling through prop callbacks,
      empty state, uses `web/src/theme.ts` tokens. No new dependencies.
- [x] `docs/architecture.md` — one page: the core is renderer-agnostic, the chain is
      append-only with one writer, tools are distributed while sessions stay where the
      user typed, and joining adopts the chain. Reference the real files (`src/agent.ts`,
      `src/chain/store.ts`, `src/sync/replicate.ts`, `src/tools/policy.ts`). No claims
      about behaviour that the code does not have; no screenshots.

## Batch 9 — safety edges, sync reports, mobile links, polish

- [x] `src/tools/outline.ts` + `src/tools/outline.test.ts` — `outline(source, file)`
      listing top-level declarations (export, class, interface, type, function, const)
      as `{ kind, name, line }[]`, capped at 200, no parser dependency; tests pass
      source strings directly, no temp files.
- [x] `src/protocol/size.ts` + `src/protocol/size.test.ts` — `byteLength(text)` over
      UTF-8 and `truncateForEvent(text, maxBytes)` returning `{ text, truncated,
      originalBytes }`, cutting on a codepoint boundary with a marker and never
      splitting a surrogate pair; bad `maxBytes` throws naming the value.
- [x] `src/turn/cancel.ts` + `src/turn/cancel.test.ts` — a `CancelToken` with
      `cancel(reason)`, `isCancelled`, `reason`, `throwIfCancelled()` and listener
      registration; cancel is idempotent and keeps the first reason; no timers.
- [x] `src/sync/conflict-report.ts` + `src/sync/conflict-report.test.ts` — pure
      `describeConflict(local, remote)` where each side is `{ head: number; idAt(seq:
      number): string | undefined }`; returns `{ kind: "none" | "ahead" | "conflict";
      lines: string[] }` naming the first seq whose ids differ. No I/O.
- [x] `src/daemon/log-rotate.ts` + `src/daemon/log-rotate.test.ts` — `planRotation(
      files, policy)` over `{ path, size }[]` returning renames as data
      (`{ from, to }[]`, newest first), plus `parsePolicy` clamping maxFiles 1–50 and
      maxBytes; writes nothing.
- [x] `src/mobile/deeplink.ts` + `src/mobile/deeplink.test.ts` — parse and format
      `roan://join?code=…&chain=…&expires=…`; missing or malformed parts throw naming
      the field, round-trip test, reject a non-`roan:` scheme.
- [x] `src/packaging/updater.ts` + `src/packaging/updater.test.ts` — build an update
      feed entry `{ version, url, sha256, notes, mandatory }` as typed data, validate
      version via the existing `semver.ts` (import it, do not change it), require an
      https url and a 64-char hex sha256, throw naming the bad field.
- [x] `src/env/diff.ts` + `src/env/diff.test.ts` — pure `diffEnv(local, chain)` telling
      which keys join would adopt from the chain and which local keys are dropped
      (rule 9: join adopts, never merges); sorted output, no fs, secrets' *names* only.
- [x] `docs/security.md` — one page: secrets never travel, the tool policy, redaction,
      secrets scanning and the command allowlist, referencing the real files
      (`src/tools/policy.ts`, `src/protocol/redact.ts`, `src/tools/secrets-scan.ts`,
      `src/tools/shell-allowlist.ts`). No claims the code does not back.
- [x] `web/src/components/Toast.tsx` — a dismissible toast stack from props
      (`tone`, `title`, `body`, `onDismiss`), auto-dismiss left to the caller, props
      only, no socket, uses `web/src/theme.ts` tokens.

## Families to extend when the list runs low

- mobile (Android manifest, foreground service for sync, share sheet, notifications)
- packaging (winget manifest, notarization, AppImage desktop file, icons at new sizes)
- docs (README sections, one page per subsystem, the invite flow explained with pictures)
- testing (integration: two daemons on one machine, join, conflict, resume)
- safety (secrets scanning, path guards, command allowlist, dry run for shell)
- polish (empty states, loading skeletons, error copy, dutch and english strings)