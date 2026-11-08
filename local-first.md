---
type: Decision
title: Local first, no servers of our own
description: No backend, no account, no listening port; traffic goes to the provider you chose and, read-only, to the public pages you ask Roan to fetch — never with a key.
tags: [roan, decision, privacy, scope]
status: stable
generated: { by: hermes-agent/deepseek-v4.1-flash, at: 2026-09-30T08:12:52Z }
sources:
  - id: readme
    resource: README.md
    title: README.md
---

# Decision

Roan runs entirely on the user's machine. It listens on no port and needs no
account. It talks to the model provider configured for it, and — since the
knowledge store — read-only to public web pages the user explicitly asks it to
fetch. That second kind of traffic is outbound without an account, without a
key, and without writing anything back.

# Why

The requirement was literal: no dependency on servers, and none of the compliance
and policy overhead that comes with running a service. A harness is a client. The
local path has to work end to end, which is why LM Studio, Ollama and seven other
localhost servers are first-class in the provider picker and why a localhost base
URL counts as configured without an API key.

Fetching changes nothing about that, as long as it stays anonymous. Public pages
need no key, so the "no account anywhere" rule survives: there is nothing to
store, nothing to leak from a config file, and nothing to revoke. A key would
have broken both halves of that at once.

# What the outbound traffic may do

* **Read only.** A `GET`, never a write. No posting, no OAuth, no session cookie
  kept between calls.
* **No credentials, ever.** No `Authorization` header, no token in a URL or a
  query string, nothing in `config.json`. A URL with a credential in it is
  refused rather than followed.
* **Identify itself.** Every request carries a `User-Agent` naming Roan.
* **Respect `robots.txt`**, and report a rate limit instead of hammering through
  it. GitHub's unauthenticated `api.github.com` allows 60 requests per hour per
  IP; the reset time comes back in the answer when you hit it.
* **Say when it failed.** DNS, refused connections, timeouts, 404, 403, a login
  wall, a body that is not HTML: each one has its own message. Nothing is guessed
  and no half-fetched page is written to disk as if it were the real thing.
* **Refuse by default.** `file://` and every non-http(s) scheme is refused. A
  stored page is capped in size, and overwriting one keeps the previous version,
  so a bad fetch is recoverable.

LinkedIn is the honest exception: it serves a login wall to any unauthenticated
client, and that cannot be worked around without an account. Roan does not
pretend otherwise. The alternative that always works is that the user pastes the
content in, which is why that path exists at all.

# What it costs

* No sync, no shared history, no web UI. Everything is in `~/.Roan` on one
  machine.
* The Telegram channel is the one place data leaves the machine by design - it is
  opt-in, started explicitly, and only after a token is configured.
* Fetching sends the URL to the site being fetched, as any client does. There is
  no proxy to hide behind, so a fetched URL is visible to that site's owner.
* Features that would need a backend (accounts, sharing, a hosted gallery) are out
  of scope. Anything that needs "just a small server" is not a small server.

# The rule

If a change introduces a listening socket, a hosted component, or a required
account, it needs an explicit decision record saying why this one is different.
The same goes for a change that adds an outbound call with a credential: that is
a different decision, and it is not this one's.

# Where this lives

The paths are in [`roan/config.py`](roan/config.py), the directories are made by
`ensure_home()` in [`roan/home.py`](roan/home.py), and the tools the model may
call are in [`roan/tools.py`](roan/tools.py) with their schemas in
[`roan/agent.py`](roan/agent.py). What a stored source looks like is described in
[`roan/configuration.md`](roan/configuration.md).
