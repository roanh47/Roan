# Roan feature parity — what mainstream agents have, and what Roan does with it

Date: 2026-11-18, re-checked against the code on the 0.0.23 branch (every verdict
below was read back from `src/` and `web/src/`, not from the earlier plan). Sources: the
agents' official docs (all research delivered — 1,024
sourced rows in `docs/research/features/`), `docs/mobile-app-patterns.md`,
`docs/reference-apps-apk-analysis.md` (ChatGPT APK), the Roan repo itself, and Hermes'
own surface (I am that).

**Start here for the to-do:** `docs/feature-groups.md` — all 23 inventories collapsed
into ~110 deduplicated concepts (YOLO = Auto Approve = Turbo = one row, aliases shown),
each with a DONE / BUILD / SOON / LATER / WON'T status, rejected ones included. This
file keeps the reasoning per verdict; the JSONs keep the raw sourced rows.

Legend — **CC** Claude Code · **CX** Codex CLI · **OC** opencode · **GC** Gemini CLI ·
**GPT** ChatGPT app · **CL** Claude app · **HM** Hermes.
Verdicts: **BUILD** (needed for parity, next rounds) · **SOON** (valuable, after BUILD) ·
**LATER** (real but not near) · **WON'T** (does not fit Roan's model — see the next section).

## Hard exclusions — Roan's model says no

These exist in mainstream agents and are **deliberately out**:

| Feature | Who has it | Why Roan says no |
|---|---|---|
| Multiple agents / personas (developer agent, therapist agent…) | CC, HM, CX (subagents) | **There is exactly one agent: Roan.** One voice, one memory, one identity per device. Skills cover "different modes of work" without becoming a second agent. |
| Remote steering (phone remote-controls the agent on the PC, `opencode pair`) | OC, CC mobile | The chain is the center, not a machine. Every device runs its own Roan and syncs as a peer — nothing is a remote for something else. The daemon's own web UI (port 6769) is access, not remote control. |
| Team / org / billing / seats | GPT, CL, CX (orgs) | Roan is one person's agent. No accounts, no plans, no metering. |
| Cloud account sync | GPT, CL, CLaude.ai | The chain **is** the sync. No server holds a copy. |
| GPTs / assistant store / plugin marketplace | GPT | No store, no third-party products. Skills are files that travel with the chain. |
| IDE integration (VS Code/JetBrains extension) | CC, CX, OC, GC | Roan is a personal agent, not a coding-IDE product. `run_shell` already does repo work. (LATER at most, as an editor *client* of the 6769 web UI.) |

## 1. Transcript & messages

| Feature | Mainstream | Roan now | Verdict |
|---|---|---|---|
| Markdown rendering (headings, lists, bold, links, tables) | all | ✅ v0.0.12 | done |
| Code blocks with language label + copy chip | CC, GPT, CL | ✅ v0.0.12 | done |
| Copy whole message | GPT, CL, OC | ✅ copy chip under every answer (`CopyChip` in `Transcript.tsx`) | done |
| Edit your sent message → branch from there | GPT, CL | ❌ (chain is append-only) | **SOON** — implement as a checkpoint + branch, never a mutation |
| Regenerate answer | GPT, CL, CC | ✅ `regenerate` frame: a checkpoint marks the seam, the same question is asked again, the new answer lands below | done |
| Thinking / reasoning visibility ("Thinking…", expandable reasoning) | GPT, CL, CC, GC | ✅ the dock opens at `turn_start` (the lock's events are broadcast now) with the phase, and a stuck report after 2 min of silence | done |
| Tool traces kept out of the conversation (silent context fetching) | GPT, CL | ✅ ≥3 internal steps collapse into one "internal steps N" pill | done |
| Message actions row (copy / regenerate / share) | GPT, CL | ✅ copy + regenerate on the answer; no share | done (share below) |
| Read aloud (TTS) | GPT, CL | module only — `src/voice/tts.ts` with a provider contract and tests; nothing plays it | SOON |
| Share / export a conversation (markdown, link) | GPT, CL, CC (`/export`) | ✅ export: markdown, a self-contained escaped HTML file and a JSONL chain, into `exports/` and the Android download window; there is no hosted or revocable link | done for files, no link |

## 2. Composer & input

| Feature | Mainstream | Roan now | Verdict |
|---|---|---|---|
| Multi-line composer, send on Enter | all | ✅ | done |
| Attach files/photos → to the model | GPT, CL, GC | ✅ a photo is resized to 1024px jpeg in the composer and rides the live message as base64 (0.0.20); workspace files travel as `workspace` events and big or binary ones through the `blob` chunk channel | done |
| Dictate (speech → text in composer) | GPT | ❌ the mic is in the composer but disabled: `src/stt/` (registry, provider contract, local plugin) has no capture and nothing passes `onRecord` | **BUILD** |
| Voice conversation mode (call the agent) | GPT, OC | module only — `src/voice/loop.ts` runs listen→think→speak, with no mic and no speaker from the shell | SOON |
| Slash commands (`/models`, `/compact`…) | CC, CX, OC, GC | module only — `src/chain/commands.ts` (parse/fold/expand) and a `SlashMenu` component, neither mounted; the daemon has no `command` request | **BUILD** |
| @-mention files | CC, OC | ✅ (workspace paths) | done |
| Command palette / keyboard shortcuts | CC, OC | ❌ Ctrl-K opens the drawer on the search field; `CommandPalette.tsx` exists and is unmounted | LATER |

## 3. Models & providers

| Feature | Mainstream | Roan now | Verdict |
|---|---|---|---|
| Provider catalog, live (models.dev) | OC | ✅ 304 presets, live `/models` per key | done |
| BYOK, multiple custom providers | OC, GC | ✅ provider_save/pick/remove | done |
| Model picker one tap from chat | GPT, CL, OC | ✅ v0.0.12 sheet | done |
| Reasoning effort / thinking level (low–high) | GPT, CC, GC | ✅ `EffortLevel` in `config.json`, applied per turn and spelled per provider family (`src/providers/effort.ts`, `effort-request.test.ts`); no picker in the app yet | done (no screen) |
| Per-conversation model (not global) | GPT | ❌ — `model_set` still writes one model for the device | **SOON** — model belongs to the session event |
| Usage / cost display | CC, OC | ✅ tokens and cost ride on `turn_end` and print as a line under the answer (`usageLine` in `Transcript.tsx`) | done per turn; no session total |
| Fallback model when one fails | OC | ❌ | LATER |

## 4. Sessions & history

| Feature | Mainstream | Roan now | Verdict |
|---|---|---|---|
| Session list, search, active marker | all | ✅ drawer | done |
| Rename session | GPT, CL, CC | ✅ `rename_session` frame → `session_title` event, pencil per conversation | done |
| Archive / delete | GPT, CL | tombstones only — `session_archive` / `session_delete` append a `session` event and `chain/sessions.ts` folds `archived`/`deleted`; the drawer has no archived view or action | **BUILD** (UI) |
| Resume a session on another device | — (unique to Roan) | ✅ the chain does this | done |
| Branch / fork a conversation | CC (fork), CL (side chats) | ✅ regenerate and rewind start a new conversation with `branchOf`/a checkpoint; there is no tree view | done (no tree UI) |
| Checkpoints & rewind | CC, Roan | ✅ events + checkpoints panel + rewind | done (UI polish SOON) |
| Compact / summarize old context | CC, GC | ✅ `compactMessages` folds everything past 40 messages into a digest on the prompt; `chain/compaction.ts` + `chain/summary.ts` with tests | done |
| Export session (md/json) | CC | ✅ markdown + self-contained HTML per conversation, JSONL for the chain | done |

## 5. Context, memory & skills

| Feature | Mainstream | Roan now | Verdict |
|---|---|---|---|
| Persistent memory across sessions | HM, GPT, CL | ✅ `src/context/memory.ts` + auto-memory step | done — but must become **invisible** in the transcript (see §1) |
| Project instructions file (AGENTS.md / CLAUDE.md) | CC, CX, OC, GC | ✅ AGENTS.md travels with the env | done |
| Skills (task-shaped instructions) | CC, HM | ✅ `SkillLibrary` + `contextTools` put the skill index in every turn's system prompt; skills live in `<home>/skills` and travel in the env snapshot | done |
| Writing style baked in (his own voice, hardcore) | — (unique wish) | partly — the first start writes `SOUL.md`, `IDENTITY.md` and `AGENTS.md` (`src/daemon/bootstrap.ts`) and `buildSystemPrompt` carries them as "Who you are" and the rules; there is **no** `skills/writing-style/` clone in this repo (`src/skills/` holds fold, parse and proposal) | **BUILD** — clone the upstream style skill into `skills/writing-style/` and load it as a rule, not a suggestion |
| Personalization from history | GPT, CL | ✅ memory step | done |

## 6. Tools & permissions

| Feature | Mainstream | Roan now | Verdict |
|---|---|---|---|
| Tool registry with descriptions to the model | all | ✅ `read_file`, `write_file`, `list_dir`, `run_shell`, `browser`, `web_search`, `web_fetch`, `memory`, `skill_view`, `skill_file`, plus `run_on_node`, `delegate` and every MCP server's tools — built by `toolSurface` in `src/tools.ts` | done |
| Approval flow (allow / ask / deny) with a UI card | CC, CX, OC, HM | ✅ `approval_request` events, the card in the transcript with Approve/Deny, an allow learned as `tool_approval` | done |
| Policy file (which tool may what) | CC, OC | partial — `policy.ts`, `shell-allowlist.ts` and `secrets-scan.ts` are tested modules; the live `run_shell` in `src/tools.ts` calls `exec` directly and consults none of them | **BUILD** — put `decide()` in front of the tool call |
| Plan mode (propose first, execute after approval) | CC, GC | ✅ tool list gated per turn, `plan_mode` event, composer toggle, `tests/plan-mode.test.ts` | done |
| Dry-run of destructive tools | — | ✅ `dry-run.ts` | done |
| Run a tool on another device in the chain | — (unique) | ✅ `run_on_node` | done |
| Web search tool | GPT, CL, CC, GC | ✅ `web_search` / `web_fetch` plugins, behind the same tool rules | done |
| Sandboxed/container execution | CC, CX, GC | module only — `src/safety/sandbox.ts` detects and wraps bwrap/landlock/sandbox-exec, tested; the turn does not use it | LATER |

## 7. Integrations

| Feature | Mainstream | Roan now | Verdict |
|---|---|---|---|
| MCP servers (local) | CC, CX, OC, GC | ✅ the server list is chain events and `McpRuntime` dials every enabled one per turn (http + stdio, `src/mcp/client.ts`); a server that does not answer is skipped and logged | done |
| MCP remote (OAuth) | OC, CC | ❌ | LATER |
| Git integration (commit/PR flows) | CC, CX | no git tool — `run_shell` covers `git`, and a `gitpanel/status.ts` parser exists unmounted; no PR flow | LATER |
| Messaging channels (Telegram, Discord…) | HM | ❌ | LATER — the app is the channel now; a gateway channel is possible later via the daemon |

## 8. Automation & notifications

| Feature | Mainstream | Roan now | Verdict |
|---|---|---|---|
| Scheduled tasks / cron | GPT (tasks), HM | ✅ `cron/` + schedules panel | done (UI polish SOON) |
| Workspace folder = the agent's home (OpenClaw-style), twice | OC (workspace home) | ✅ `~/.Roan/` holds `workspace/` (the agent's own desk, per machine) and `synced-workspace/` (every file in it travels as `workspace`/`blob` events), with `state/` for the chain — `paths.ts` + `migrateStateSplit` | done |
| Phone storage as the user home | — (Termux precedent) | ✅ `storage_window` creates the symlink siblings (`shared/ downloads/ dcim/ documents/ pictures/ music/`) next to `.Roan` in the app's `files/`, and refuses with a reason when All files access is missing (`src/daemon/storage-window.ts`, tests) | done (the grant is the owner's) |
| Background turns (app closed) | HM, OC | ✅ Android foreground service owns the node (`RoanService.kt`); on desktop the daemon runs as a systemd user service (`docs/webui.md`) | done |
| Notification when a turn finishes | GPT, CL, HM | ✅ the service tails the daemon's stderr for `notify:turn-done` and posts "Roan is done" | done |
| Hooks (lifecycle events → script) | CC | `hooks.json` runs shell commands at `turn_start` and `turn_end` (`src/hooks/run.ts`, called from `runMessage`); `before_tool`/`after_tool` are declared and never fired | done for two points |

## 9. Devices & surfaces

| Feature | Mainstream | Roan now | Verdict |
|---|---|---|---|
| Phone app with its own daemon | — (unique) | ✅ libnode in-apk | done |
| Desktop app (Win/Mac/Linux) | GPT, CL, CC (desktop) | ✅ Tauri sidecar | done |
| Web UI served by the daemon itself (gateway style) | HM (dashboard), OC (server) | ✅ daemon serves `web/dist` on 6769, same port as `/ws` and `/peer` | done |
| One scalable frontend on every surface | GPT, CL (one app per form factor) | ✅ one web frontend embedded by every shell | **BUILD (keep it honest)** — phone, tablet, desktop and the 6769 web UI render the *same* frontend, scaled by viewport; no per-platform fork of the UI |
| Cross-device sync | GPT, CL (cloud) | ✅ chain (no cloud) | done |
| Push notifications | GPT, CL | ❌ | **SOON** (after in-app notification) |
| Updater | CC, HM | plugin + pubkey + feed endpoint configured (`tauri.conf.json`), `web/src/update.ts` tested; the card sits in a `SettingsPanel` nothing mounts | **BUILD** — mount it, then publish a second version |

## 10. Ops & platform

| Feature | Mainstream | Roan now | Verdict |
|---|---|---|---|
| Runs headless / as a service | CC (headless), HM | ✅ daemon + systemd unit (`docs/webui.md`) | done |
| Update check in-app | CC, HM | the update module is written and tested (`web/src/update.ts`); no mounted screen calls it | **BUILD** |
| Crash/diag log reachable by the user | HM | ✅ `GET /log` on the one port + in-app | done |
| Telemetry | CC (opt-in), others | — | WON'T — no telemetry, ever |

## Priority order (next rounds)

This list was the plan on 2026-11-18. Rounds 1–7 have since landed: transcript
hygiene, the foreground service, the 6769 web UI, approval cards with plan mode,
skills/persona in the prompt, real photo attachments, notifications, compaction,
rename/edit/regenerate via branching, and MCP servers that actually start. The
per-row status above is the current one; `docs/feature-groups.md` has the
per-concept verdict and `docs/goals-progress.md` the ledger of what this branch
proves.

What is genuinely still open on those seven items: editing a sent message
(branch from a checkpoint), push notifications off-device, and cloning the
writing-style skill into `skills/writing-style/`.

## Hermes — the full surface, inventoried from the inside

Hermes is the agent writing this file, so this inventory comes from the running
installation (`/home/roan/.hermes/hermes-agent`) rather than a website: CLI + TUI +
gateway + desktop + dashboard, 42 platform-adapter files, 263 skills, plugins with
host isolation. Per row: what Hermes has, and what Roan does with it — several of
these are deliberately out for Roan even though Hermes has them.

| Hermes feature | What it is | Verdict for Roan |
|---|---|---|
| Messaging gateway, ~20 platforms (Telegram, Discord, Slack, IRC, Feishu…) | The agent lives in a process that survives every window; channels are doors | **SOON (one channel)** — Roan's app is the channel; a daemon-fed Telegram door is possible later, never the core |
| Gateway survives the desktop app | Close the window, the bots keep running | done — the Tauri shell spawns the daemon as a sidecar and the Android foreground service owns it when the app closes |
| Persistent memory + user profile | Facts that survive sessions, injected every turn | done (`src/context/memory.ts`, `memory`/`skill_*` context tools) — invisible in the transcript |
| Skills (263, with curator + auto-update) | Task-shaped instructions loaded when relevant | done for the loading half — `SkillLibrary` + `contextTools` put the index in every prompt and `skill_view` reads one; no curator or auto-update |
| Cron scheduler + background processes with notify-on-exit | Work happens when you are not there | cron done, notification done (the service tails `notify:turn-done`); notify-on-exit for a *process* is not built |
| Delegation / subagents with structured output | A fresh context does a subtask and reports back | WON'T as a product — one agent; a single `delegate` tool rides in the relay set for a self-contained task |
| Terminal with background jobs + PTY | Real shell, tracked processes | done for `run_shell` (timeout, process group, output cap); no PTY and no job list |
| Browser automation + computer use | A real browser driven for logins and scraping | browser done as a core tool (`BROWSER_CDP_URL`); computer use is a module only (§6) |
| Web search / extract | Grounded answers with sources | done — `web_search` / `web_fetch` plugins |
| Model catalog + `/model` picker + thinking levels | Live provider catalog, switch mid-session | done (304 presets, sheet); effort levels done in the daemon, no picker (§3) |
| Context compression | Old turns folded so the prompt stays affordable | done — `compactMessages` past 40 messages (`chain/compaction.ts`, `chain/summary.ts`) |
| Session search / session librarian | Find anything back across sessions | done in the drawer (Ctrl-K over titles and the message text the client holds) |
| Goals / standing goals | A persistent target the agent keeps working toward | done — `goal`/`goal_update` events, `goalContext()` in every prompt, GoalsPanel |
| Plugin system + catalog + host isolation | Third-party code, isolated | done for the loader (bundled + home drop-in, manifests); no catalog, no host isolation |
| MCP client + MCP catalog | External tools through a standard | done — `McpRuntime` dials the chain's servers, tools gated (§7) |
| Kanban board | Tracked work items | LATER |
| Connectors (Gmail, Notion, Linear…) | Hosted app accounts through one auth | module only — read-only GitHub (`src/connectors/github.ts`), no route |
| TTS / vision / clarify / todo | Speak, see images, ask instead of guess, track tasks | vision done (photos ride the message), clarify done (approval cards), todo LATER, TTS module only |
| Profiles (one process, several identities) | Several "persons" on one install | WON'T — one agent, one identity |
| Updater with fleet verification | Updates without breaking running bots | **BUILD** — the card is unmounted (§9) |

## OpenClaw — delivered: 136 sourced features

The user's previous agent, and the origin of Roan's home concept. Full inventory in
`docs/research/features/openclaw.json` (136 rows, docs.openclaw.ai URLs); these are the
rows that decide something for Roan.

| OpenClaw feature | What it is | Verdict for Roan |
|---|---|---|
| Gateway daemon per host | One long-lived process owns sessions/tools/events; every surface is a client of it | **confirmed shape** — third vendor after Hermes and opencode's background service; Roan's daemon is right |
| Workspace home | `~/.openclaw/workspace` with AGENTS.md, SOUL.md, IDENTITY.md, USER.md, MEMORY.md as editable Markdown | done — `ensureBootstrapFiles` writes SOUL.md, IDENTITY.md and AGENTS.md on first start; USER/MEMORY ride the chain |
| BOOTSTRAP.md first-run ritual | On a fresh workspace the agent seeds its own files and walks through picking an identity, then deletes the bootstrap file | done in the seeding half (`src/daemon/bootstrap.ts`); there is no interview step |
| Node devices | Companion devices pair as thin nodes: camera, screen recording, location, SMS, notifications via `node.invoke` | **WON'T as-is** — Roan devices are full peers, never thin clients; worth stealing is the device-command set (camera/screenshot/notify between Roan's own instances) — SOON after round 2 |
| 33 chat channels | Same agent on WhatsApp/Telegram/Discord/iMessage/… simultaneously | WON'T — the app is the channel; a Telegram door can come later, never the core |
| Markdown memory | MEMORY.md curated facts + `memory/YYYY-MM-DD.md` daily notes distilled over time; no hidden state | done for the distilled file — turn-end `distilMemories` → `memory` events → folded `MEMORY.md` (`src/context/memory-md.ts`); no daily-notes sweep |
| Skill Workshop 2.0 | Agent saves its own skills with change history and undo | module only — `src/skills/proposal.ts` keeps proposals inert until approved |
| Session search / compaction / `/btw` side chats | Recall across transcripts; summarizing long chats; ephemeral side questions | search and compaction done; `/btw` is a module only (`src/side/`) |
| Standing orders | Permanent operating authority injected every session, combinable with automations | = the goals row (§5) — done |
| Public conversation links | Revocable read-only snapshot of a session | LATER |
| Mermaid diagrams in chat | Rendered across chat surfaces | LATER — the markdown renderer exists (`Markdown.tsx`); no mermaid |
| Doctor + triage | Read-only health checks with fixes; a broken install becomes a diagnosis prompt | module only — `health.ts` / `diagnostics.ts` have no caller and no test (§10) |
| Telemetry: one daily version check | Nothing phones home except a version ping (opt-in stats) | Roan is stricter — zero; keep it that way |

## Sourced inventories — delivered

The verification passes came back: **1,024 sourced features across 23 surfaces** —
every mainstream harness and consumer app, every row with an official-doc URL, stored
machine-readable under `docs/research/features/` (index in its README). These files are
the raw source; this document is the Roan verdict on top of them.

| Inventory | Features | File |
|---|---|---|
| Claude Code | 89 | `docs/research/features/claude-code.json` |
| Codex CLI | 70 | `docs/research/features/codex-cli.json` |
| opencode | 69 | `docs/research/features/opencode.json` |
| Gemini CLI | 47 | `docs/research/features/gemini-cli.json` |
| ChatGPT (apps + desktop) | 58 | `docs/research/features/chatgpt.json` |
| Claude (apps + desktop + web) | 45 | `docs/research/features/claude.json` |
| Gemini (app) | 51 | `docs/research/features/gemini.json` |
| OpenClaw | 136 | `docs/research/features/openclaw.json` |
| Google Antigravity | 43 | `docs/research/features/antigravity.json` |
| Pi + Oh My Pi | 25+19 | `docs/research/features/pi.json`, `oh-my-pi.json` |
| DeepSeek Harness | 33 | `docs/research/features/deepseek-harness.json` |
| Aider | 44 | `docs/research/features/aider.json` |
| Cline + Roo Code | 49+42 | `docs/research/features/cline.json`, `roo-code.json` |
| Goose | 26 | `docs/research/features/goose.json` |
| OpenHands | 50 | `docs/research/features/openhands.json` |
| Qwen Code | 26 | `docs/research/features/qwen-code.json` |
| Amp | 19 | `docs/research/features/amp.json` |
| GitHub Copilot CLI | 21 | `docs/research/features/copilot-cli.json` |
| Cursor | 27 | `docs/research/features/cursor.json` |
| Crush | 14 | `docs/research/features/crush.json` |
| Zed Agent | 21 | `docs/research/features/zed-agent.json` |
| **Total** | **1,024** | |

Notes from the pass worth keeping: Gemini CLI's unpaid tier moved to the new Antigravity
CLI on 2026-06-18 (so "gemini-cli" as a reference is partly historical — Antigravity gets
its own inventory), and opencode ships a per-user background service every client connects
to — the same daemon-first shape Roan uses, from a second vendor.

## Second wave — the signals that matter for Roan

Fifteen more surfaces delivered (459 features). Most rows confirm decisions already
made; these are the ones that change or sharpen something:

| Signal | Who has it | Verdict for Roan |
|---|---|---|
| Daemon + web shell + channels (`qwen serve`) | Qwen Code | **confirmed again** — fourth vendor after Hermes, opencode, OpenClaw: an always-on local daemon that surfaces plug into is the mainstream shape, not the exception |
| `/grill-me` — interview the user before implementing | Antigravity | **SOON** — the clarify pattern belongs in Roan's big-work flow: ask before building, not after guessing |
| Stuck detector — catch a looping agent and handle it | OpenHands | done — a turn reports after 2 min of silence and owns up at 5 (`src/turn/lock.ts`) |
| Persistent permission grants | Antigravity, Copilot CLI (trusted dirs) | done — `tool_approval` events, learned per tool, resettable in the Tools panel |
| Tree sessions with branch UI (`/tree`, fork any entry) | Pi | = the round-1 regenerate/branch row; Pi confirms the UI shape (no tree view yet) |
| Checkpoints via shadow-git (files + conversation) | Cline, Qwen Code | = checkpoints row; the conversation half exists, file snapshots do not |
| Dirty-file isolation + attributed commits | Aider | LATER — when Roan edits a git repo: user changes and agent changes stay separable |
| Goals as first-class (`/goal`, `ctx.goals`) | Antigravity, DeepSeek Harness | done — `goal`/`goal_update` events and `goalContext()` in every prompt |
| Read-only conversation sharing (gist / revocable links) | Pi, OpenClaw | LATER — the HTML export exists; no link |
| Voice dictation fully on-device | Copilot CLI | module only — `src/stt/` with a local provider contract; no capture |
| Cloud orbs — agent keeps working, laptop closed | Amp | WON'T — Roan's always-on device is the node; Amp's "idle costs nothing" discipline is how background turns should behave |
| Everything-is-a-plugin, including the agent loop | DeepSeek Harness | WON'T — Roan keeps one tight core; skills are the extension surface |
| Configure by asking (natural-language settings) | Crush | LATER — a "tell Roan what to change" path in settings |
| ACP — editors drive external agents | Zed, Cline, Copilot, Cursor, Antigravity, opencode | WON'T — Roan is not an engine inside an editor; the app is the whole product |

Coverage is now complete for every mainstream harness of November 2026 (consumer chat
apps live separately in `docs/mobile-app-patterns.md` with their inventories in this
folder). What remains open: none.
