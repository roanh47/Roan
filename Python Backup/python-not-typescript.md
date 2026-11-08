---
type: Decision
title: Python, not TypeScript
description: One pure-Python wheel instead of compiling per platform.
tags: [roan, decision, stack]
status: stable
generated: { by: hermes-agent/deepseek-v4.1-flash, at: 2026-09-30T08:12:52Z }
verified: { by: process:pytest, at: 2026-09-30T08:12:52Z }
sources:
  - id: pyproject
    resource: pyproject.toml
    title: pyproject.toml
  - id: tui
    resource: roan/tui.py
    title: roan/tui.py
---

# Decision

The whole project is Python 3.10+, packaged as a single pure-Python wheel.

# Why

* **One artifact for every platform.** Claude Code compiles one TypeScript
  codebase into eight platform binaries with Bun, which is why its install is
  large and platform-specific. A pure-Python wheel is one file that works
  everywhere Python does.
* **Textual is genuinely good.** It gives a fullscreen alternate-screen renderer,
  CSS-like styling, mouse support and a test harness (`run_test()`) that made the
  whole UI testable without a terminal.
* **The dependencies are boring.** `openai`, `rich`, `textual`, `pyyaml`,
  `httpx`, `mcp`, `python-dotenv`. Nothing exotic.

# What it costs

* Startup is ~0.4s on a small machine. Acceptable for a TUI, and it is dominated
  by imports, not by the language.
* Distribution to people without Python needs PyInstaller or Nuitka later. That
  is a packaging task, not a rewrite.

# What would change it

A hard need for a single self-contained binary with no Python on the machine, or
a UI requirement Textual cannot express. Neither is on the table.
