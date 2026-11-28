# Feature groups — every mainstream harness, deduplicated

`docs/research/features/` holds 1,024 sourced rows across 23 inventories. This file is
those rows collapsed into unique concepts: same function under different names (YOLO,
Auto Approve, Turbo, full-access) is one row, with the aliases listed as proof. Meta
rows (product identity, pricing pages, "open source" statements) are folded into the
note at the bottom, not treated as features.

Every row carries a Roan status — **including the rejected ones**, so this list can be
filtered without re-deciding anything:

- **DONE** — wired end to end: the app or a turn actually reaches it, and a test
  or a recorded proof backs the claim (the note names it)
- **BUILD** — the module exists with tests, but nothing in the app or the turn
  calls it yet; the note says what is missing
- **SOON** — decided, next after the current rounds
- **LATER** — wanted, not scheduled
- **WON'T** — rejected by design (one agent, local-first, the app is the product)

Statuses were last checked against the tree on the 0.0.23 branch (2026-11-26):
every DONE below was read back from `src/` or `web/src/`, and every "module
only" names the file that exists and has no caller.

## Two lanes — basis versus feature

Not every row below is a feature. Half of them are **basis**: things every
reference product has (a visible thinking state, one message shown once, a
renameable conversation). Missing one is not "a feature not built yet", it is
a defect against the bar the reference apps set. The lane decides which todo
owns it: basis gaps go to the open round or the standing hygiene lane in
TODO.md, feature gaps go to the roadmap rounds.

**Basis rows (defects when missing):** session persistence, cross-surface
continuity, fork/branch/edit-resend, compaction, session search, session
names, transcript export & backup, archive/delete/temporary chats, share a
conversation, permission modes (the approval flow), protected paths, secrets
management, thinking/progress indicator, steering mid-turn, notifications
when done, model picker, BYOK catalog, local models, attachments, voice
input, all four surfaces (desktop/mobile/web/CLI), config files, onboarding,
telemetry policy, remote pairing, usage transparency, themes, instruction
file, persona/identity files (for Roan's mission these are the floor, not
the ceiling).

**Everything else is a feature:** goals, cron, web search/fetch, browser,
computer use, images, generation, skills, commands, plugins, hooks, MCP,
tool search, subagents/teams (WON'T), dual-model roles, caching, data
analysis, file library, code intelligence, webhooks, recaps, checkpoints,
git integration, worktrees, code review, CI, deep research, connectors,
inter-agent protocols, device control, headless, SDK, deep links,
natural-language config, doctor, updater, accessibility, status line,
keybinds, artifacts, assistant store, consumer verticals, i18n.

Harness legend: CC=Claude Code, CX=Codex CLI, OC=opencode, GC=gemini-cli,
AG=Antigravity, PI=Pi, OMP=Oh My Pi, DSH=DeepSeek Harness, AID=Aider, CL=Cline,
ROO=Roo Code, GOO=Goose, OH=OpenHands, QW=Qwen Code, AMP=Amp, CP=Copilot CLI,
CUR=Cursor, CRU=Crush, ZED=Zed Agent, OCW=OpenClaw, GPT=ChatGPT, CLD=Claude,
GEM=Gemini.

## A. Conversation & transcript

| Concept | Aliases (harness) | Roan |
|---|---|---|
| Session persistence & resume | session resume (CC, CX, GC, OC, QW), threads (AMP), sessions (CRU, GOO, DSH) | DONE — the chain replays events |
| Cross-surface session continuity | sync across devices (GPT), cross-surface sessions (OCW), shared settings across surfaces (AG) | DONE — the chain syncs every peer |
| Fork / branch / edit-resend | session branching & forking (CC, CX, OC), tree sessions `/tree` (PI), conversation branching (OH), edit a sent message / regenerate (GPT, CLD, GEM) | DONE — round 1 proven: regenerate branches via checkpoint, append-only intact; a turn never ends in silence anymore (0.0.14) |
| Compaction | `/compact` & autocompact (CC, GC, OC, PI, OCW), recap (CX), condenser (OH, ROO), snapcompact (OMP) | DONE — chain compaction, gc and summary with tests |
| Session search | session search (OCW), chat search (CLD, GEM), history search (GPT) | DONE — Ctrl-K opens the drawer on the search field and the filter matches titles and message text (over the events the client holds, the first 10,000) |
| Session names / auto-titles | session naming (CC), automatic session names (OCW, DSH) | DONE — rename event plus the first-turn auto title |
| Side questions without polluting context | `/btw` (CC, OC, AG), side chats (CX, OCW) | SOON — module only: `src/side/side-question.ts` (derived `side:<parent>:<n>` ids, `sideOf` marker) with 2 test files; no daemon frame, nothing renders the quote |
| Message queueing while the agent works | queue messages (CC, CX, GC, ROO) | SOON — module only: `src/side/queue.ts` + a `QueueBar` component; the daemon never reads the queue |
| Share a conversation read-only | session share → gist (PI), shared links (GPT, CLD, GEM), public conversation links (OCW), thread sharing (AMP) | LATER — the file half exists (self-contained escaped HTML from `src/chain/export-html.ts`, written by the `export` frame); there is no hosting and no revocable link |
| Transcript export & backup | transcript export (CC), session export/import (OC), export data (GPT, GEM) | DONE — markdown + self-contained HTML per session, JSONL chain, attachments folder, `exports/` and the Android download window |
| Archive / delete / temporary chats | archive & delete (GPT), incognito (CLD), temporary chats (GPT) | SOON — the daemon appends the tombstones (`session_archive`, `session_delete`) and `chain/sessions.ts` folds `archived`/`deleted`/`ephemeral`, but the drawer has no archived view or action, and nothing appends `ephemeral` |

## B. Permissions & safety

| Concept | Aliases (harness) | Roan |
|---|---|---|
| Permission modes incl. the YOLO family | YOLO (CL, CRU, QW), Auto Approve / auto-approve `--auto` (CL, ROO, OC), acceptEdits / auto / dontAsk / bypassPermissions (CC), Turbo & permission presets (AG), Auto-Edit & Auto classifier (QW), full-access profiles (DSH), `--allow-all-tools` (CP), execution modes (CUR) | DONE — approval cards, learned approvals, per-tool rules; a single global mode is not built |
| Plan mode (read-only planning first) | plan mode (CC, QW, CP, CRU, GC, AG, CUR), Plan/Act (CL, ROO), plan agent (OC) | DONE — tool list gated per turn (`plan.ts`, `plan-tools.ts`), `plan_mode` frame, composer toggle, `tests/plan-mode.test.ts` |
| Approvals that learn | once/always approvals (OC), persistent permission grants (AG), trusted directories/folders (CP, GC), workspace/project trust (CC, CX, PI) | DONE — tool_approval events, folded everywhere, resettable in the Tools panel |
| Per-tool allow/deny rules | permission rules (CC), allow/deny/ask + shell scanner (OC), action(target) engine (AG), tool permissions (ZED), command rules (CX), policy engine (GC) | DONE — tool_rule events on the chain, toggled per tool in the app |
| OS-level sandbox | Seatbelt/Landlock (CC, GC), Bubblewrap (QW, ZED), sandbox presets (AG), sandbox backend (DSH, GOO, CP), containerization (PI, OCW) | BUILD — module only: `src/safety/sandbox.ts` (bwrap/landlock/sandbox-exec detect + wrap) with tests; `run_shell` does not go through it |
| Cloud sandbox / orbs | orbs (AMP), cloud environments (CX, CP), cloud agents (CL, CUR, OH) | WON'T — local only, every device is a peer |
| Protected paths & ignore files | protected/critical paths (CC), `.clineignore`, QwenIgnore, `.rooignore`, path guard | DONE — home-bounded path guard |
| Secrets management | secrets tool (OCW), secrets settings (OH), credentials file (DSH), `.env` (AID), auth token for CI (CC) | partial — `secrets/identity.json` is `0600` and never packed, but a provider key entered in the app is written into `config.json`, which *is* part of the env that travels (see `docs/security.md` §1) |
| Elevated / managed execution | elevated exec (OCW) | BUILD — module only: `src/safety/elevation.ts` (one-time grant) + tests; no screen and no caller |
| Injection & abuse protections | prompt-injection detection, adversary mode (GOO), safety monitoring (CX), bot-loop protection, DM pairing (OCW), security analyzer (OH), supply-chain hardening (PI) | BUILD — modules only: `src/safety/untrusted.ts` (untrusted-content blocks) and `audit-log.ts`, with tests; the turn does not call either |

## C. Memory & instructions

| Concept | Aliases (harness) | Roan |
|---|---|---|
| Instruction file | CLAUDE.md + AGENTS.md compat (CC), AGENTS.md (CX, AMP, DSH, OCW), GEMINI.md (GC), QWEN.md (QW), rules (CL, CUR, ZED), instructions (CP, GPT), `.goosehints` (GOO), conventions file (AID) | DONE — AGENTS.md is written on first start and travels in the env snapshot |
| Persona / identity / user-profile files | SOUL.md, IDENTITY.md, USER.md (OCW), personality settings (GPT) | DONE — SOUL.md, IDENTITY.md, AGENTS.md bootstrap; USER/MEMORY ride the chain |
| Auto-memory that distills | auto memory MEMORY.md (CC), self-written notes (QW), daily notes → MEMORY.md (OCW), persistent memory (OH), Memory Bank (CL, ROO), pi-mnemopi (OMP) | DONE — at turn end at most three facts are distilled into `memory` events and folded into `MEMORY.md` (`src/memory/distil.ts`, `src/context/memory-md.ts`), wired in `runMessage`; `distil.test.ts`, `memory-md.test.ts` |
| Memory search tools | memory_search / memory_get (OCW), context_search (QW) | SOON — module only: `src/knowledge/search.ts` (sourced hits over messages and memory) + tests; not a tool |
| Consumer personalization | memory (GPT, CLD), chat memory (GEM) | DONE — chain memory, different shape |
| Projects / knowledge base | projects (GPT, CLD, CC, CUR, AG), notebooks (GEM), project knowledge RAG (CLD) | SOON — module only: `src/knowledge/projects.ts` (project store) with 2 test files; no tool, not in the prompt |
| Goals / standing orders | goal mode (CC), goals (CX, DSH ctx.goals), `/goal` (AG), standing orders (OCW) | DONE — `goal`/`goal_update` events folded by `chain/goals.ts`, `goalContext()` prepended to every turn prompt, `goal`/`goal_update` frames, GoalsPanel mounted |

## D. Extension

| Concept | Aliases (harness) | Roan |
|---|---|---|
| Skills (SKILL.md) | skills (CC, GC, OC, QW, CP, ZED, OCW, CRU, DSH, CL, AG, ROO, GOO, CUR, GPT, CLD, PI, OMP) | DONE — skills live in the home and load as context |
| Slash / custom commands | ~50 commands (AID), custom commands (OC, GC, ROO), presets (CX) | SOON — module only: `src/chain/commands.ts` (parse, fold, expand) + a `SlashMenu` component; the daemon has no `command` request |
| Plugins + marketplace | plugins & marketplaces (CC, OC, AG, CL, ROO, CX, GPT, CLD, AMP, DSH), ClawHub (OCW), extension gallery (GC) | DONE — plugin loader with manifests (bundled + home drop-in); no marketplace, by design |
| Lifecycle hooks | 40+ hooks (CC), JSON hooks (AG), hooks (GC, CRU, CL, OH, OCW, CX, DSH, CUR) | DONE — `hooks.json` runs a shell command at `turn_start` and `turn_end` (`src/hooks/run.ts`, called by `runMessage`) and at `before_tool`/`after_tool` around every tool call (`src/tools/guard.ts`) |
| MCP client | MCP (every harness) | DONE — real JSON-RPC client (http + stdio), server list as chain events, tools gated, `McpRuntime` dials per turn |
| Expose self as server | CC as MCP server, OCW as MCP server + ACP harness, app-server (CX), `opencode serve` + REST (OC), ACP server (GOO) | LATER — control API exists, shape it later |
| Subagents | subagents (CC, OC, GC, AG, QW, CL, OH, DSH, OCW, CUR, GOO, CX, ROO, PI, OMP, AMP) | WON'T as a product — one agent, his rule; `run_on_node` moves *where*, and a single `delegate` tool (a fresh hermes turn, summary back) rides in the relay tool set without becoming an agent family |
| Agent teams / swarm / board | agent teams (CC, CL, DSH, QW), `/boost` `/swarm` `/teamwork` (AG), swarm (OCW), hub-spoke (CL), parallel agents (ZED), multiplayer (OCW) | WON'T |
| Dynamic agent-written workflows | dynamic workflows (CC), `/run-workflow` (AG) | WON'T |
| Everything-is-a-plugin (incl. the loop) | plugin-composed loop & runtimes (DSH), agent runtimes as plugins (OCW) | WON'T |
| Self-learning skills | Skill Workshop + self-learning skills (OCW), Record & Replay (CX) | SOON — module only: `src/skills/proposal.ts` (proposals stay inert until approved) + tests; no screen |
| Deferred / searchable tools | Tool Search (OCW) | BUILD — module only: `src/tools/deferred.ts` + tests; nothing is deferred at runtime |

## E. Models & providers

| Concept | Aliases (harness) | Roan |
|---|---|---|
| BYOK multi-provider catalog | models.dev catalog (OC, OCW), BYOK (AID, CL, CRU, CUR, DSH, ZED, AMP, QW, GOO, PI), LLM gateway (CC), alt providers (CX, CP) | DONE — 304 live presets |
| Local models | Ollama / LM Studio / vLLM (OC, AID, QW, CL, ZED, ROO, CP, OCW, DSH) | DONE — LM Studio preset |
| Subscription reuse / hosted accounts | ChatGPT sign-in (OC, OCW), Copilot sign-in (OC), free models (OC), hosted models (ZED, CRU), provider plans (QW, GOO) | WON'T — no third-party accounts between Roan and his models |
| Model switching / picker | `/model` (every CLI), model picker (GPT, GEM), mid-session switch (CRU) | DONE |
| Thinking / effort levels | effort & ultracode (CC), reasoning levels (AG, DSH, PI), thinking levels (GPT, GEM), think-tokens (AID) | DONE — `EffortLevel` stored in `config.json` and applied per turn, with the request spelling per provider family (`src/providers/effort.ts`, `effort-request.test.ts`); the app has no picker, so the `effort` frame is unused |
| Dual-model roles (planner/builder, advisor, critic) | architect mode (AID), orchestrator pairs (AG), advisor (CC), critic + Ask Oracle (OH), model orchestration (CL) | SOON — module only: `src/providers/roles.ts` (`roleModel()` for planner/executor/side) + tests; never called |
| Cheap model for side tasks | weak/editor models (AID), summary model (OC) | LATER |
| Token caching & warming | prompt caching (AID, GC, QW), cache warming (OC) | LATER — provider-side, worth doing right |
| Cost / usage tracking | cost & usage (CC), `/usage` (CX, AMP), `/stats` (GC), `/tokens` (AID), usage dashboard (OMP), token mgmt (OCW) | DONE per turn — `turn_end` carries tokens and cost and the answer prints a line under it (`src/usage.ts`, `tests/turn-usage.test.ts`); no session total and no dashboard |

## F. Tools

| Concept | Aliases (harness) | Roan |
|---|---|---|
| Shell / terminal exec | Bash (CC), exec (OCW), native shell (OMP), interactive terminal (OH) | DONE |
| Background jobs | background Bash (CC), background terminals (CX), jobs (DSH), background commands (OC) | DONE for schedules — `cron.json` jobs (daily `HH:MM`, `every 30m`) run as turns in a conversation per job from the daemon's 30 s timer, saved from the mounted Schedules panel; long-running background *processes* (PTY, job list) are not built |
| File tools (read/write/edit/grep) | every CLI; Jupyter editing (CL) | DONE |
| Web search | WebSearch (CC), web_search (OC, OCW, QW, DSH), search grounding (GEM) | DONE — web plugin: Bing RSS primary, DuckDuckGo lite, Wikipedia floor; providers are plugins |
| Web fetch / URL reader | WebFetch (CC), web_fetch (OC, OCW), `/web` (AID) | DONE — page provider reads the first 64 kB, https-only |
| Browser automation | browser subagent (AG), Browse (OC), browser tool (CL), BrowserToolSet (OH), browser automation + hosted browsers (OCW), cloud browser (CLD), built-in browser (GPT) | DONE — CDP client + page actions registered as a core tool in `src/tools.ts`; without `BROWSER_CDP_URL` it refuses honestly; tests drive a fake CDP |
| Computer / GUI use | computer use (CC, CX, CP, OCW), Claude Duet (CLD) | BUILD — module only: `src/computer/` (grant store, gated actions, Linux driver) with 3 test files; no grant frames from the daemon, no approval card |
| Image input (vision) | image inputs (CX, AMP, DSH, OH), multimodal input (GC), `@` images (PI), screenshot tool (GPT), image understanding (CLD) | DONE — photo attachments ride the live message (0.0.20) |
| Image / video / music generation | images (GPT, GEM), image generation (OC, ROO), media generation (OCW) | BUILD — module only: `src/generate/` (OpenAI images + ComfyUI plugins, registry, runtime) + tests; no tool registered |
| Voice input / dictation | voice dictation (CC, GPT, CLD, AG, DSH, QW, PI, OMP), on-device voice (CP) | BUILD — module only: `src/stt/` (registry, provider contract, local openai-compat plugin) + tests; the composer's mic needs an `onRecord` that nothing passes, so it stays disabled |
| Voice calls / live conversation | voice calls via Plivo/Twilio (OCW), ChatGPT Voice + 1-800 (GPT), Gemini Live + calls (GEM), voice mode (CLD), talk mode + wake (OCW) | BUILD — module only: `src/voice/` (TTS provider + listen→think→speak loop) + tests; needs mic capture and a speaker from the shell |
| Attachments / `@` file mentions | file uploads (GPT, CLD, GEM), attachments (OC), context mentions (CL, ROO) | DONE for workspace; files beyond it follow the storage round |
| File library / manager | Library + Space (GPT) | DONE — the Workspace panel lists, previews and saves files through `workspace_list` / `workspace_read` / `workspace_write` |
| Data analysis / charts | data analysis (GPT), Claude Data (CLD) | SOON — module only: `src/charts/spec.ts` (chart spec from tabular data) + tests; no panel renders it |
| Code intelligence / LSP | code intelligence plugin (CC), LSP (CRU, CP, OMP), repo map (AID), codebase indexing (ROO) | BUILD — module only: `src/codeintel/lsp.ts` (probe + client interface) + tests; not a tool |

## G. Automation & background

| Concept | Aliases (harness) | Roan |
|---|---|---|
| Scheduled tasks / cron | scheduled tasks (CX, AG, GPT, GEM, CLD Cowork, DSH, CL), `/loop` (QW), cron & reminders (OCW), scheduled jobs (GOO), in-session scheduling (CC) | DONE — cron exists; the phone needs the foreground service |
| Foreground service / always-on daemon | gateway background service (OCW), daemon-first (QW `qwen serve`, OC background service, OCW gateway) | DONE — 0.0.19 foreground service owns the daemon, clean stop, supervisor restart |
| Notifications when done | notifications (CX, AID, GPT, CL), OS notifications (CL), quiet hours (CLD) | DONE — the foreground service tails the log and ticks "Roan is done" (0.0.19) |
| Stuck detector | stuck detector (OH) | DONE — turn liveness reports at 2 min and owns up at 5 |
| Webhooks / event triggers | webhook triggers (OCW), automation events (OH), issue-triage automation (CL, CC) | SOON — module only: signed inbound `dispatch.ts` (timestamp window + replay guard) and outbound `sendWebhook`, 2 test files; no HTTP route in the daemon, no trigger kind |
| Recaps / daily brief | session recap (CC), monthly recap (CLD), daily brief (GEM) | LATER |

## H. Git & code work

| Concept | Aliases (harness) | Roan |
|---|---|---|
| Checkpoints / rewind / undo | checkpointing & rewind (CC), checkpoints shadow-git (CL, QW), `/restore` (GC), snapshots/undo/redo (OC), undo commits (AID) | DONE — checkpoints panel with go-back; file snapshots are not built |
| Git integration (commit/PR/review pane) | auto-commit + attribution + dirty-file isolation (AID), git integration (CC), review pane (AG), GitHub NL (CP), `/review` (QW), PR reviews (CC, CX) | BUILD — module only: `src/gitpanel/status.ts` (porcelain + numstat parsers) and a `GitPanel` component, both unmounted; no commit path in the daemon |
| Git worktree isolation | worktrees (CC, GC, CX, AG, CL, ROO, OC, OCW) | LATER |
| Code review | code review local + GitHub + security (CC), `/review` (QW), PR review automation (CL), Codex Security (CX) | LATER |
| CI integrations | GitHub Actions (CC, GC, QW, CX) | LATER |

## I. Surfaces

| Concept | Aliases (harness) | Roan |
|---|---|---|
| Desktop app | desktop apps (AG, OC, QW, CL, AMP, CUR, GPT, CLD, GEM, DSH, GOO, CX) | DONE — Tauri app |
| Mobile app | apps (GPT, CLD, GEM, AMP, OCW, OC, CUR iOS, CC & CX companions) | DONE — the apk |
| Web dashboard / control UI | Control UI + widgets (OCW), web shell (QW), Agent Canvas (OH), web dashboard (CUR, AMP) | DONE as webui; polish LATER |
| Remote pairing / access from anywhere | pair QR (OC), remote Tailscale (OCW, OH), remote connections (CX, AG, CC), portals (AMP) | DONE — a v2 join code carries every dialable host, Tailscale discovery finds the rest, presence and `nodes[].live` say who is up; the backflow is covered by `tests/integration/two-daemons.test.ts` and the three-branch proof |
| Messaging channels | 33 channels (OCW), chat channels (QW), connectors (CL), channels (CC, CX) | WON'T — the app is the channel; one Telegram door maybe, never the core |
| CLI / TUI surface | every CLI harness | DONE for the CLI — `roan state/sessions/send/new/export` over the control socket (`cli/`, `tests/cli.test.ts`); no TUI |
| IDE / editor extension | VS Code / JetBrains / Zed (CC, CX, OC, GC, CL, ZED, CUR, AG, QW, CP), watch mode (AID) | WON'T — the app is the whole product |
| ACP (agent embedded in editors) | ACP (CP, CL, CUR, ZED, OC, QW, OH, GOO, OCW) | WON'T |
| Headless / scripting mode | `-p` print mode (CC, GC, AG, QW, OC, AID, CX) | DONE through the CLI — `roan send "…"` and `roan export` are the scriptable path; there is no `-p` flag on the daemon itself |
| SDK for embedding | Agent SDK (CC, CX, AG, OH, CL, PI, GOO, DSH, CUR) | DONE as an in-repo library — `sdk/client.ts` with typed frames (`tests/sdk-client.test.ts`) and `docs/api.md`; not a published package |
| Enterprise / admin (SSO, audit, spend) | enterprise tiers (CC, AG, CX, ZED, AMP, CL) | WON'T — personal agent |
| Multi-profiles / multi-user | named profiles (OCW), config dirs (CC), profiles (CX), operator scopes (OCW) | WON'T — one agent, one identity |
| Import from other agents | setup import (AG, CX, CC, OMP, GEM) | SOON — the frames work (`import_discover`, `import_plan` over `src/import/`: discover, parse, plan, apply) and an `ImportPanel` exists, but the panel is not mounted and an import lands only as an env snapshot |
| Packaging / install | one-command install (OCW), Docker images (AID, OC), cross-platform packages (CRU, PI) | DONE — apk / AppImage |

## J. UX & polish

| Concept | Aliases (harness) | Roan |
|---|---|---|
| Thinking / progress indicator | streaming status (GPT, GEM), progress card (OCW), transcript viewer (CC) | DONE — round 1 proven: the dock shows from turn_start (the lock's events were never broadcast before), plus a stuck report that says so after 2 min silence |
| Diffs shown in the UI | visual artifacts & unified diffs (AG), diffs (OCW), changes tab (OH, AMP), `/diff` (CC, AID, CX) | LATER |
| Steering / interrupt mid-turn | steering & interrupts (PI, CX, OH, OCW), safe interrupts (AID) | DONE — a steer is injected after a round's tool results and before the next request (`src/turn/steer.ts`, `steer` frame, composer button), and Stop aborts the turn |
| Themes | themes (CC, GC, OC, QW, CRU, GEM, CLD) | DONE — dark mint, one system |
| Keybinds / vim / multiline | keybindings (CC, GC, OC, ROO), vim mode (GC, AG, AID) | LATER — app keyboard set is small |
| Status line / footer | statusline (CC, CX, AG) | WON'T — terminal concept, n/a in the app |
| Config files | config & profiles (CX), opencode.json (OC), YAML (GOO), `.aider.conf.yml` (AID), settings.json (AG, GC), crushrc (CRU) | DONE — `config.json` in the home |
| Natural-language config | configure by asking (CRU) | LATER |
| Doctor / self-diagnostics | doctor (CC, CX, OCW), self-diagnostics (CC), trajectory view (DSH) | BUILD — `src/daemon/health.ts` and `diagnostics.ts` exist, have no caller and no test; no request kind serves them |
| Updater / release channels | update channels (CC, CX, GC, ROO nightly) | BUILD — the plugin, pubkey and feed endpoint are configured (`tauri.conf.json`), `web/src/update.ts` and `src/packaging/update-feed.ts` are tested, but no CI step publishes `latest.json`, the card lives in a `SettingsPanel` nothing mounts, and no second version has been published |
| Telemetry policy | telemetry opt-in (GC, AID), version-check-only (OCW), privacy mode (CUR) | DONE — zero, stricter than all of them |
| Accessibility | screen-reader & reduced-motion (CC) | LATER |
| i18n / multiple UI languages | 18 UI languages (ROO), language setting (GEM, CLD) | WON'T — English only, standing rule |
| Deep links | `claude-cli://` (CC), desktop deep link (CP) | BUILD — module only: `src/deeplink.ts` (+ `src/mobile/deeplink.ts`) with tests; no shell registers the scheme |
| Onboarding / first-run bootstrap | onboarding wizard (OCW), role-based onboarding (AG), BOOTSTRAP.md ritual (OCW) | DONE — the onboarding gate plus a first-start bootstrap that writes `SOUL.md`, `IDENTITY.md`, `AGENTS.md` and never overwrites one (`bootstrap.ts`); there is no interactive wizard |

## K. Consumer & platform extras

| Concept | Aliases (harness) | Roan |
|---|---|---|
| Artifacts / canvas / side documents | Artifacts (CC, CLD), Canvas (GEM, GPT), Docs/Sheets/Whiteboards/Design/Science (CLD), Space pages (GPT) | LATER — markdown and attachments first |
| Custom assistant store | GPTs + GPT Store (GPT, retiring), Gems → replaced by skills (GEM) | WON'T — one agent; Gemini itself replaced this with skills |
| Deep research mode | deep research (GPT, GEM, CLD) | SOON — module only: bounded plan→search→extract→report with a citation guard (`src/research/`, 3 test files); no tool registered |
| Connectors (Gmail, Drive, Slack…) | connected apps (GPT, GEM), connectors (CLD, CX, CL), Hermes connectors | SOON — module only: read-only GitHub issues and files (`src/connectors/github.ts`, token from `secrets/`) + tests; no route and no tool |
| Inter-agent protocols (A2A/Reef) | A2A channel, Reef (OCW), cross-session messaging (CC), agent send (OCW) | WON'T — the reasoning, what covers the same need and what an adapter would have to do are in [`docs/a2a.md`](a2a.md) |
| Device control between own nodes | node devices & computer use (OCW), device assistance (GEM) | SOON — module only: `src/sync/device-control.ts` (request/grant/result shapes) with 16 tests; no `device_req` frame and no transport handler |
| Consumer verticals (shopping, wallet, health, law, study, CarPlay, office suites, Sites) | shopping/wallet/finances/health/law/flashcards/CarPlay/office integrations/Sites (GPT), purchases (GEM), smart home (GEM), Google Docs (CLD) | WON'T — personal integrations happen through tools, not product features |
| Ambient room events | ambient room events (OCW) | WON'T — no channels |
| Copy/paste web-chat fallback | copy-paste mode (AID) | WON'T |
| Hosted cloud agents (keep working, laptop closed) | orbs (AMP), dot (GPT), cloud agents (CUR, CL, CX) | WON'T — the always-on device is the node |

## Dropped from grouping (not features)

Product-identity and status rows (AG 2.0 identity, PI/OMP/DSH identity, Gemini CLI→AG
transition notes, Roo shutdown notice, Canvas status-unverified, GPT voice retirement),
pricing-page pointers, "open source" statements, Codex Micro hardware, Googlebook OS
preinstall, and Daybreak (CX cyber access) stay in their JSONs; none of them is a
Roan-relevant feature.
