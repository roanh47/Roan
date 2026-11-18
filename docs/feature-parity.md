# Roan feature parity — what mainstream agents have, and what Roan does with it

Date: 2026-11-18. Sources: the agents' official docs (verification subagents running,
source URLs will be added where marked), `docs/mobile-app-patterns.md`,
`docs/reference-apps-apk-analysis.md` (ChatGPT APK), the Roan repo itself, and Hermes'
own surface (I am that).

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
| IDE integration (VS Code/JetBrains extension) | CC, CX, OC, GC | Roan is a personal agent, not a coding-IDE product. `exec`/`git` tools already do repo work. (LATER at most, as an editor *client* of the 6769 web UI.) |

## 1. Transcript & messages

| Feature | Mainstream | Roan now | Verdict |
|---|---|---|---|
| Markdown rendering (headings, lists, bold, links, tables) | all | ✅ v0.0.12 | done |
| Code blocks with language label + copy chip | CC, GPT, CL | ✅ v0.0.12 | done |
| Copy whole message | GPT, CL, OC | ❌ | **BUILD** — trivial, expected by everyone |
| Edit your sent message → branch from there | GPT, CL | ❌ (chain is append-only) | **SOON** — implement as a checkpoint + branch, never a mutation |
| Regenerate answer | GPT, CL, CC | ❌ | **SOON** — same trick: branch from before the assistant event |
| Thinking / reasoning visibility ("Thinking…", expandable reasoning) | GPT, CL, CC, GC | partial — phase line exists (`thinking/writing/running X`) but silent on his phone | **BUILD** — always show the phase, show reasoning tokens when the provider sends them |
| Tool traces kept out of the conversation (silent context fetching) | GPT, CL | ❌ — memory/prompt context runs show as INPUT/OUTPUT blocks in the chat (the "chat 2×" report) | **BUILD** — internal context steps are hidden by default, behind a details toggle |
| Message actions row (copy / regenerate / share) | GPT, CL | ❌ | **SOON** (follows the two rows above) |
| Read aloud (TTS) | GPT, CL | ❌ | LATER |
| Share / export a conversation (markdown, link) | GPT, CL, CC (`/export`) | ❌ — TODO #11 already says so | **SOON** |

## 2. Composer & input

| Feature | Mainstream | Roan now | Verdict |
|---|---|---|---|
| Multi-line composer, send on Enter | all | ✅ | done |
| Attach files/photos → to the model | GPT, CL, GC | partial — `@path` references into the synced workspace, no real upload | **BUILD** — real upload into the workspace + image/file content into the turn |
| Dictate (speech → text in composer) | GPT | ✅ where the WebView ships it | done (verify on his phone) |
| Voice conversation mode (call the agent) | GPT, OC | ❌ | LATER |
| Slash commands (`/models`, `/compact`…) | CC, CX, OC, GC | ❌ | **SOON** — the app already routes everything through the daemon; commands are sugar |
| @-mention files | CC, OC | ✅ (workspace paths) | done |
| Command palette / keyboard shortcuts | CC, OC | ❌ | LATER |

## 3. Models & providers

| Feature | Mainstream | Roan now | Verdict |
|---|---|---|---|
| Provider catalog, live (models.dev) | OC | ✅ 304 presets, live `/models` per key | done |
| BYOK, multiple custom providers | OC, GC | ✅ provider_save/pick/remove | done |
| Model picker one tap from chat | GPT, CL, OC | ✅ v0.0.12 sheet | done |
| Reasoning effort / thinking level (low–high) | GPT, CC, GC | ❌ | **SOON** — pass `reasoning_effort` where the provider supports it |
| Per-conversation model (not global) | GPT | ❌ — pick is global | **SOON** — model belongs to the session event |
| Usage / cost display | CC, OC | ❌ | LATER |
| Fallback model when one fails | OC | ❌ | LATER |

## 4. Sessions & history

| Feature | Mainstream | Roan now | Verdict |
|---|---|---|---|
| Session list, search, active marker | all | ✅ drawer | done |
| Rename session | GPT, CL, CC | ❌ | **BUILD** |
| Archive / delete | GPT, CL | ❌ | **SOON** (delete is in the chain already as an event — needs UI) |
| Resume a session on another device | — (unique to Roan) | ✅ the chain does this | done |
| Branch / fork a conversation | CC (fork), CL (side chats) | partial — `branchOf` exists in the event, no UI | **SOON** |
| Checkpoints & rewind | CC, Roan | ✅ events + checkpoints panel + rewind | done (UI polish SOON) |
| Compact / summarize old context | CC, GC | ❌ | **BUILD** — the chain grows forever; without compaction turns get slow and dumb |
| Export session (md/json) | CC | ❌ | **SOON** (pairs with share/export above) |

## 5. Context, memory & skills

| Feature | Mainstream | Roan now | Verdict |
|---|---|---|---|
| Persistent memory across sessions | HM, GPT, CL | ✅ `src/context/memory.ts` + auto-memory step | done — but must become **invisible** in the transcript (see §1) |
| Project instructions file (AGENTS.md / CLAUDE.md) | CC, CX, OC, GC | ✅ AGENTS.md travels with the env | done |
| Skills (task-shaped instructions) | CC, HM | partial — `skills.ts` + `skills_list`, no real skill loading into turns yet | **BUILD** — load skills like Hermes does, selectable, traveling with the chain |
| Writing style baked in (his own voice, hardcore) | — (unique wish) | TODO.md records the wish, no enforcement | **BUILD** — the style skill lives **cloned inside this repo** (`skills/writing-style/`, git remote `upstream` → `github.com/roanh47/Roans-Writing-Style-Skill`), so it ships with every clone and stays updatable from upstream; the turn prompt loads it as a rule you can measure answers against, not a suggestion |
| Personalization from history | GPT, CL | ✅ memory step | done |

## 6. Tools & permissions

| Feature | Mainstream | Roan now | Verdict |
|---|---|---|---|
| Tool registry with descriptions to the model | all | ✅ 21 tools (exec, git, glob, search, patch, http, todo, tree…) | done |
| Approval flow (allow / ask / deny) with a UI card | CC, CX, OC, HM | partial — `policy.ts` + `tools_list` exist; no ask-card in the app | **BUILD** — the ask flow is the single most agent-defining UI there is |
| Policy file (which tool may what) | CC, OC | ✅ `policy.ts`, shell-allowlist, secrets-scan | done |
| Plan mode (propose first, execute after approval) | CC, GC | ❌ | **BUILD** — pairs with the approval card |
| Dry-run of destructive tools | — | ✅ `dry-run.ts` | done |
| Run a tool on another device in the chain | — (unique) | ✅ `run_on_node` | done |
| Web search tool | GPT, CL, CC, GC | ❌ | **SOON** — as a tool with the same approval rules |
| Sandboxed/container execution | CC, CX, GC | ❌ (allowlist only) | LATER |

## 7. Integrations

| Feature | Mainstream | Roan now | Verdict |
|---|---|---|---|
| MCP servers (local) | CC, CX, OC, GC | partial — `mcp.json` travels, **servers never start** | **BUILD** — the file existing but doing nothing is a lie the UI currently tells |
| MCP remote (OAuth) | OC, CC | ❌ | LATER |
| Git integration (commit/PR flows) | CC, CX | ✅ git tool (commit-level); PR flows not | LATER |
| Messaging channels (Telegram, Discord…) | HM | ❌ | LATER — the app is the channel now; a gateway channel is possible later via the daemon |

## 8. Automation & notifications

| Feature | Mainstream | Roan now | Verdict |
|---|---|---|---|
| Scheduled tasks / cron | GPT (tasks), HM | ✅ `cron/` + schedules panel | done (UI polish SOON) |
| Workspace folder = the agent's home (OpenClaw-style), twice | OC (workspace home) | ✅ two folders exist under `~/.roan/`: `workspace/` (local) and `synced-workspace/` (syncs via chain events) — but `workspace/` currently holds only the DB + cron state, not an agent home | **BUILD** — `workspace/` becomes the agent's *local* home (exec cwd, scratch, device-private files), `synced-workspace/` the *synced* home; both in the same parent; DB/state move to their own dir. Home is **`~/.Roan`** with a capital (decided 2026-11-18), auto-migrated from `~/.roan` once |
| Phone storage as the user home | — (Termux precedent) | ❌ app has only INTERNET | **BUILD** — on Android the app's `files/` dir *is* the user home: `.Roan/` (agent) plus symlink siblings `shared/ downloads/ dcim/ documents/ pictures/ music/` → `/storage/emulated/0/…`, created when the user flips an "All files access" toggle. Same shape as a desktop home: agent brain inside, user stuff beside it, one path guard ("within the home"). No copies, no bridge — tools read the real files |
| Background turns (app closed) | HM, OC | ❌ on phone — daemon is a thread in the app process | **BUILD** — Android foreground service; this is *his* "daemon runs without the app open" wish. On desktop the daemon already runs as a systemd user service (`docs/webui.md`), independent of any app window |
| Notification when a turn finishes | GPT, CL, HM | ❌ | **BUILD** — otherwise you stare at a spinner |
| Hooks (lifecycle events → script) | CC | partial — `src/hooks/run.ts` exists | LATER (surface later) |

## 9. Devices & surfaces

| Feature | Mainstream | Roan now | Verdict |
|---|---|---|---|
| Phone app with its own daemon | — (unique) | ✅ libnode in-apk | done |
| Desktop app (Win/Mac/Linux) | GPT, CL, CC (desktop) | ✅ Tauri sidecar | done |
| Web UI served by the daemon itself (gateway style) | HM (dashboard), OC (server) | ✅ `scripts/webui.mjs` port 6769 — **must be verified to serve the 0.0.12 UI** | **BUILD (verify + promote)** — one frontend, three shells, daemon-first |
| One scalable frontend on every surface | GPT, CL (one app per form factor) | ✅ one web frontend embedded by every shell | **BUILD (keep it honest)** — phone, tablet, desktop and the 6769 web UI render the *same* frontend, scaled by viewport; no per-platform fork of the UI |
| Cross-device sync | GPT, CL (cloud) | ✅ chain (no cloud) | done |
| Push notifications | GPT, CL | ❌ | **SOON** (after in-app notification) |
| Updater | CC, HM | partial — Tauri updater plugin configured for desktop | **SOON** — releases + `latest.json` already exist in CI |

## 10. Ops & platform

| Feature | Mainstream | Roan now | Verdict |
|---|---|---|---|
| Runs headless / as a service | CC (headless), HM | ✅ daemon + systemd unit (`docs/webui.md`) | done |
| Update check in-app | CC, HM | ❌ mobile | SOON |
| Crash/diag log reachable by the user | HM | ✅ log server :7413 + in-app | done |
| Telemetry | CC (opt-in), others | — | WON'T — no telemetry, ever |

## Priority order (next rounds)

1. **Transcript hygiene + always-visible phase** (§1) — kills the "chat 2×" illusion and the silent thinking
2. **Foreground service** (§8) — daemon lives without the app, his explicit wish
3. **Web UI on 6769 verified and promoted** (§9) — daemon-first frontend for all platforms
4. **Approval cards + plan mode** (§6)
5. **Skills really loading + writing style enforced** (§5)
6. **Attachments (real upload)** (§2) and **notifications** (§8)
7. **Compact** (§4), **rename/edit/regenerate via branching** (§1, §4), **MCP servers actually starting** (§7)

## Hermes — the full surface, inventoried from the inside

Hermes is the agent writing this file, so this inventory comes from the running
installation (`/home/roan/.hermes/hermes-agent`) rather than a website: CLI + TUI +
gateway + desktop + dashboard, 42 platform-adapter files, 263 skills, plugins with
host isolation. Per row: what Hermes has, and what Roan does with it — several of
these are deliberately out for Roan even though Hermes has them.

| Hermes feature | What it is | Verdict for Roan |
|---|---|---|
| Messaging gateway, ~20 platforms (Telegram, Discord, Slack, IRC, Feishu…) | The agent lives in a process that survives every window; channels are doors | **SOON (one channel)** — Roan's app is the channel; a daemon-fed Telegram door is possible later, never the core |
| Gateway survives the desktop app | Close the window, the bots keep running | **BUILD** — this is exactly the foreground-service / daemon-alive wish; the daemon is the gateway-equivalent |
| Persistent memory + user profile | Facts that survive sessions, injected every turn | done (`src/context/memory.ts`) — must stay invisible in the transcript |
| Skills (263, with curator + auto-update) | Task-shaped instructions loaded when relevant | **BUILD** — same idea, files that travel with the chain; writing-style upstream is the first one |
| Cron scheduler + background processes with notify-on-exit | Work happens when you are not there | cron done; background-notify **BUILD** (foreground service) |
| Delegation / subagents with structured output | A fresh context does a subtask and reports back | WON'T — one agent, his rule; `run_on_node` already moves *where* a turn runs |
| Terminal with background jobs + PTY | Real shell, tracked processes | done (exec + allowlist) |
| Browser automation + computer use | A real browser driven for logins and scraping | LATER — as a tool behind the same approval flow |
| Web search / extract | Grounded answers with sources | **SOON** (web-search tool row in §6) |
| Model catalog + `/model` picker + thinking levels | Live provider catalog, switch mid-session | done (304 presets, sheet); thinking levels SOON |
| Context compression | Old turns folded so the prompt stays affordable | **BUILD** (the compact row in §4) |
| Session search / session librarian | Find anything back across sessions | **SOON** — the chain is one database; search is a query |
| Goals / standing goals | A persistent target the agent keeps working toward | **SOON** — fits the chain model; a goal is an event |
| Plugin system + catalog + host isolation | Third-party code, isolated | LATER — skills-first; a plugin API is a later decision |
| MCP client + MCP catalog | External tools through a standard | **BUILD** (mcp.json must actually start servers, §7) |
| Kanban board | Tracked work items | LATER |
| Connectors (Gmail, Notion, Linear…) | Hosted app accounts through one auth | LATER |
| TTS / vision / clarify / todo | Speak, see images, ask instead of guess, track tasks | TTS LATER, vision **SOON** (images in turns), clarify **BUILD** (part of approval cards), todo done |
| Profiles (one process, several identities) | Several "persons" on one install | WON'T — one agent, one identity |
| Updater with fleet verification | Updates without breaking running bots | **SOON** (§9 updater row) |

## OpenClaw — delivered: 136 sourced features

The user's previous agent, and the origin of Roan's home concept. Full inventory in
`docs/research/features/openclaw.json` (136 rows, docs.openclaw.ai URLs); these are the
rows that decide something for Roan.

| OpenClaw feature | What it is | Verdict for Roan |
|---|---|---|
| Gateway daemon per host | One long-lived process owns sessions/tools/events; every surface is a client of it | **confirmed shape** — third vendor after Hermes and opencode's background service; Roan's daemon is right |
| Workspace home | `~/.openclaw/workspace` with AGENTS.md, SOUL.md, IDENTITY.md, USER.md, MEMORY.md as editable Markdown | **BUILD (round 2)** — Roan keeps the home; SOUL.md-style persona + IDENTITY file is the part Roan hasn't planned yet: adopt |
| BOOTSTRAP.md first-run ritual | On a fresh workspace the agent seeds its own files and walks through picking an identity, then deletes the bootstrap file | **BUILD** — Roan's onboarding can seed `.Roan/workspace` the same way; cheap, fits round 2 |
| Node devices | Companion devices pair as thin nodes: camera, screen recording, location, SMS, notifications via `node.invoke` | **WON'T as-is** — Roan devices are full peers, never thin clients; worth stealing is the device-command set (camera/screenshot/notify between Roan's own instances) — SOON after round 2 |
| 33 chat channels | Same agent on WhatsApp/Telegram/Discord/iMessage/… simultaneously | WON'T — the app is the channel; a Telegram door can come later, never the core |
| Markdown memory | MEMORY.md curated facts + `memory/YYYY-MM-DD.md` daily notes distilled over time; no hidden state | **BUILD later** — the distillation pattern (dailies → curated file) fits Roan's memory once the home exists |
| Skill Workshop 2.0 | Agent saves its own skills with change history and undo | LATER — after skills travel with the chain |
| Session search / compaction / `/btw` side chats | Recall across transcripts; summarizing long chats; ephemeral side questions | matches existing SOON rows (session search, compaction) |
| Standing orders | Permanent operating authority injected every session, combinable with automations | = the goals row (§5) — SOON |
| Public conversation links | Revocable read-only snapshot of a session | LATER |
| Mermaid diagrams in chat | Rendered across chat surfaces | LATER — markdown renderer first (round 1) |
| Doctor + triage | Read-only health checks with fixes; a broken install becomes a diagnosis prompt | **SOON** — belongs in the updater round (§9): Roan should be able to say what's wrong with itself |
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
| Stuck detector — catch a looping agent and handle it | OpenHands | **BUILD (round 1)** — next to the always-visible thinking state: a turn that runs too long surfaces itself, never an eternal spinner |
| Persistent permission grants | Antigravity, Copilot CLI (trusted dirs) | **SOON** — approvals learn: same allow twice → remember per workspace |
| Tree sessions with branch UI (`/tree`, fork any entry) | Pi | = the round-1 regenerate/branch row; Pi confirms the UI shape |
| Checkpoints via shadow-git (files + conversation) | Cline, Qwen Code | = checkpoints row; shadow-git is the cheap implementation pattern |
| Dirty-file isolation + attributed commits | Aider | LATER — when Roan edits a git repo: user changes and agent changes stay separable |
| Goals as first-class (`/goal`, `ctx.goals`) | Antigravity, DeepSeek Harness | third and fourth confirmation of the goals row (§5) — SOON stands |
| Read-only conversation sharing (gist / revocable links) | Pi, OpenClaw | LATER — cheap once transcript export exists |
| Voice dictation fully on-device | Copilot CLI | **SOON** — matches the mic plan: on-device speech when the WebView offers it, no cloud call |
| Cloud orbs — agent keeps working, laptop closed | Amp | WON'T — Roan's always-on device is the node; Amp's "idle costs nothing" discipline is how background turns should behave |
| Everything-is-a-plugin, including the agent loop | DeepSeek Harness | WON'T — Roan keeps one tight core; skills are the extension surface |
| Configure by asking (natural-language settings) | Crush | LATER — a "tell Roan what to change" path in settings |
| ACP — editors drive external agents | Zed, Cline, Copilot, Cursor, Antigravity, opencode | WON'T — Roan is not an engine inside an editor; the app is the whole product |

Coverage is now complete for every mainstream harness of November 2026 (consumer chat
apps live separately in `docs/mobile-app-patterns.md` with their inventories in this
folder). What remains open: none.
