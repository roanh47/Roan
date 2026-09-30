---
type: Architecture
title: Architecture
description: The module map of roan/ — what each file owns and which way the dependencies point.
tags: [roan, architecture]
status: stable
generated: { by: hermes-agent/deepseek-v4.1-flash, at: 2026-09-30T08:12:52Z }
sources:
  - id: tui
    resource: roan/tui.py
    title: roan/tui.py
  - id: config
    resource: roan/config.py
    title: roan/config.py
  - id: models
    resource: roan/models.py
    title: roan/models.py
---

# Layers

Dependencies point one way: **entry points → TUI/REPL → agent → tools and
providers → config**. Nothing in the lower layers imports the TUI.

| Layer | Files | Owns |
|---|---|---|
| Entry | `cli.py`, `__main__.py` | Argument dispatch, `ensure_home()` before anything else |
| UI | `tui.py`, `repl.py`, `channels/telegram.py` | Screens, rendering, input. All three are front-ends over the same `Agent` |
| Agent | `agent.py`, `commands.py` | The model loop, streaming, tool calls, the system prompt, the slash-command registry |
| Capabilities | `tools.py`, `skills.py`, `memory.py`, `cron.py`, `mcp.py`, `photo.py` | One file per capability, no cross-imports |
| Data | `models.py`, `config.py`, `home.py` | Provider/model metadata, settings, the `~/.Roan` layout |
| Look | `themes.py`, `i18n.py` | The palette and every user-visible string |
| Misc | `update.py`, `init_cmd.py` | Self-update and the one-shot setup helper |

# Module notes

**`tui.py` (1.750 lines, the biggest file)** — the Textual app plus every modal
screen. It is big on purpose: screens share CSS and helpers, and splitting them
would mean exporting half the helpers. If it grows past ~2.500 lines, split the
screens into `roan/screens/`.

**`config.py`** — every path lives here and nowhere else. `ROAN_DIR`,
`CONFIG_PATH`, `SKILLS_DIR`, `CRON_DIR`, `PLUGINS_DIR`, `LOGS_DIR`, `CACHE_DIR`,
`PLANS_DIR`, `USER_PATH`, `MEMORY_PATH`, `INSTRUCTIONS_PATH`. Tests monkeypatch
these attributes, which is why the paths are read lazily (functions, not
module-level constants) in `home.py`, `skills.py` and `cron.py`.

**`models.py`** — all knowledge about providers and models, including the free
classification. Never touches the UI.

**`i18n.py`** — one dictionary per language. `t("key")` falls back to English.
It also holds the default instructions, the provider descriptions and the
onboarding text.

# Dependency rules

* The TUI never calls `httpx` or the OpenAI SDK directly; it goes through
  `Agent`.
* `models.py` never imports `tui.py`.
* `themes.py` and `i18n.py` import nothing from the project.
* Anything a front-end shows must exist in `i18n.py` — no inline Dutch or
  English in the TUI.

# What lives outside the package

    pyproject.toml     packaging and the two console scripts
    README.md          the front door, in English
    tests/             one file per concern
    knowledge/         this knowledge bundle
