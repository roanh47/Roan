# Running the web UI on one machine

This is the shortest path to a Roan you can actually open: one machine, one
daemon, one port. No desktop build, no Android, no proxy, no peer.

```
browser ──http/ws──► daemon (127.0.0.1:6769)
                      ├── /            → web/dist (index.html, assets)
                      ├── /ws          → the control socket
                      ├── /peer        → peer sync (chain token)
                      ├── /log         → the daemon's own output
                      └── /healthz     → {"ok":true,"ui":true,"dist":"…"}
```

## What runs

| Piece | Where | Why |
|---|---|---|
| daemon | `127.0.0.1:6769` — UI, `/ws`, `/peer` | owns the chain, runs turns, talks to the provider |
| web UI | the same daemon, `/` | `web/dist`, served with content types and an index.html fallback |
| config | `~/.Roan/config.json` (0600) | provider base URL, model, key |
| chain | `~/.Roan/state/chain.db` | the events; this is the conversation |

The page never talks to another process: it opens `ws://<page host>/ws`, which
is the same server that served it. That is what makes the same page work on the
machine itself and from a phone on the same network: the address in the browser
bar is the only thing that changes.

`scripts/webui.mjs` is no longer part of the picture. It stays as a shim that
prints the URL and waits, for anyone whose old unit file still starts it.

## Build the page once

```bash
cd web && npm install && npm run build     # writes web/dist
```

Without `web/dist` the daemon still starts and still answers `/ws`; `/` returns
a plain-text page saying the UI was not built, so the desktop and Android shells
keep working while the page does not.

## Install as a service

```bash
mkdir -p ~/.config/systemd/user
# roan.service: node dist/daemon/main.js   (ROAN_PORT=6769, loopback default)
systemctl --user daemon-reload
systemctl --user enable --now roan.service
loginctl enable-linger "$USER"     # so it starts without you logging in
```

Then open `http://127.0.0.1:6769`.

To reach it from another machine, bind wider and mean it:

```ini
Environment=ROAN_HOST=tailscale
# Environment=ROAN_HOST=lan
```

That opens the page and `/peer` to the network. `/ws` stays loopback-only until
`ROAN_ALLOW_REMOTE_CONTROL=1` — and the control socket has no token, so that
flag is the whole security decision.

## First run

The daemon starts without a chain and says so. The page shows one screen:

- **Create a new chain** — this device becomes the first node. The invite code
  that appears is what another device pastes in.
- **Join an existing chain** — the chain's events become this device's history.
  Nothing local is pushed into it.

The invite is built from the daemon's identity, so it stays visible after a
reload and a restart. It carries this machine's host and the one port; with a
loopback bind it is `null`, because there is nothing another machine can dial.

## Configuration

`~/.Roan/config.json`, owner-only:

```json
{
  "baseUrl": "https://api.example.com/v1",
  "model": "some-model",
  "apiKey": "…",
  "provider": "example"
}
```

Anything OpenAI-compatible works: the daemon streams `POST {baseUrl}/chat/completions`.
Missing fields fall back to `http://127.0.0.1:1234/v1` and `local-model` (LM Studio).

## Checks that mean something

```bash
curl -s localhost:6769/healthz          # {"ok":true,"ui":true,"dist":"…"}
curl -s localhost:6769/log | tail -20   # what the daemon said, over the same port
ss -ltn | grep ':6769'                  # one listener, not three
sqlite3 ~/.Roan/state/chain.db 'select seq, type from events order by seq'
```

A message typed in the page must end as `message → turn_start → assistant →
turn_end` in that table. If `assistant` is missing and an `error` event names a
`fetch failed`, the provider is unreachable — check `baseUrl`, the key, and that
the model name exists at that endpoint.
