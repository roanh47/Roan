# Reference app analysis — ChatGPT Android (from the APK)

Source: ChatGPT 1.2026.314 (versionCode 2631421), arm64-v8a, pulled from APKMirror
(`base.apk` sha256 `76ea3059e403370f405b5225f89e150f0784f5f0bc5f040a5a0d881242730fa4`,
decoded with `apktool d --no-src` via REA + locally, 8,985 string resources, 5,039 files).
Method: static analysis of the decoded resources. No runtime inspection (login wall),
so this is what the app ships, not a pixel audit.

What follows is the UI structure their strings reveal, and what Roan does with it.

## Sidebar (the drawer)

ChatGPT's drawer, in order, is small and flat:

| Their item | Their string (verbatim) | Roan |
|---|---|---|
| New chat | `New chat` / `Start new chat` | already there |
| Search | `Search chats` (one field, top) | already there |
| Chats list | `Chats`, `Recent chats`, `No matching recent chats` | already there |
| Everything else | — | **gone from our drawer** |

Their drawer also lists Library / GPTs / Projects / Tasks / Codex / Explore, but those are
*products*, not settings — the lesson is not the list, it is that the drawer is a launcher
for conversations plus a search box, nothing else. `Archived chats` lives in Settings, and
account/profile lives at the bottom. Roan's drawer becomes: **New chat → search → chats →
Settings** (Settings holds workspace, schedules, checkpoints, agent, invite, node status).
That is exactly the complaint: "nodig een toestel uit enzo moet gewoon in settings".

## Composer

Their composer affordances, verbatim:

- Placeholder: `Ask ChatGPT`
- Plus-menu: `Add files`, `Add photos`, `Take photo`, `Upload files`, `Attachment` (limit copy:
  "Each file must be 20 MB or smaller, and attachments must total 50 MB or less.")
- Voice: `Tap the microphone and say it instead.` / `Tap the microphone to turn what you say
  into text.` — dictate puts words in the box; `Start a voice conversation` is the separate
  voice mode.
- While generating: `Stop generating` (and `Cancel reply` / `Stop response` in some contexts)

Roan: composer gets **＋ attach** (files/photos via the workspace) and **mic (dictate)** next
to send, and Stop while a turn runs. Attachments land in the synced workspace — that is what
a chain is for.

## Model picker

Verbatim: `Model`, `Select model`, `Other models`, `Select reasoning level`, `Fast`,
`Remote reasoning effort`, `Temporary chat`.

It sits on the *composer* (model name as a pill you tap), not in a settings page — you change
models mid-conversation. Roan already has the pill above the composer; make it open a model
sheet straight from the chat (no Settings round-trip), with the provider's live models and a
search field. `Other models` = the fallback list.

## Message actions

Verbatim: `Copy`, `Copy code`, `Edit message`, `Regenerate`, `Read aloud`, `Good response`,
`Bad response`, `Share`.

Roan: long-press (or ⋯) on a message → Copy / Edit / Regenerate; code blocks get a
`Copy code` chip. Read-aloud needs TTS — later. Good/bad and Share are account-product
features, skip.

## Streaming status

Verbatim: `ChatGPT is working…`, `Thinking`, `Searching the web`, `Creating images`,
`Stopped: %1$s`.

One quiet status line that says what is happening *right now*, above the composer. Roan's
`Roan is bezig` → `Roan is working…` + the actual phase (thinking / running tool X).

## Empty state

Verbatim: `What should we dive into?` — plus suggested prompts underneath.

Roan: "Where should we start?" + 3–4 tappable suggestions that fill the composer.

## Settings structure

Their sections: `Account`, `Personalization`, `Data controls`, `Archived chats`,
`Notifications`, `Security`, `Language`, `Privacy`, `About`.

For Roan, Settings holds: **Providers (models & keys)**, **Agent (tools/skills/MCP)**,
**Workspace**, **Schedules**, **Checkpoints**, **Devices (invite/join, node list)**,
**About (chain id, node, version)**. Every debug-ish fact (chain id, seq, hex) lives in
About, not in the chat UI.

## Login/onboarding

Verbatim: `Get started`, `Continue without account`, `Log in or sign up`, `Welcome to ChatGPT`.

The app works logged-out; onboarding is one screen. Roan's equivalent is the chain screen:
create or join, nothing else — already the case, keep it.

## Markdown

`Markdown` and `Share code block` strings confirm the transcript is rendered markdown.
Roan does **not** render markdown yet — plain text with newlines only. To implement:
a small renderer in the transcript for headings, bold/italic, lists, fenced code blocks
(with a copy chip), inline code, links, tables; streaming-safe (re-render per delta is fine
at our message sizes).

## Not analyzed

- Claude Android: APKMirror serves it behind Cloudflare on this host; no result yet.
- Runtime behavior (gesture details, animations, exact spacing) — static strings only.
