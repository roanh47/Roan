---
type: Reference
title: Config keys
description: Every key in ~/.Roan/config.json, with its default and meaning.
tags: [roan, reference, config]
status: stable
generated: { by: hermes-agent/deepseek-v4.1-flash, at: 2026-09-30T08:12:52Z }
verified: { by: process:pytest, at: 2026-09-30T08:12:52Z }
sources:
  - id: config
    resource: ../../roan/config.py
    title: ../../roan/config.py
---

# The file

    ~/.Roan/config.json

Written by `save_config(updates)`, read by `load_config()`. `DEFAULT_CONFIG` in
`roan/config.py` is the authority; this page mirrors it.

| Key | Default | Meaning |
|---|---|---|
| `provider` | `"lmstudio"` | provider id, or `"custom"` |
| `base_url` | `null` | only used when the provider is custom; normalised from the preset otherwise |
| `api_key` | `null` | overrides the preset key when set |
| `model` | `"local-model"` | the model id. `"local-model"` is a **placeholder**, not a model |
| `language` | `"nl"` | `nl` or `en`, for the UI and the agent |
| `theme` | `"mocha"` | `latte`, `frappe`, `macchiato` or `mocha` |
| `endpoints` | `[]` | saved custom endpoints |
| `tui` | `null` | `fullscreen`, `default`, or `null` for the default (fullscreen) |
| `tui_prompts` | `0` | legacy counter from the removed first-run dialog |
| `tui_declined` | `false` | legacy flag from the removed first-run dialog |
| `tui_fails` | `0` | failed fullscreen starts; two in a row switches to classic |
| `scroll_speed` | `1` | mouse-wheel multiplier |
| `auto_follow` | `true` | scroll along with new output |
| `telegram_token` | (absent) | bot token for the Telegram channel |
| `avatar` | (absent) | path to an image for the avatar |

# Endpoints

    "endpoints": [
      {"name": "thuis", "base_url": "https://thuis.example/v1", "api_key": "sk-..."}
    ]

Managed with `add_endpoint()`, `get_endpoint()`, `get_endpoints()`,
`remove_endpoint()`. Names are the keys, so they have to be unique.

# Two things that surprise people

* **A known provider's `base_url` is normalised on save.** Passing a custom URL
  for provider `groq` is overwritten by Groq's own preset URL. Only
  `provider: "custom"` keeps what you set.
* **The file existing does not mean the app is configured.** `has_config()` is
  about the file; `is_configured()` is about whether it can chat. Setting only a
  theme creates the file and leaves `is_configured()` false, which keeps the
  mandatory setup on. See [configuration](../concepts/configuration.md).
