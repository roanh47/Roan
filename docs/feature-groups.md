# Feature groups — every mainstream harness, deduplicated

`docs/research/features/` holds 1,024 sourced rows across 23 inventories. This file is
those rows collapsed into unique concepts: same function under different names (YOLO,
Auto Approve, Turbo, full-access) is one row, with the aliases listed as proof. Meta
rows (product identity, pricing pages, "open source" statements) are folded into the
note at the bottom, not treated as features.

Every row carries a Roan status — **including the rejected ones**, so this list can be
filtered without re-deciding anything:

- **DONE** — works on a real machine
- **BUILD** — in the current rounds (TODO.md round 1/2)
- **SOON** — decided, next after the current rounds
- **LATER** — wanted, not scheduled
- **WON'T** — rejected by design (one agent, local-first, the app is the product)

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
| Compaction | `/compact` & autocompact (CC, GC, OC, PI, OCW), recap (CX), condenser (OH, ROO), snapcompact (OMP) | BUILD — round 2 territory, first after transcript hygiene |
| Session search | session search (OCW), chat search (CLD, GEM), history search (GPT) | SOON — one query over the chain DB |
| Session names / auto-titles | session naming (CC), automatic session names (OCW, DSH) | LATER — rename exists as a known gap |
| Side questions without polluting context | `/btw` (CC, OC, AG), side chats (CX, OCW) | LATER |
| Message queueing while the agent works | queue messages (CC, CX, GC, ROO) | LATER |
| Share a conversation read-only | session share → gist (PI), shared links (GPT, CLD, GEM), public conversation links (OCW), thread sharing (AMP) | LATER |
| Transcript export & backup | transcript export (CC), session export/import (OC), export data (GPT, GEM) | SOON — export/backup button is designed, not built |
| Archive / delete / temporary chats | archive & delete (GPT), incognito (CLD), temporary chats (GPT) | LATER |

## B. Permissions & safety

| Concept | Aliases (harness) | Roan |
|---|---|---|
| Permission modes incl. the YOLO family | YOLO (CL, CRU, QW), Auto Approve / auto-approve `--auto` (CL, ROO, OC), acceptEdits / auto / dontAsk / bypassPermissions (CC), Turbo & permission presets (AG), Auto-Edit & Auto classifier (QW), full-access profiles (DSH), `--allow-all-tools` (CP), execution modes (CUR) | SOON — approval cards; the YOLO end of the scale is a setting, not a goal |
| Plan mode (read-only planning first) | plan mode (CC, QW, CP, CRU, GC, AG, CUR), Plan/Act (CL, ROO), plan agent (OC) | SOON — the grill-me/clarify pattern feeds this |
| Approvals that learn | once/always approvals (OC), persistent permission grants (AG), trusted directories/folders (CP, GC), workspace/project trust (CC, CX, PI) | SOON — same allow twice → remember per workspace |
| Per-tool allow/deny rules | permission rules (CC), allow/deny/ask + shell scanner (OC), action(target) engine (AG), tool permissions (ZED), command rules (CX), policy engine (GC) | SOON — allowlist exists, rule refinement follows |
| OS-level sandbox | Seatbelt/Landlock (CC, GC), Bubblewrap (QW, ZED), sandbox presets (AG), sandbox backend (DSH, GOO, CP), containerization (PI, OCW) | LATER — exec allowlist first |
| Cloud sandbox / orbs | orbs (AMP), cloud environments (CX, CP), cloud agents (CL, CUR, OH) | WON'T — local only, every device is a peer |
| Protected paths & ignore files | protected/critical paths (CC), `.clineignore`, QwenIgnore, `.rooignore`, path guard | DONE — home-bounded path guard |
| Secrets management | secrets tool (OCW), secrets settings (OH), credentials file (DSH), `.env` (AID), auth token for CI (CC) | DONE — keys travel via chain-env |
| Elevated / managed execution | elevated exec (OCW) | LATER |
| Injection & abuse protections | prompt-injection detection, adversary mode (GOO), safety monitoring (CX), bot-loop protection, DM pairing (OCW), security analyzer (OH), supply-chain hardening (PI) | LATER — exec guard exists; content checks follow |

## C. Memory & instructions

| Concept | Aliases (harness) | Roan |
|---|---|---|
| Instruction file | CLAUDE.md + AGENTS.md compat (CC), AGENTS.md (CX, AMP, DSH, OCW), GEMINI.md (GC), QWEN.md (QW), rules (CL, CUR, ZED), instructions (CP, GPT), `.goosehints` (GOO), conventions file (AID) | BUILD — round 2: `AGENTS.md` in the home |
| Persona / identity / user-profile files | SOUL.md, IDENTITY.md, USER.md (OCW), personality settings (GPT) | BUILD — round 2, adopted from OpenClaw |
| Auto-memory that distills | auto memory MEMORY.md (CC), self-written notes (QW), daily notes → MEMORY.md (OCW), persistent memory (OH), Memory Bank (CL, ROO), pi-mnemopi (OMP) | SOON — after the home exists |
| Memory search tools | memory_search / memory_get (OCW), context_search (QW) | LATER |
| Consumer personalization | memory (GPT, CLD), chat memory (GEM) | DONE — chain memory, different shape |
| Projects / knowledge base | projects (GPT, CLD, CC, CUR, AG), notebooks (GEM), project knowledge RAG (CLD) | LATER — the workspace is the project |
| Goals / standing orders | goal mode (CC), goals (CX, DSH ctx.goals), `/goal` (AG), standing orders (OCW) | SOON — confirmed by four harnesses |

## D. Extension

| Concept | Aliases (harness) | Roan |
|---|---|---|
| Skills (SKILL.md) | skills (CC, GC, OC, QW, CP, ZED, OCW, CRU, DSH, CL, AG, ROO, GOO, CUR, GPT, CLD, PI, OMP) | BUILD — skills travel with the chain |
| Slash / custom commands | ~50 commands (AID), custom commands (OC, GC, ROO), presets (CX) | LATER |
| Plugins + marketplace | plugins & marketplaces (CC, OC, AG, CL, ROO, CX, GPT, CLD, AMP, DSH), ClawHub (OCW), extension gallery (GC) | LATER — skills first, no public store planned |
| Lifecycle hooks | 40+ hooks (CC), JSON hooks (AG), hooks (GC, CRU, CL, OH, OCW, CX, DSH, CUR) | LATER |
| MCP client | MCP (every harness) | BUILD — `mcp.json` must actually start servers |
| Expose self as server | CC as MCP server, OCW as MCP server + ACP harness, app-server (CX), `opencode serve` + REST (OC), ACP server (GOO) | LATER — control API exists, shape it later |
| Subagents | subagents (CC, OC, GC, AG, QW, CL, OH, DSH, OCW, CUR, GOO, CX, ROO, PI, OMP, AMP) | WON'T — one agent, his rule; `run_on_node` moves *where*, not *who* |
| Agent teams / swarm / board | agent teams (CC, CL, DSH, QW), `/boost` `/swarm` `/teamwork` (AG), swarm (OCW), hub-spoke (CL), parallel agents (ZED), multiplayer (OCW) | WON'T |
| Dynamic agent-written workflows | dynamic workflows (CC), `/run-workflow` (AG) | WON'T |
| Everything-is-a-plugin (incl. the loop) | plugin-composed loop & runtimes (DSH), agent runtimes as plugins (OCW) | WON'T |
| Self-learning skills | Skill Workshop + self-learning skills (OCW), Record & Replay (CX) | LATER |
| Deferred / searchable tools | Tool Search (OCW) | LATER — small tool core is the point |

## E. Models & providers

| Concept | Aliases (harness) | Roan |
|---|---|---|
| BYOK multi-provider catalog | models.dev catalog (OC, OCW), BYOK (AID, CL, CRU, CUR, DSH, ZED, AMP, QW, GOO, PI), LLM gateway (CC), alt providers (CX, CP) | DONE — 304 live presets |
| Local models | Ollama / LM Studio / vLLM (OC, AID, QW, CL, ZED, ROO, CP, OCW, DSH) | DONE — LM Studio preset |
| Subscription reuse / hosted accounts | ChatGPT sign-in (OC, OCW), Copilot sign-in (OC), free models (OC), hosted models (ZED, CRU), provider plans (QW, GOO) | WON'T — no third-party accounts between Roan and his models |
| Model switching / picker | `/model` (every CLI), model picker (GPT, GEM), mid-session switch (CRU) | DONE |
| Thinking / effort levels | effort & ultracode (CC), reasoning levels (AG, DSH, PI), thinking levels (GPT, GEM), think-tokens (AID) | SOON |
| Dual-model roles (planner/builder, advisor, critic) | architect mode (AID), orchestrator pairs (AG), advisor (CC), critic + Ask Oracle (OH), model orchestration (CL) | LATER |
| Cheap model for side tasks | weak/editor models (AID), summary model (OC) | LATER |
| Token caching & warming | prompt caching (AID, GC, QW), cache warming (OC) | LATER — provider-side, worth doing right |
| Cost / usage tracking | cost & usage (CC), `/usage` (CX, AMP), `/stats` (GC), `/tokens` (AID), usage dashboard (OMP), token mgmt (OCW) | SOON — usage per turn in the app |

## F. Tools

| Concept | Aliases (harness) | Roan |
|---|---|---|
| Shell / terminal exec | Bash (CC), exec (OCW), native shell (OMP), interactive terminal (OH) | DONE |
| Background jobs | background Bash (CC), background terminals (CX), jobs (DSH), background commands (OC) | SOON — with notify, round 2 |
| File tools (read/write/edit/grep) | every CLI; Jupyter editing (CL) | DONE |
| Web search | WebSearch (CC), web_search (OC, OCW, QW, DSH), search grounding (GEM) | SOON |
| Web fetch / URL reader | WebFetch (CC), web_fetch (OC, OCW), `/web` (AID) | SOON |
| Browser automation | browser subagent (AG), Browse (OC), browser tool (CL), BrowserToolSet (OH), browser automation + hosted browsers (OCW), cloud browser (CLD), built-in browser (GPT) | LATER |
| Computer / GUI use | computer use (CC, CX, CP, OCW), Claude Duet (CLD) | LATER |
| Image input (vision) | image inputs (CX, AMP, DSH, OH), multimodal input (GC), `@` images (PI), screenshot tool (GPT), image understanding (CLD) | SOON — images in turns |
| Image / video / music generation | images (GPT, GEM), image generation (OC, ROO), media generation (OCW) | LATER |
| Voice input / dictation | voice dictation (CC, GPT, CLD, AG, DSH, QW, PI, OMP), on-device voice (CP) | SOON — mic exists (feature-detect); on-device STT preferred |
| Voice calls / live conversation | voice calls via Plivo/Twilio (OCW), ChatGPT Voice + 1-800 (GPT), Gemini Live + calls (GEM), voice mode (CLD), talk mode + wake (OCW) | LATER |
| Attachments / `@` file mentions | file uploads (GPT, CLD, GEM), attachments (OC), context mentions (CL, ROO) | DONE for workspace; files beyond it follow the storage round |
| File library / manager | Library + Space (GPT) | LATER — workspace browser |
| Data analysis / charts | data analysis (GPT), Claude Data (CLD) | LATER |
| Code intelligence / LSP | code intelligence plugin (CC), LSP (CRU, CP, OMP), repo map (AID), codebase indexing (ROO) | LATER |

## G. Automation & background

| Concept | Aliases (harness) | Roan |
|---|---|---|
| Scheduled tasks / cron | scheduled tasks (CX, AG, GPT, GEM, CLD Cowork, DSH, CL), `/loop` (QW), cron & reminders (OCW), scheduled jobs (GOO), in-session scheduling (CC) | DONE — cron exists; the phone needs the foreground service |
| Foreground service / always-on daemon | gateway background service (OCW), daemon-first (QW `qwen serve`, OC background service, OCW gateway) | BUILD — round 2, Android foreground service |
| Notifications when done | notifications (CX, AID, GPT, CL), OS notifications (CL), quiet hours (CLD) | SOON — round 2, with quiet hours |
| Stuck detector | stuck detector (OH) | BUILD — round 1, next to the thinking state |
| Webhooks / event triggers | webhook triggers (OCW), automation events (OH), issue-triage automation (CL, CC) | LATER |
| Recaps / daily brief | session recap (CC), monthly recap (CLD), daily brief (GEM) | LATER |

## H. Git & code work

| Concept | Aliases (harness) | Roan |
|---|---|---|
| Checkpoints / rewind / undo | checkpointing & rewind (CC), checkpoints shadow-git (CL, QW), `/restore` (GC), snapshots/undo/redo (OC), undo commits (AID) | SOON — branch-regen round 1, file snapshots later |
| Git integration (commit/PR/review pane) | auto-commit + attribution + dirty-file isolation (AID), git integration (CC), review pane (AG), GitHub NL (CP), `/review` (QW), PR reviews (CC, CX) | LATER — exec covers git; UI niceties later |
| Git worktree isolation | worktrees (CC, GC, CX, AG, CL, ROO, OC, OCW) | LATER |
| Code review | code review local + GitHub + security (CC), `/review` (QW), PR review automation (CL), Codex Security (CX) | LATER |
| CI integrations | GitHub Actions (CC, GC, QW, CX) | LATER |

## I. Surfaces

| Concept | Aliases (harness) | Roan |
|---|---|---|
| Desktop app | desktop apps (AG, OC, QW, CL, AMP, CUR, GPT, CLD, GEM, DSH, GOO, CX) | DONE — Tauri app |
| Mobile app | apps (GPT, CLD, GEM, AMP, OCW, OC, CUR iOS, CC & CX companions) | DONE — the apk |
| Web dashboard / control UI | Control UI + widgets (OCW), web shell (QW), Agent Canvas (OH), web dashboard (CUR, AMP) | DONE as webui; polish LATER |
| Remote pairing / access from anywhere | pair QR (OC), remote Tailscale (OCW, OH), remote connections (CX, AG, CC), portals (AMP) | SOON — invite/join exists, join-bug is the open part |
| Messaging channels | 33 channels (OCW), chat channels (QW), connectors (CL), channels (CC, CX) | WON'T — the app is the channel; one Telegram door maybe, never the core |
| CLI / TUI surface | every CLI harness | LATER — a thin CLI over the control socket, for the server |
| IDE / editor extension | VS Code / JetBrains / Zed (CC, CX, OC, GC, CL, ZED, CUR, AG, QW, CP), watch mode (AID) | WON'T — the app is the whole product |
| ACP (agent embedded in editors) | ACP (CP, CL, CUR, ZED, OC, QW, OH, GOO, OCW) | WON'T |
| Headless / scripting mode | `-p` print mode (CC, GC, AG, QW, OC, AID, CX) | LATER — control API already covers most |
| SDK for embedding | Agent SDK (CC, CX, AG, OH, CL, PI, GOO, DSH, CUR) | LATER — automation API, not a platform play |
| Enterprise / admin (SSO, audit, spend) | enterprise tiers (CC, AG, CX, ZED, AMP, CL) | WON'T — personal agent |
| Multi-profiles / multi-user | named profiles (OCW), config dirs (CC), profiles (CX), operator scopes (OCW) | WON'T — one agent, one identity |
| Import from other agents | setup import (AG, CX, CC, OMP, GEM) | SOON-lite — only the OpenClaw workspace files seed `.Roan` |
| Packaging / install | one-command install (OCW), Docker images (AID, OC), cross-platform packages (CRU, PI) | DONE — apk / AppImage |

## J. UX & polish

| Concept | Aliases (harness) | Roan |
|---|---|---|
| Thinking / progress indicator | streaming status (GPT, GEM), progress card (OCW), transcript viewer (CC) | DONE — round 1 proven: the dock shows from turn_start (the lock's events were never broadcast before), plus a stuck report that says so after 2 min silence |
| Diffs shown in the UI | visual artifacts & unified diffs (AG), diffs (OCW), changes tab (OH, AMP), `/diff` (CC, AID, CX) | LATER |
| Steering / interrupt mid-turn | steering & interrupts (PI, CX, OH, OCW), safe interrupts (AID) | SOON — stop button + steer |
| Themes | themes (CC, GC, OC, QW, CRU, GEM, CLD) | DONE — dark mint, one system |
| Keybinds / vim / multiline | keybindings (CC, GC, OC, ROO), vim mode (GC, AG, AID) | LATER — app keyboard set is small |
| Status line / footer | statusline (CC, CX, AG) | WON'T — terminal concept, n/a in the app |
| Config files | config & profiles (CX), opencode.json (OC), YAML (GOO), `.aider.conf.yml` (AID), settings.json (AG, GC), crushrc (CRU) | DONE — `config.json` in the home |
| Natural-language config | configure by asking (CRU) | LATER |
| Doctor / self-diagnostics | doctor (CC, CX, OCW), self-diagnostics (CC), trajectory view (DSH) | SOON — updater round |
| Updater / release channels | update channels (CC, CX, GC, ROO nightly) | SOON — §9 updater |
| Telemetry policy | telemetry opt-in (GC, AID), version-check-only (OCW), privacy mode (CUR) | DONE — zero, stricter than all of them |
| Accessibility | screen-reader & reduced-motion (CC) | LATER |
| i18n / multiple UI languages | 18 UI languages (ROO), language setting (GEM, CLD) | WON'T — English only, standing rule |
| Deep links | `claude-cli://` (CC), desktop deep link (CP) | LATER |
| Onboarding / first-run bootstrap | onboarding wizard (OCW), role-based onboarding (AG), BOOTSTRAP.md ritual (OCW) | DONE onboarding; BUILD the bootstrap-seeding of the home (round 2) |

## K. Consumer & platform extras

| Concept | Aliases (harness) | Roan |
|---|---|---|
| Artifacts / canvas / side documents | Artifacts (CC, CLD), Canvas (GEM, GPT), Docs/Sheets/Whiteboards/Design/Science (CLD), Space pages (GPT) | LATER — markdown and attachments first |
| Custom assistant store | GPTs + GPT Store (GPT, retiring), Gems → replaced by skills (GEM) | WON'T — one agent; Gemini itself replaced this with skills |
| Deep research mode | deep research (GPT, GEM, CLD) | SOON — after web search lands |
| Connectors (Gmail, Drive, Slack…) | connected apps (GPT, GEM), connectors (CLD, CX, CL), Hermes connectors | LATER |
| Inter-agent protocols (A2A/Reef) | A2A channel, Reef (OCW), cross-session messaging (CC), agent send (OCW) | LATER — own chain first |
| Device control between own nodes | node devices & computer use (OCW), device assistance (GEM) | SOON after round 2 — full peers, never thin clients |
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
