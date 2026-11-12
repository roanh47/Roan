# Running the web UI on one machine

This is the shortest path to a Roan you can actually open: one machine, one
daemon, one page. No desktop build, no Android, no peer.

```
browser ──http──► scripts/webui.mjs ──static──► web/dist
                        │
                        └──ws /ws──► daemon (127.0.0.1:7411)
                                          │
                                          └── chain.db + provider calls
```

## What runs

| Piece | Where | Why |
|---|---|---|
| daemon | `127.0.0.1:7411` (local socket), `0.0.0.0:7412` (peers) | owns the chain, runs turns, talks to the provider |
| web UI | `0.0.0.0:8440` | serves `web/dist`, proxies `/ws` to the daemon |
| config | `~/.roan/config.json` (0600) | provider base URL, model, key |
| chain | `~/.roan/workspace/chain.db` | the events; this is the conversation |

The page never talks to the daemon directly. It opens `ws://<page host>/ws`,
which lands on the proxy, which forwards to loopback. That is what makes the
same page work on the machine itself and from a phone on the same network: the
address in the browser bar is the only thing that changes.

## Install as a service

```bash
mkdir -p ~/.config/systemd/user
# roan-daemon.service: node dist/daemon/main.js, ROAN_CONTROL_PORT=7411
# roan-webui.service:  node scripts/webui.mjs,     ROAN_WEB_PORT=8440
systemctl --user daemon-reload
systemctl --user enable --now roan-daemon.service roan-webui.service
loginctl enable-linger "$USER"     # so they start without you logging in
```

Then open `http://<machine>:8440`.

## First run

The daemon starts without a chain and says so. The page shows one screen:

- **Create a new chain** — this device becomes the first node. The invite code
  that appears is what another device pastes in.
- **Join an existing chain** — the chain's events become this device's history.
  Nothing local is pushed into it.

The invite code is rebuilt from the daemon's identity, so it stays visible after
a reload and after a restart.

## Configuration

`~/.roan/config.json`, owner-only:

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
curl -s localhost:8440/healthz          # {"ok":true,"daemon":"ws://127.0.0.1:7411"}
ss -ltn | grep -E ':7411|:7412|:8440'   # all three listening
sqlite3 ~/.roan/workspace/chain.db 'select seq, type from events order by seq'
```

A message typed in the page must end as `message → turn_start → assistant →
turn_end` in that table. If `assistant` is missing and an `error` event names a
`fetch failed`, the provider is unreachable — check `baseUrl`, the key, and that
the model name exists at that endpoint.
