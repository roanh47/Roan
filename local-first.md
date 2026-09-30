---
type: Decision
title: Local first, no servers of our own
description: No backend, no account, no listening port; the only network traffic is to the provider you chose.
tags: [roan, decision, privacy, scope]
status: stable
generated: { by: hermes-agent/deepseek-v4.1-flash, at: 2026-09-30T08:12:52Z }
sources:
  - id: readme
    resource: README.md
    title: README.md
---

# Decision

Roan runs entirely on the user's machine. It listens on no port, needs no
account, and talks only to the model provider configured for it.

# Why

The requirement was literal: no dependency on servers, and none of the compliance
and policy overhead that comes with running a service. A harness is a client. The
local path has to work end to end, which is why LM Studio, Ollama and seven other
localhost servers are first-class in the provider picker and why a localhost base
URL counts as configured without an API key.

# What it costs

* No sync, no shared history, no web UI. Everything is in `~/.Roan` on one
  machine.
* The Telegram channel is the one place data leaves the machine by design - it is
  opt-in, started explicitly, and only after a token is configured.
* Features that would need a backend (accounts, sharing, a hosted gallery) are out
  of scope. Anything that needs "just a small server" is not a small server.

# The rule

If a change introduces a listening socket, a hosted component, or a required
account, it needs an explicit decision record saying why this one is different.
