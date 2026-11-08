# web/ — the Roan app screen

This is not a website. Nothing here is served to a browser, and there is no
`localhost` URL to remember, no router and no login page. It is the frontend
bundle that ships **inside** the two shells built from one codebase:

- desktop app (Tauri, Windows/macOS/Linux)
- Android app (WebView in the APK)

Both load the same `dist/` and talk to the **local daemon** on the same device.
The daemon owns the chain; this code renders events and sends intents.

## Files

| File | What it is |
| --- | --- |
| `index.html` | Single entry document for the webview. Title "Roan". No routes. |
| `src/main.tsx` | Mounts `<App />` at `#root`. The only place React touches the DOM. |
| `src/App.tsx` | Window frame: title bar, transcript, status rail, composer. |
| `src/chain.ts` | Chain client: WebSocket frames, event list, turn lock, reconnect. No React. |
| `src/components/Transcript.tsx` | Events → message blocks, tool traces, errors, dividers. |
| `src/components/Composer.tsx` | Text input and send button. Disabled when the chain is not writable. |
| `src/components/TurnStatus.tsx` | Ready / working (and who) / reconnecting / unreachable. |
| `src/styles.css` | Design tokens and the phone + desktop layouts. |

## Building

Dependencies are new to this directory (React, Vite, TypeScript types). Per
`AGENTS.md`, adding them is a decision for the owner; once agreed:

```bash
cd web
npm install
npm run typecheck   # tsc --noEmit
npm run build       # tsc --noEmit && vite build → web/dist/
```

`vite.config.ts` sets `base: "./"`, so `dist/index.html` references its assets
relatively. That matters because the document is loaded from disk (Tauri) or
from the APK's assets (Android), not from an HTTP origin.

`npm run dev` starts Vite on port 5173. That is a development convenience for
working on the UI inside a shell's dev window (`devUrl`), not a product
interface. Nothing in this directory is part of the root `tsconfig.json` or the
root build.

## How the shells embed it

### Desktop (Tauri)

```jsonc
// tauri.conf.json
{
  "build": {
    "frontendDist": "../web/dist",
    "devUrl": "http://localhost:5173"
  },
  "app": {
    "windows": [{ "title": "Roan", "width": 1100, "height": 760, "theme": "Dark" }]
  }
}
```

Inject the daemon endpoint with an `initialization_script` on the window, before
the bundle runs. The title bar in `App.tsx` carries `data-tauri-drag-region`, so
the window stays draggable; add `decorations: false` only if the shell draws its
own traffic lights.

### Android

Copy `web/dist/` into the app's assets and load it with `WebViewAssetLoader`
(an `https://appassets.androidplatform.net/` origin) rather than `file://` —
relative assets and `fetch` behave normally that way. Then:

```kotlin
webView.evaluateJavascript(
    """window.__ROAN__ = { socket: "ws://127.0.0.1:7411/ws", node: "pixel" };""",
    null
)
```

Allow cleartext to loopback only (network security config with
`127.0.0.1`/`localhost`), and keep the daemon on loopback.

## The daemon connection

The shell passes a bridge object; nothing else is assumed:

```ts
window.__ROAN__ = { socket: "ws://127.0.0.1:7411/ws", node: "roan-pc" };
```

- `socket` — the local daemon's WebSocket. Default if absent:
  `ws://127.0.0.1:7411/ws` (a placeholder port; change it here or in the shell's
  injection, and keep it in step with the daemon).
- `node` — this device's name, written into every event it appends. If absent,
  `device-xxxx` is generated once and kept in `localStorage` under `roan.node`.

No public address and no token is baked in — only the loopback fallback above.
A secret in a bundle is not a secret: when the
daemon grows device pairing, the shell reads the token from OS secure storage and
passes it in `__ROAN__` at runtime. If the daemon later speaks a unix socket, the
shell proxies it to loopback and only the injected `socket` value changes.

## Protocol, as this client speaks it

Frames are JSON, one per WebSocket message.

```
client → daemon   { t: "hello", v: 1, chain, node, haveSeq }
                  { t: "append", event }
daemon → client   { t: "hello", v: 1, chain, node, haveSeq }
                  { t: "events", events }
                  { t: "append", event }
```

- On every open (including reconnects) the client sends `hello` with the last
  `seq` it holds. The daemon answers with `hello`, then `events` for anything
  newer. `events` may be empty or absent when there is nothing to catch up.
- A sent message is appended as a complete event with `seq: 0`, a locally
  generated `id`, `type: "message"`, `data: { text }`. It is shown immediately as
  a pending bubble. The daemon assigns the real `seq` and echoes the event with
  the same `id`; that echo replaces the pending bubble. Pending items only clear
  on an echo — no optimistic sequence numbers are invented.
- Events are deduplicated by `id` and kept sorted by `seq` (ties by `id`).
  Unknown `type` values are kept and rendered as a collapsed trace, so an older
  app survives a newer daemon.
- A turn is open when a `turn_start` has no `turn_end` from the **same** node.
  The first `turn_start` wins; a `turn_end` from another node cannot close it.
  While open, the composer is disabled and the status names the owner. A crashed
  owner therefore leaves the turn open until the daemon writes `turn_end` —
  that recovery belongs in the daemon, not in the view.
- Reconnect uses exponential backoff from 400 ms to 8 s with jitter, reset after
  a successful open. The transcript is not cleared; `seq` catches it up.

## Shapes

`ChainClient` (`src/chain.ts`) is the only state holder. React subscribes with
`useSyncExternalStore`; the snapshot object changes identity only when state
changes.

```ts
interface ChainSnapshot {
  status: "idle" | "connecting" | "open" | "reconnecting" | "closed";
  chain: string | null;      // from daemon hello
  node: string;              // this device
  peer: string | null;       // daemon that answered
  events: readonly ChainEvent[];
  pending: readonly PendingMessage[];  // sent, not yet echoed
  lastSeq: number;
  error: string | null;
}
```

Props:

| Component | Props |
| --- | --- |
| `Transcript` | `{ events, pending, node }` |
| `Composer` | `{ disabled, placeholder, onSend(text) }` |
| `TurnStatus` | `{ turn, status, chain, node, peer, pending, lastSeq, error, notice }` |

`turn` is `{ owner, startId, since } | null`, derived with `openTurn(events)`.

## Layout

One component tree, two arrangements:

- **Phone (390 px and up to 899 px)** — one column: title bar, scrolling
  transcript, one-line turn status, composer docked above the keyboard with
  `env(safe-area-inset-bottom)`.
- **Desktop (≥ 900 px)** — transcript in the main pane, a 300 px status rail on
  the right holding the full turn/chain/daemon facts, composer under the
  transcript.

No browser chrome assumptions: `100dvh`, no hover-only affordances, no text
selection on controls, overscroll contained, and every control reachable by
keyboard. The composer is a real `<form>`; Enter sends, Shift+Enter breaks the
line, and `aria-describedby` points at the status line that explains why it is
locked.
