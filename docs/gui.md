# The app window

Roan has one window. `web/src/main.tsx` mounts a single React tree at `#root`;
there are no routes and no browser chrome. The same bundle is loaded by the
Tauri desktop shell and by the Android WebView, and both talk only to the daemon
on the same machine over `ws://127.0.0.1:7411/ws`.

The desktop window is 1180 × 780, minimum 760 × 520, dark, with normal
decorations (`src-tauri/tauri.conf.json`). The title bar carries
`data-tauri-drag-region`, so the top strip drags the window.

Two things are true at once. All the panes below exist as components, and only
four of them are on screen today: the title bar, the transcript, the turn-status
rail and the composer. `App.tsx` imports nothing else. Onboarding, the session
sidebar, the one-line status bar, settings and the invite card are props-only
components waiting for a shell to mount them. Each section says what the pane
contains and whether the window currently shows it.

## The frame

```
desktop, 900 px and wider                     phone, under 900 px
┌──────────────────────────────────────┐      ┌──────────────────┐
│ ▮ Roan                    chain-id   │      │ ▮ Roan   chain   │
├──────────┬───────────────┬───────────┤      ├──────────────────┤
│ Sessions │ transcript    │ Ready     │      │ transcript       │
│ search   │               │ facts     │      │                  │
│ rows     │               │           │      │                  │
│          ├───────────────┤           │      ├──────────────────┤
│          │ composer      │           │      │ status line      │
└──────────┴───────────────┴───────────┘      ├──────────────────┤
                                              │ composer         │
                                              └──────────────────┘
```

The three-pane arrangement is defined in `web/src/layout.css`: a session
sidebar on the left, the conversation in the middle, the status rail on the
right. That file is not imported by `main.tsx` today, and `App.tsx` has no
sidebar element, so the running window is the two-column version in
`styles.css`: transcript plus a 300 px rail on the right, composer under the
transcript. Under 900 px everything is one column.

The palette is fixed and dark (`web/src/theme.ts`, projected into `:root` by
`styles.css`): background `#0b0c0f`, surface `#13161b`, line `#262b33`, text
`#e9edf1`, muted `#9aa4af`, accent `#8fd6b4`, warning `#f0c674`, danger
`#ff8f8f`.

## Title bar

A 44 px strip across the top. On the left: an 11 px rounded square with a mint
gradient and the word **Roan** at 14 px, weight 600. On the right: the chain id
in a pill, set in the mono font at 10.5 px. Ids longer than 16 characters are
cut to 16 plus `…`, and the full id is in the `title` attribute. With no chain
the pill reads `no chain`.

The chain pill is the only piece of identity the window currently shows.

## Onboarding

`web/src/components/Onboarding.tsx`. The first-run screen when this device has
no chain. It is one centered card on an otherwise empty page.

- Heading: **Start a chain**.
- A short paragraph explaining that a chain is the shared conversation between
  devices, that starting one seeds it on this device, and that joining adopts
  the other chain's history.
- Two buttons: **Start a new chain** (primary) and **Join an existing chain**.
  Each has a hint underneath — "Begins empty on this device and invites the
  others in" and "Asks the other chain for its data and takes it over".
- While `busy`, both buttons are disabled, the section is `aria-busy`, and a
  live status line reads **Working…**.
- A failed attempt is shown verbatim in a red `role="alert"` paragraph.

The component takes callbacks, not a socket, and it has **no field for the
invite code**. `onJoin` receives no argument, so the shell would have to collect
the code elsewhere. The daemon side is ready: `state.onboarding` is true when no
identity is loaded, `create_chain` answers with `{ chain, node, invite }`, and
`join_chain { code }` decodes the code and writes an identity. The app never
sends either frame, and `chain.ts` does not parse the `state` reply, so a fresh
install opens the conversation with `no chain` instead of this card.

Not mounted by `App.tsx`.

## Sidebar — sessions

`web/src/components/Sidebar.tsx`. A list of conversations, not a list of nodes.
(`PeerList.tsx` is the separate **Nodes** section, with tailnet name, live or
last-seen state and head sequence per device.)

- Header: **Sessions** with the total count, and a **New** button when the host
  supplies `onNewSession`.
- A search field filters on session title and preview, case-insensitive.
- Rows are newest first by `updatedAt`, ties broken by title. Each row shows the
  title, an optional preview line, and a compact relative time: `now`, `5m`,
  `3h`, `2d`, then a short date such as `Nov 3` after a week.
- An unread session gets a 6 px accent dot and a screen-reader-only "Unread".
- The open session has a surface highlight, a 2 px accent left border, bolder
  title and `aria-current="page"`.
- Empty states: **No sessions yet.** and `No sessions match “…”`.

Width is `clamp(200px, 20vw, 264px)` in the three-pane layout. Below 900 px it
becomes a fixed drawer, `min(84vw, 300px)` wide, sliding in with a scrim when
the shell adds `.app--sidebar-open`; reduced-motion turns the slide off.

Sessions are supplied by the host. Nothing in the daemon's control protocol
lists sessions — it reports one chain id, one node and a head — so there is no
data source for this pane yet.

Not mounted by `App.tsx`.

## Transcript

`web/src/components/Transcript.tsx`. The scrolling conversation, capped at
680 px wide, 12 px between rows, with a sticky-to-bottom behaviour: it follows
new rows while you are within 56 px of the bottom and stops following once you
scroll up.

Empty state, centered and muted: **Nothing here yet. Say something — every
device on this chain sees it.**

Rows, by chain event type:

| Event | What is drawn |
|---|---|
| `message` | A bubble. Yours is right-aligned with a dark green tint and the meta `you` plus the clock; another node's is left-aligned with that node's name and the clock. |
| `assistant` | A full-width block with a left rule, labelled **Roan** and the node that produced it. Consecutive assistant events from the same node are merged into one block, so streamed deltas do not fragment the transcript. |
| `tool_call` | A collapsed `<details>`: eyebrow `tool call`, the tool name, and the arguments as pretty-printed JSON when opened. |
| `tool_result` | A collapsed `<details>`: `tool result`, the tool name, an `ok` or `failed` flag in accent or danger, and the output when opened. |
| `error` | A full-width red-ruled block with the eyebrow `error` and the message, in `role="alert"`. |
| `env` | A collapsed raw trace labelled `env`. |
| `turn_start` / `turn_end` | A horizontal divider: `turn started · <node>` and `turn ended · <N> steps`. |
| unknown type | A collapsed raw trace labelled with the type, so an older client survives a newer daemon. |

A message you just sent appears immediately at the end as a dashed, 62 %-opaque
bubble with `you` and `sending…`. It disappears when the daemon echoes the same
event id. The list is a `role="log"` with `aria-live="polite"`.

Mounted.

## Composer

`web/src/components/Composer.tsx`. One rounded bar docked at the bottom: a
borderless textarea, then a circular accent send button with an up arrow. The
textarea starts at one line, grows with its content up to 140 px, uses 16 px
text so mobile WebViews do not zoom on focus, and is a real `<form>`.

- **Enter** sends; **Shift+Enter** inserts a newline; Enter during IME
  composition is ignored.
- The send button is disabled while the text is empty or the composer is
  locked; on a coarse pointer it grows from 38 px to 42 px.
- Locked when the socket is not open or when a turn is open. The placeholder
  says why: `Message Roan` when ready, `<owner> is working…` during a turn,
  `Waiting for the daemon…` while disconnected.
- The input's `aria-describedby` points at the status headline that explains
  the lock.
- A send that throws (socket closed between click and write) is caught by
  `App.tsx` and shown in the status rail as a red notice for six seconds.

Mounted.

## Status: the rail and the one-line bar

There are two different status components.

**The rail** is `web/src/components/TurnStatus.tsx`, mounted in the right
column. It is a card on desktop and a compact block under the transcript on
phones, where the facts list is hidden and only the headline and detail remain.

- Headline, with a coloured dot: **Ready** (accent), **`<owner>` is working**
  (warning, pulsing), **Reconnecting** (waiting), **Daemon unreachable**
  (danger), **Connecting** (waiting).
- A sentence underneath. Ready: `Messages you send run on <node>.` Working
  locally: `This turn runs on this device. The composer unlocks when it ends.`
  Working remotely: `The turn runs on <owner>. One turn at a time across the
  chain.` Reconnecting: `Waiting for the local daemon to come back.`
  Unreachable: `Nothing can be sent until the connection is back.` Connecting:
  `Looking for the daemon on this device.`
- Facts, desktop only: **Chain** (shortened to 14 characters), **Device**,
  **Daemon** (the node that answered), **Owner** with elapsed time when a turn
  is open, **Events** (last sequence number), and **Sending** when messages are
  still pending. On phones this list is hidden by CSS.
- A red notice for a local send failure, and a muted monospace note for the
  last daemon error.

**The one-line bar** is `web/src/components/StatusBar.tsx`, a separate
props-only strip in the mono font at 12 px:

```
● Live · roan-mainnet · head #412 · 2 peers · deepseek-v4.1-flash
```

The state word and dot are **Live** (accent), **Syncing** (warning) or
**Offline** (danger). Chain and model fall back to `unknown` and `no model`;
negative or non-finite counts read as zero; the chain and model are ellipsized
at 160 px with the full value in `title`. Its `aria-label` reads the whole
sentence, including singular/plural peers.

The rail is mounted. The one-line bar is not, and has no fixed position in the
window.

## Settings

Two components exist; neither is mounted and there is no navigation to either.

**`web/src/screens/SettingsScreen.tsx`** is the full pane. A heading, then two
cards side by side on a wide window and stacked when narrow:

- **Provider** — a searchable combobox of providers, each labelled with its
  model count. Typing filters by id or label, arrow keys move, Enter selects.
- **Model** — the models for the chosen provider. Each row shows the model
  name, a `tools` badge if it supports tool calls, a `deprecated` marker, the
  context window as `128k` or `1.2M`, and the price as
  `$0.27 / $1.10 per 1M`. The line above the list shows the current model or
  asks you to pick one.
- **Workspace** — a text input for the absolute directory the daemon works in.
  Accepted shapes are `~`, `/…`, `C:\…` and `\\host\share`; anything relative
  is refused with `Enter an absolute path, e.g. /home/roan/Roan.` and marked
  `aria-invalid`.
- **Save** is disabled until something changed, the path is valid, and both
  provider and model are non-empty. While saving it reads **Saving…**. Errors
  appear above it. There is no Reset button here.
- Copy comes from `web/src/i18n.ts`, defaulting to Dutch: **Instellingen**,
  **Aanbieder**, **Model**, **Werkmap**, **Opslaan**. English is available but
  the rest of the window hardcodes English.

**`web/src/components/SettingsPanel.tsx`** is the older, smaller variant: three
plain text inputs (Provider, Model, Workspace), **Save** and **Reset**, with
the same path validation and a dirty check. No catalogues, no pickers.

Neither pane edits the base URL or the API key, although the daemon's
`Settings` holds `baseUrl`, `model`, `apiKey` and `provider`. `saveSettings`
accepts only those four keys and rejects anything else, so `workspace` has no
persistence path through it today.

## Invite

`web/src/components/InviteCard.tsx`. A card that hands the chain to another
device:

- Heading **Invite another device**, then the code in a `<code>` block.
- **Copy code** writes it to the clipboard and changes to **Copied** for two
  seconds, with a live "Copied to the clipboard." message.
- If the clipboard API is missing or refuses, a red fallback tells you to
  select the code and copy it by hand.
- Hint: "Open Roan on the other device, choose Join, and type this code."
- Optional expiry line: "This code stops working <medium date and time>."

The code itself is produced by `create_chain` and is a base64url JSON object
`{ v, chain, token, host, port }`; it has no expiry field, so the expiry line
only ever appears if a host supplies `expiresAt` itself. The card is props-only
and no screen shows the invite returned by `create_chain`.

Not mounted by `App.tsx`.

## Keyboard and accessibility

| Where | Key | Effect |
|---|---|---|
| Composer | Enter | send |
| Composer | Shift+Enter | newline |
| Command palette | Ctrl/Cmd+K | open or close the overlay |
| Command palette | ↑ / ↓, Enter, Esc | move, run, close |

`CommandPalette.tsx` is built (fuzzy filter, backdrop click, focus returned to
the previous element, footer hints) but not mounted. Focus rings are a 2 px
accent outline. The transcript is a live log, status headlines are live
regions, tool traces are native `<details>` elements, and every icon button has
an `aria-label`. Motion is reduced to near-zero under
`prefers-reduced-motion`. Controls are not selectable; transcript and tool text
are. The layout uses `100dvh` and safe-area insets at the top and bottom.

## What the window actually mounts

| Area | Component | In `App.tsx` |
|---|---|---|
| Title bar | inline | yes |
| Transcript | `Transcript` | yes |
| Turn-status rail | `TurnStatus` | yes |
| Composer | `Composer` | yes |
| Onboarding | `Onboarding` | no |
| Session sidebar | `Sidebar` | no |
| One-line status bar | `StatusBar` | no |
| Settings | `SettingsScreen`, `SettingsPanel` | no |
| Invite | `InviteCard` | no |
| Command palette | `CommandPalette` | no |
| Tool timeline | `ToolTimeline` | no |

`App.tsx` also has no branch for "no chain", so the onboarding card has no
trigger in the running app. The window renders the transcript and composer as
soon as the WebSocket opens, whether or not the daemon has a chain.

## Where this comes from

`web/src/App.tsx`, `web/src/main.tsx`, `web/src/styles.css`,
`web/src/layout.css`, `web/src/theme.ts`, `web/src/i18n.ts`,
`web/src/chain.ts`, `web/src/components/Onboarding.tsx`,
`web/src/components/Sidebar.tsx`, `web/src/components/Transcript.tsx`,
`web/src/components/Composer.tsx`, `web/src/components/TurnStatus.tsx`,
`web/src/components/StatusBar.tsx`, `web/src/components/SettingsPanel.tsx`,
`web/src/screens/SettingsScreen.tsx`, `web/src/components/InviteCard.tsx`,
`web/src/components/PeerList.tsx`, `web/src/components/CommandPalette.tsx`,
`web/src/components/ToolTimeline.tsx`, `src-tauri/tauri.conf.json`,
`src/daemon/main.ts`, `src/daemon/control.ts`,
`src/daemon/control-protocol.ts`, `src/daemon/settings.ts`,
`src/daemon/settings-write.ts`.
