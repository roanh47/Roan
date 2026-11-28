# UI Overhaul — ChatGPT-parity round (v0.0.12) Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Fix every complaint from the 0.0.11 phone test: English UI everywhere, markdown in the transcript, a provider/model flow that works (all models.dev providers, easy model picking, keys per provider), a slim ChatGPT-style drawer, and a composer with attach + dictate — verified on the emulator, shipped as one apk.

**Architecture:** The web app (`web/src`) is the only UI; the daemon (`src/daemon`) serves provider/model state over the existing control socket. Presets stop being a hardcoded list and come from the live models.dev catalog (same source/pattern as `models_search`). A new ModelSheet makes model picking a one-tap sheet instead of a settings sub-list. Markdown is a small dependency-free renderer.

**Tech Stack:** React 19 + TypeScript (web/), node:test (root tests), vitest (new, web/), apktool-verified reference: `docs/research/reference-apps-apk-analysis.md`.

**Ground rules:** UI copy is **English** (user has corrected this twice — record it, never retranslate). Commit locally after each task; **no push without explicit approval**. Emulator only for the final verification round (fans).

---

## Current state (what the phone test found)

| Complaint | Root cause found in code |
|---|---|
| "Nederlands" | I translated the UI to Dutch; partially reverted (Transcript.tsx, session titles) — App.tsx still Dutch (placeholder, onboarding, drawer, invite, sync line) |
| "MARKDOWN is geen ding" | `web/src/components/Transcript.tsx` renders `white-space: pre-wrap` text, nothing else |
| "Keys instellen is buggy" | `web/src/panels/ProvidersPanel.tsx`: one global key input at top; tapping a provider without a key pasted → error status; key draft cleared on every save; no per-provider edit |
| "Niet alle providers van models.dev" | `src/daemon/providers.ts:28-39` — `PRESETS` is a hardcoded list of 10 |
| "Modellen kiezen is niet makkelijk" | Models are an inline sub-list inside Settings; the model pill in chat just jumps to Settings |
| "Zijbalk heeft te veel dingen" | Drawer carries panels + invite + sync line; ChatGPT's drawer is New chat / search / chats / settings only (see `docs/research/reference-apps-apk-analysis.md`) |
| LM Studio row clipped | `.conversation--panel` padding-bottom (40px) too small under the gesture bar |
| "local-model" pill confusion | Pill shows `snapshot.model` which is null → falls back to a stale default string; when no model is chosen it must say "Select a model" |

---

### Task 1: Finish the English sweep in App.tsx

**Objective:** Every user-visible string in the app is English.

**Files:**
- Modify: `web/src/App.tsx:119-123` (placeholder), `:146-231` (onboarding block), `:300-397` (drawer: Nieuw gesprek, Zoek gesprekken, Panelen, Instellingen, sync line), `:416-444` (InviteBlock)

**Steps:**
1. Replace the placeholder ternary:

```tsx
const placeholder = turn
  ? `${turn.owner} is working…`
  : blocked
    ? "Waiting for the daemon…"
    : "Message Roan";
```

2. Onboarding: "Start on this device" / "A chain is the conversation and everything around it. Create one here, or join one that already exists — joining takes the chain's history as your own." / "Create a new chain" / "or" / "Join an existing chain" / placeholder "code from the other device" / "Join" / "The daemon is running on this device." / "Waiting for the daemon to answer." / "Daemon log" / "Load log" / "Code for the next device".
3. Drawer: "New chat" / "Search chats" / "Settings" / sync line: `{node} · {peer !== null ? "syncing" : "this device only"} · {status === "open" ? "daemon on" : "waiting for daemon"}`.
4. InviteBlock: "Invite a device" / "Copy" / "Copied".
5. Scrim aria-label "Close menu".

**Verify:** `grep -nE 'bezig|wachten|kies|toestel|keten|gesprek|Zoek|instelling|Panelen|Nodig|Meedoen|plak|draait' web/src/App.tsx web/src/components/*.tsx web/src/panels/*.tsx` → no hits. `npm --prefix web run build` passes.

**Commit:** `fix(ui): the app speaks English, everywhere`

---

### Task 2: Markdown renderer + vitest in web/

**Objective:** Assistant messages render markdown: headings, **bold**, *italic*, `inline code`, fenced code blocks (with Copy chip), lists, links, blockquotes, tables.

**Files:**
- Create: `web/src/markdown.ts` (pure parser: text → block tree)
- Create: `web/src/components/Markdown.tsx` (tree → React)
- Create: `web/src/markdown.test.ts`
- Modify: `web/package.json` (add `vitest` devDependency + `"test": "vitest run"`)

**Design:** No dependency. The parser is ~120 lines of line-based block splitting (fenced code first — a fence swallows everything until its closer — then headings `#{1,3}`, `> quote`, `- ` / `1. ` lists, `|` tables, blank-line paragraphs) plus one inline pass (`` `code` ``, `**bold**`, `*italic*`, `[text](url)` with `https?://` only). React escapes all text nodes; never build HTML strings. Streaming-safe: it re-parses per render; message sizes are small.

**Parser sketch:**

```ts
export type Block =
  | { kind: "code"; lang: string; text: string }
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "quote"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "table"; rows: string[][] }
  | { kind: "para"; text: string };

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().length === 0) { i++; continue; }
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) body.push(lines[i++]);
      i++; // closing fence
      blocks.push({ kind: "code", lang, text: body.join("\n") });
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) { blocks.push({ kind: "heading", level: heading[1].length as 1|2|3, text: heading[2] }); i++; continue; }
    if (/^>\s?/.test(line)) { const body: string[] = []; while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, "")); blocks.push({ kind: "quote", text: body.join("\n") }); continue; }
    if (/^\s*[-*]\s+/.test(line)) { const items: string[] = []; while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*]\s+/, "")); blocks.push({ kind: "list", ordered: false, items }); continue; }
    if (/^\s*\d+\.\s+/.test(line)) { const items: string[] = []; while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+\.\s+/, "")); blocks.push({ kind: "list", ordered: true, items }); continue; }
    if (/^\|.*\|$/.test(line) && i + 1 < lines.length && /^\|[-: |]+\|$/.test(lines[i + 1])) { /* table: header, separator, body rows split on "|" */ continue; }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim().length > 0 && !/^(#{1,3}\s|```|>|\s*[-*]\s|\s*\d+\.\s|\|)/.test(lines[i])) para.push(lines[i++]);
    blocks.push({ kind: "para", text: para.join("\n") });
  }
  return blocks;
}
```

Inline pass renders `**bold**` / `` `code` `` / `[t](https://…)` as React nodes; unmatched stars stay literal.

**Tests (vitest):** fence with backticks inside, unclosed fence (streaming mid-block → renders as code so far), heading levels, nested list markers not required, table with pipes in cells, inline code inside bold, link with non-http scheme stays plain text, empty input → [].

**Steps:**
1. `cd web && npm i -D vitest` ; add `"test": "vitest run"` to scripts.
2. Write `markdown.test.ts` first, run `npm --prefix web run test` → fails (module missing).
3. Implement `markdown.ts` + `Markdown.tsx`.
4. `npm --prefix web run test` → green; `npm --prefix web run build` → green.

**Commit:** `feat(web): markdown renderer with code-block copy chip`

---

### Task 3: Render assistant messages as markdown

**Objective:** The transcript uses the renderer; code blocks get a Copy chip.

**Files:**
- Modify: `web/src/components/Transcript.tsx` (assistant branch of `RowView`)
- Modify: `web/src/styles.css` (`.md` styles: headings sized 1.25/1.15/1.05em, `pre.md__code` dark panel `#0a0c0f` + mono 12.5px + overflow-x auto, `.md__chip` copy button top-right, list padding, blockquote left border, table borders collapse)

**Steps:**
1. In `RowView` assistant case: `<div className="answer"><Markdown source={row.text} /></div>`; keep the caret for empty streaming text.
2. Copy chip: local `useState(copied)`, `navigator.clipboard?.writeText(code)` — same pattern as InviteBlock.
3. User bubbles stay plain text (ChatGPT renders user input plain too).

**Verify:** emulator round (Task 11) sends a mock answer containing `# Heading`, a fenced block, a list, and `**bold**`; screenshot shows rendered markdown.

**Commit:** `feat(web): transcript renders markdown`

---

### Task 4: Presets from the live models.dev catalog

**Objective:** The Add-a-provider list is every OpenAI-compatible provider models.dev knows (~100+), not 10.

**Files:**
- Modify: `src/daemon/providers.ts` (PRESETS → `presetsFromCatalog`)
- Modify: `src/daemon/main.ts` (`providers_list` handler: presets = catalog-derived + saved accounts filter)
- Test: root test file `tests/providers-catalog.test.ts` (follow the existing test layout under `tests/`)

**Design:** `src/providers/live.ts` already fetches models.dev with a browser UA, 5-min cache, snapshot fallback, and `models_search` uses it. Reuse `loadCatalog()`. In api.json each provider has `baseUrl` when it exposes an OpenAI-compatible endpoint (`openai_compatible`/`baseUrl` fields — inspect the snapshot at `src/providers/` during implementation and filter on exactly what it carries).

```ts
// providers.ts
import { loadCatalog } from "../providers/live.js";

export async function providerPresets(): Promise<Preset[]> {
  const catalog = await loadCatalog();
  const presets: Preset[] = [];
  for (const [id, p] of Object.entries(catalog.providers ?? {})) {
    const baseUrl = p.baseUrl; // only if present in the snapshot's type
    if (!baseUrl) continue;
    presets.push({ id, label: p.name ?? id, baseUrl, keyHint: keyHintFor(id, baseUrl) });
  }
  presets.sort((a, b) => a.label.localeCompare(b.label));
  return presets;
}
```

Keep today's hardcoded list as the offline fallback when the catalog fails (same contract as `models_search`): catalog → old PRESETS → []. `keyHintFor` keeps the nice hints for the known ten ("sk-…", "gsk_…" …) and "" for the rest.

**Steps:**
1. Failing root test: preset list from a fixture catalog contains an arbitrary provider with a baseUrl; provider without baseUrl is excluded; fallback returns the old list when catalog is unavailable.
2. Implement; `providers_list` answer gains `source: "models.dev" | "snapshot"` (like `models_search`).
3. `npm test` green (487 + new).

**Verify:** `npm run build && node -e` smoke: start daemon with empty ROAN_HOME, `providers_list` over the control socket returns >100 presets (server has internet).

**Commit:** `feat(daemon): every models.dev provider is a preset`

---

### Task 5: Provider flow rebuilt — tap, key, done

**Objective:** Adding opencode go is: tap it → key field appears → paste → Save. No global key box, no error-first flow.

**Files:**
- Modify: `web/src/panels/ProvidersPanel.tsx` (rewrite body, keep `client.request` calls)
- Modify: `web/src/styles.css` (`.prov` styles: sheet-like card, key input with show/hide, Save disabled until non-empty)

**New flow:**
1. Top: "Models & keys" title, current line `provider · model` (or "Select a model").
2. "Your providers" — saved accounts: row = label + model chip + "•••" (key set) — tap → expands: key field (type password + eye toggle), Save key, Make active, Remove.
3. "Add a provider" — search field + full preset list (Task 4). Tap preset → inline key card (label, keyHint, input, "Add"). Save → `provider_save` → auto `provider_pick` → auto-open ModelSheet (Task 6).
4. Custom provider: collapsed "Add custom provider (URL + key)" — same card shape.
5. `status` messages become inline one-liners under the card they belong to, auto-clear after 6s.

**Steps:** rewrite panel; `client.request` kinds unchanged (`providers_list`, `provider_save`, `provider_pick`, `models_list`). `npm --prefix web run build` green.

**Commit:** `fix(web): provider setup is tap → key → save`

---

### Task 6: ModelSheet — pick a model without leaving the chat

**Objective:** The model pill above the composer opens a bottom sheet with the active provider's live models, searchable; tapping picks it and closes. Also opens automatically after adding a provider.

**Files:**
- Create: `web/src/components/ModelSheet.tsx`
- Modify: `web/src/App.tsx` (pill `onClick` → `setSheetOpen(true)` instead of `setView("settings")`), state `const [sheetOpen, setSheetOpen] = useState(false)`
- Modify: `web/src/styles.css` (`.sheet`: fixed bottom, border-radius top 22px, max-height 70dvh, drag handle, search input sticky, list rows 48px)

**Component shape:**

```tsx
export function ModelSheet({ client, provider, model, onClose }: {
  client: ChainClient; provider: string | null; model: string | null; onClose: () => void;
}): ReactElement {
  // loads models_list for the active provider on open; search filters id+name;
  // row tap -> provider_pick { id, model } -> onClose()
  // provider null -> "Add a provider first" + button to Settings
}
```

Data: `models_list` already exists in the daemon and hits the provider's live `/models` (`fetchModels`). Scrim behind the sheet closes it. Escape/back gesture closes (Android back: `popstate` listener or accept scrim-tap; keep scrim-tap + X).

**Verify:** emulator: with mock provider, pill → sheet lists models → tap → pill shows it.

**Commit:** `feat(web): model sheet from the chat`

---

### Task 7: Slim drawer + Settings as the home for everything else

**Objective:** Drawer = New chat / search / chats / Settings (ChatGPT structure, see the APK analysis). Workspace, Schedules, Checkpoints, Agent, invite and node status move into Settings.

**Files:**
- Modify: `web/src/App.tsx` (drawer block `:300-397`; `view` type gains `"settings"` as a *menu*, subviews via `const [settingsPage, setSettingsPage] = useState<"menu"|"providers"|"agent"|"workspace"|"schedules"|"checkpoints"|"devices"|"about">("menu")`)
- Modify: `web/src/styles.css` (`.settings` menu rows like ChatGPT's: 52px rows, chevron, section labels)

**Settings menu (in order):**

| Row | Opens |
|---|---|
| Models & keys | ProvidersPanel (Task 5) |
| Agent (tools, skills, MCP) | CapabilitiesPanel |
| Workspace | WorkspacePanel |
| Schedules | SchedulesPanel |
| Checkpoints | CheckpointsPanel |
| Devices | invite block + node list/sync status (`snapshot.node`, peer, invite code) |
| About | chain id, node id, version, daemon log link |

Each row: back arrow in the titlebar when inside a page. The drawer's `rail__more`, `rail__sync`, InviteBlock-in-drawer code moves out of the drawer.

**Verify:** emulator screenshots: drawer shows exactly 4 things; Settings menu shows 7 rows; each opens.

**Commit:** `feat(web): chatgpt-style drawer, settings holds the rest`

---

### Task 8: Composer — attach and dictate

**Objective:** ＋ opens a small menu: "Add file" and "Dictate"; attach inserts a workspace file reference, dictate fills the input by voice.

**Files:**
- Modify: `web/src/components/Composer.tsx`
- Modify: `web/src/styles.css` (`.composer__plus` ghost circle, `.menu` popover above the button)

**Attach:** "Add file" opens a workspace file picker: reuse the file list logic from `web/src/panels/WorkspacePanel.tsx` (read it first; reuse the same `client.request` kind it uses to list files). Tapping a file inserts `@path` at the cursor of the composer input. No upload in this round — the workspace is synced anyway; upload stays in the Workspace panel. (If WorkspacePanel has no list request, add `workspace_list` to the daemon mirroring its existing read path.)

**Dictate:** feature-detect `(window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition`. If present: mic button, `continuous=false, interimResults=true`, interim text appended to the input value, final via `onresult`. If absent (likely in the Android WebView): **do not render the button** — feature detection decides, no dead UI. Verify on the emulator which case we're in and report it honestly.

**Verify:** emulator: ＋ menu opens, file reference inserts; mic button presence matches feature detection result.

**Commit:** `feat(web): composer attach + dictate`

---

### Task 9: Honest status line while a turn runs

**Objective:** Replace "Roan is working" with the actual phase: "Thinking" → "Running {tool}" → streaming.

**Files:**
- Modify: `web/src/App.tsx` (dock state line; derive phase from `snapshot.events` tail: last event `tool_call` → `Running ${name}`; `assistant` streaming → "Writing"; turn open with nothing else → "Thinking")

**Steps:** small helper next to `openTurn` in `web/src/chain.ts` if it fits better there (`turnPhase(events)`), unit-testable.

**Commit:** `feat(web): status line shows the turn's real phase`

---

### Task 10: Small bug fixes from the audit

**Objective:** Close every remaining visual defect found on the phone/emulator.

**Files:**
- `web/src/styles.css`: `.conversation--panel` padding-bottom → `calc(56px + env(safe-area-inset-bottom, 0px))` (LM Studio row under gesture bar)
- `web/src/App.tsx`: model pill when `snapshot.model == null` → "Select a model" (never "local-model"); when set → provider · model
- Sweep `web/src/panels/*.tsx` for Dutch remnants and title-casing inconsistencies ("ADD A PROVIDER" label → "Add a provider" sentence case)

**Verify:** grep + emulator screenshot of Settings scrolled to the bottom.

**Commit:** `fix(ui): panel padding, model pill, label casing`

---

### Task 11: Build 0.0.12 and prove it on the emulator

**Objective:** One apk, verified end-to-end with screenshots before the user sees it.

**Steps:**
1. Version bump: `package.json`, `web/package.json`, `src-tauri/tauri.conf.json` → `0.0.12`; `APP_VERSION` in `.github/workflows/release.yml`. (`scripts/android-daemon.sh` derives versionName/Code automatically.)
2. `npm test && npm run typecheck && npm --prefix web run test && npm --prefix web run build && npm run build` — all green.
3. x86_64 build: `./scripts/android-daemon.sh x86_64 && npx tauri android build --apk --debug --ci --split-per-abi`.
4. Emulator round (announce it first — fans; see skill `roan-harness` reference `android-emulator-verification.md` for the CSS-vs-physical pixel scale ≈ 2.75):
   - `pm clear dev.roan` → onboarding → create chain
   - mock provider: start `mock-llm.mjs` on 9999 (make it answer **with markdown**: heading, fenced code, list, bold) → Settings → Add custom provider `http://10.0.2.2:9999/v1` → save → **ModelSheet opens automatically** → pick model
   - send a message → screenshots: chat (markdown rendered, code chip), drawer (4 items), Settings menu (7 rows), ModelSheet open, status line mid-turn
   - `vision_analyze` each screenshot against the expected content; anything wrong → fix → rebuild → re-verify (no new task, just iterate)
5. Kill emulator. arm64 build → `local/builds/Roan-0.0.12-arm64.apk` + md5.
6. Clean build outputs (`arm`, `x86`, `x86_64` apks) — disk hovers at 98%.

**Deliverable:** Filebrowser link + what was verified vs. what wasn't (dictate on-device, real provider keys, second-device sync remain user-side).

**Commit:** `chore(release): 0.0.12`

---

### Task 12: Record the rules

**Objective:** Never make these mistakes again.

- Update skill `roan-harness`: "Roan app UI copy is **English**. The user said so twice (2026-11-16, 2026-11-18). Never translate UI strings."
- Note in `docs/research/reference-apps-apk-analysis.md` if any new insight appeared during implementation.

**Commit:** `docs: ui language rule`

---

## Tests / validation summary

- Root: `npm test` (487 + presets-catalog tests + turnPhase tests)
- Web: `npm --prefix web run test` (new vitest: markdown parser) + `npm --prefix web run build`
- Emulator: full flow with markdown-bearing mock provider, screenshots vision-checked
- Deliverable: `local/builds/Roan-0.0.12-arm64.apk` + Filebrowser link

## Risks / open questions

- **Dictate on Android**: WebView may not ship SpeechRecognition. Feature-detect and hide; report honestly. Do not fake it.
- **models.dev baseUrl coverage**: not every provider in api.json exposes an OpenAI-compatible `baseUrl`; the preset list = providers that do. That is the honest set — a provider without an OpenAI endpoint can't be used by our adapter anyway.
- **Table markdown** is rare in chat answers; if the parser's table branch gets fiddly mid-round, ship headings/code/lists/inline first and note tables as open.
- **Join-with-existing-chain bug** (replication stays on the old chain) is sync, not UI — deliberately out of scope here; next round, before two real devices pair.
- **No push**: all commits stay local until the user approves.

## Out of scope (explicitly)

Foreground service, MCP server startup, push notifications, real file upload, Claude APK analysis (Cloudflare-blocked), sync/join fixes.
