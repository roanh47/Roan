---
type: Reference
title: Environment variables
description: Every environment variable Roan reads, and which one wins.
tags: [roan, reference, env]
status: stable
generated: { by: hermes-agent/deepseek-v4.1-flash, at: 2026-09-30T08:12:52Z }
verified: { by: process:pytest, at: 2026-09-30T08:12:52Z }
sources:
  - id: config
    resource: config.py
    title: roan/config.py
  - id: telegram
    resource: channels/telegram.py
    title: roan/channels/telegram.py
---

# Config overrides

`load_config()` applies these **after** reading the file, so an env var always
wins. Useful on a server where the config file is not yours to edit.

| Variable | Overrides |
|---|---|
| `ROAN_PROVIDER` | `provider` |
| `ROAN_BASE_URL` | `base_url` |
| `ROAN_API_KEY` | `api_key` |
| `ROAN_MODEL` | `model` |
| `ROAN_LANGUAGE` | `language` |
| `ROAN_TUI` | `tui` |
| `ROAN_TELEGRAM_TOKEN` | `telegram_token` |

`ROAN_API_KEY` also counts for `has_config()`, and for `is_configured()` when the
base URL is not a localhost one.

# Behaviour flags

| Variable | Effect |
|---|---|
| `ROAN_DISABLE_ALTERNATE_SCREEN` | force the classic inline renderer |
| `ROAN_NO_FLICKER=1` | force the fullscreen renderer |

Any non-empty value counts for `ROAN_DISABLE_ALTERNATE_SCREEN`; `ROAN_NO_FLICKER`
requires exactly `1`.

# Order of precedence

    env var  >  config.json  >  provider preset  >  built-in default

The preset step runs last on purpose: it fills in a `base_url` and `api_key` for a
known provider when they are missing, but it never overrides something you set
through the environment.
