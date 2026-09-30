---
type: Overview
title: What Roan is
description: A terminal-based Python agent harness — own models, own keys, no servers, and a TUI built on Textual.
tags: [roan, overview, product]
status: stable
generated: { by: hermes-agent/deepseek-v4.1-flash, at: 2026-09-30T08:12:52Z }
sources:
  - id: readme
    resource: README.md
    title: README
  - id: pyproject
    resource: pyproject.toml
    title: pyproject.toml
---

# What it is

Roan is a **terminal agent harness**: you give it a provider and a key, and you
get a chat agent with tools, skills, memory and scheduled prompts, all in one
Textual TUI. It is the same category of program as Claude Code and OpenCode, but
it is deliberately small, pure Python, and yours to point at any model.

    pyproject.toml
      name    = roan
      version = 0.2.0rc1
      python  = >=3.10
      deps    = openai, rich, textual, pyyaml, httpx, mcp, python-dotenv
      scripts = Roan, roan

# The four promises

1. **Bring your own model.** Paid, free, or local — whatever speaks the
   OpenAI-compatible API. No model is baked in and no account is required.
2. **No servers, no account, no compliance layer.** Nothing leaves the machine
   except the calls to the provider you chose. See
   [local-first](local-first.md).
3. **One file to install.** A pure-Python wheel, so the same install works
   everywhere. Subcommands cover the rest: `Roan` (the TUI), `chat`, `telegram`,
   `cron`, `init`, `home`, `update`, `version`.
4. **The new TUI, not a fancy shell script.** Fullscreen alternate-screen
   rendering, mouse support, Catppuccin themes, and a fixed pink accent.

# What it is not

* **Not a fork.** It is written from scratch against the same interface ideas,
  not derived from OpenCode's source. See
  [own harness, not a fork](own-harness.md).
* **Not a TypeScript/Bun project.** Pure Python, one codebase, no per-platform
  binaries. See [Python, not TypeScript](python-not-typescript.md).
* **Not a library.** There is no supported embedding API; the TUI is the product.
  See [TUI only](roan/tui-only.md).
* **Not a service.** It never listens on a network port of its own.

# Who it is for

One user, on their own machine and over SSH from a phone. Small terminal widths
are a first-class case, not an afterthought: every popup has to fit on a phone.
