---
type: Reference
title: File map
description: Every file in the repository with its line count, so an agent knows where to look first.
tags: [roan, reference, files]
status: stable
generated: { by: hermes-agent/deepseek-v4.1-flash, at: 2026-09-30T08:12:52Z }
verified: { by: process:generate_file_map, at: 2026-09-30T08:12:52Z }
sources:
  - id: repo
    resource: ../../
    title: repository root
---

# Package: roan/

| File | Lines |
|---|---|
| `roan/__init__.py` | 1 |
| `roan/__main__.py` | 3 |
| `roan/agent.py` | 427 |
| `roan/channels/__init__.py` | 5 |
| `roan/channels/base.py` | 28 |
| `roan/channels/telegram.py` | 212 |
| `roan/cli.py` | 77 |
| `roan/commands.py` | 61 |
| `roan/config.py` | 230 |
| `roan/cron.py` | 149 |
| `roan/home.py` | 95 |
| `roan/i18n.py` | 551 |
| `roan/init_cmd.py` | 46 |
| `roan/mcp.py` | 202 |
| `roan/memory.py` | 27 |
| `roan/models.py` | 277 |
| `roan/photo.py` | 89 |
| `roan/repl.py` | 66 |
| `roan/skills.py` | 101 |
| `roan/themes.py` | 119 |
| `roan/tools.py` | 156 |
| `roan/tui.py` | 1966 |
| `roan/update.py` | 63 |

# Root and tests

| File | Lines |
|---|---|
| `pyproject.toml` | 34 |
| `README.md` | 324 |
| `tests/fake_mcp_server.py` | 57 |
| `tests/generate_file_map.py` | 84 |
| `tests/project_board.py` | 204 |
| `tests/test_agent.py` | 170 |
| `tests/test_cli.py` | 85 |
| `tests/test_home.py` | 247 |
| `tests/test_i18n.py` | 158 |
| `tests/test_integration.py` | 170 |
| `tests/test_mcp.py` | 71 |
| `tests/test_models_free.py` | 224 |
| `tests/test_okf_bundle.py` | 145 |
| `tests/test_photo.py` | 71 |
| `tests/test_providers.py` | 367 |
| `tests/test_roan.py` | 168 |
| `tests/test_search.py` | 313 |
| `tests/test_setup_required.py` | 183 |
| `tests/test_telegram.py` | 158 |
| `tests/test_themes.py` | 218 |
| `tests/test_tui.py` | 307 |
| `tests/test_tui_close.py` | 201 |
| `tests/test_tui_fullscreen.py` | 349 |
| `tests/test_tui_look.py` | 365 |
| `tests/validate_okf.py` | 166 |

# Where to look for what

| Question | File |
|---|---|
| How does the app render / which key does what | `roan/tui.py` |
| Which strings exist, in which language | `roan/i18n.py` |
| Which colours, which theme | `roan/themes.py` |
| Which providers, which is free, models.dev | `roan/models.py` |
| Where is any path or config key | `roan/config.py` |
| What the model can call | `roan/agent.py` + `roan/tools.py` |
| The ~/.Roan layout | `roan/home.py` |
| Skills, memory, cron | `roan/skills.py`, `roan/memory.py`, `roan/cron.py` |
| Telegram | `roan/channels/telegram.py` |
| MCP | `roan/mcp.py` |
| Entry points and subcommands | `roan/cli.py` |

The package is 4951 lines of Python in total. `roan/tui.py` is
the biggest file by far and holds every screen; that is deliberate - see
[one shared popup style](roan/shared-popup-style.md) - but it is the file to
split first if it gets unwieldy.

Regenerate this page with `python3 tests/generate_file_map.py` after a
structural change, so the counts do not drift.
