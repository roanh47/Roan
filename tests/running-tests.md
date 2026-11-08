---
type: Howto
title: Run the tests
description: How to run the suite, which tests guard what, and the PTY trick for the alternate screen.
tags: [roan, tests, pytest]
status: stable
generated: { by: hermes-agent/deepseek-v4.1-flash, at: 2026-09-30T08:12:52Z }
verified: { by: process:pytest, at: 2026-09-30T08:12:52Z }
sources:
  - id: tests
    resource: .
    title: tests
  - id: pyproject
    resource: ../pyproject.toml
    title: pyproject.toml
---

# The command

    cd /home/roan/Roan
    . .venv/bin/activate
    python3 -m pytest tests/ -q

324 tests, about 40 seconds. They run **offline**: `models.py` caches the
models.dev payload and the tests call `clear_cache()` and monkeypatch the
provider functions, so no network call happens.

# Layout

| File | Guards |
|---|---|
| `test_roan.py` | core config and agent behaviour |
| `test_tui.py` | the app, input, commands |
| `test_tui_fullscreen.py` | renderers, transcript, auto-follow, screen filling |
| `test_tui_close.py` | Ctrl+C and the close button in every popup |
| `test_tui_look.py` | background, borders, phone sizes, alignment, shared popup class |
| `test_themes.py` | the four flavours, pink accent, picker, persistence |
| `test_providers.py` | the four categories and custom endpoints |
| `test_search.py` | search in providers and models |
| `test_models_free.py` | the free classification |
| `test_setup_required.py` | `is_configured()` and the mandatory setup |
| `test_home.py` | the ~/.Roan layout |
| `test_i18n.py` | key parity and duplicate keys |
| `test_agent.py`, `test_mcp.py`, `test_cli.py`, `test_telegram.py`, `test_integration.py` | the rest |

# Isolation

Every UI test uses a `roan_cfg` or `tmp_roan` fixture that monkeypatches the
config paths to a `tmp_path`. If a test writes into the real `~/.Roan`, that is a
bug in the test - it happened once with a skills file. Use the existing fixtures;
do not invent new path handling.

# The PTY trick

`run_test()` cannot tell you whether the app really took over the terminal. For
that, fork a PTY, set the window size, run `Roan`, and look for the
alternate-screen escapes. Two things to assert:

* the "alternate screen on" escape appears, and "alternate screen off" on exit;
* the set of addressed rows covers the whole height, e.g. rows 1..24 of 24.

With `ROAN_DISABLE_ALTERNATE_SCREEN=1` neither escape should appear - that is the
classic renderer.

# Reading the screen

When a change touches layout, render it and read it back:

    app.screen._compositor.render_strips()

It returns the terminal lines as they will be drawn, which is the only reliable
way to check alignment, clipping and blank rows. Eyeballing a colour screenshot
is not, because the compositor ignores colour alpha in the text dump.
