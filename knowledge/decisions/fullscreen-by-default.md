---
type: Decision
title: Fullscreen is the default renderer
description: The app takes over the whole terminal via the alternate screen, like the new Claude Code TUI.
tags: [roan, decision, tui]
status: stable
generated: { by: hermes-agent/deepseek-v4.1-flash, at: 2026-09-30T08:12:52Z }
verified: { by: process:pytest, at: 2026-09-30T08:12:52Z }
sources:
  - id: config
    resource: ../../roan/config.py
    title: ../../roan/config.py
  - id: fullscreen-tests
    resource: ../../tests/test_tui_fullscreen.py
    title: ../../tests/test_tui_fullscreen.py
---

# Decision

`resolve_renderer()` returns `fullscreen` when the user has never chosen. The
classic inline renderer stays available through `/tui default`,
`ROAN_DISABLE_ALTERNATE_SCREEN=1` and `ROAN_TUI=default`.

# Why

The inline renderer draws the app *below* whatever is already on screen, so the
SSH banner and the shell prompt stay visible above it and the app only gets the
remaining rows. On a phone that looks broken - "it doesn't take over your whole
screen". The alternate screen gives the app the entire window, which is what a
TUI should feel like, and it restores the scrollback on exit.

# What it costs

* The app's output is not in the terminal's own scrollback, so `Cmd+F` and tmux
  copy mode do not see it. That is what `/tui default` is for, and the transcript
  view (Ctrl+O) covers the "find something from earlier" case.
* Some terminals and multiplexers handle the alternate screen badly. After two
  failed fullscreen starts `note_fullscreen_failure()` falls back to classic on
  its own, and `ROAN_DISABLE_ALTERNATE_SCREEN` is the manual override.

# What was removed

The first-run dialog asking "new or old TUI". Once fullscreen is the default
there is nothing to ask, so `TuiPromptScreen`, `_maybe_offer_fullscreen()` and
`config.should_offer_fullscreen()` were deleted rather than left dangling.
