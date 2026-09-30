---
type: Reference
title: CLI and slash commands
description: The two command surfaces: subcommands from the shell, slash commands inside the app.
tags: [roan, reference, commands, cli]
status: stable
generated: { by: hermes-agent/deepseek-v4.1-flash, at: 2026-09-30T08:12:52Z }
verified: { by: process:pytest, at: 2026-09-30T08:12:52Z }
sources:
  - id: cli
    resource: cli.py
    title: roan/cli.py
  - id: commands
    resource: commands.py
    title: roan/commands.py
---

# Subcommands

Dispatched in `roan/cli.py`. `ensure_home()` runs first, always.

| Command | Does |
|---|---|
| `Roan` | start the TUI (the default) |
| `Roan chat [session]` | the plain REPL, for a non-TTY or a narrow terminal |
| `Roan telegram` | run the Telegram channel |
| `Roan cron` | run the scheduler loop |
| `Roan init` | one-shot setup helper |
| `Roan home` | print the ~/.Roan tree with item counts |
| `Roan update` | self-update, channel aware |
| `Roan version` / `-v` / `--version` | print the version |
| `Roan help` / `-h` / `--help` | print the help text |

`roan` (lowercase) is installed as an alias for the same entry point.

# Slash commands

Registered in `roan/commands.py`; `names()` returns these sixteen:

| Command | Does |
|---|---|
| `/help` | the command list, generated from the string table |
| `/setup` | open the setup screen |
| `/provider [name]` | open the provider picker, or set one directly |
| `/model [name]` | show or set the model |
| `/models` | open the model browser |
| `/free` | list the free providers |
| `/theme [flavour]` | open the theme picker, or set it directly |
| `/language <nl\|en>` | set the UI and agent language |
| `/memory` | show what Roan remembered |
| `/skills` | list the available skills |
| `/sessions` | list saved sessions |
| `/compact` | summarise the conversation |
| `/new` | start a new session |
| `/clear` | clear the chat view |
| `/tui <fullscreen\|default>` | switch renderer and relaunch |
| `/quit` | quit |

`/cron` deliberately does **not** exist: cron is a long-running process, not a
chat command, and a test asserts the name stays out of the registry.

# Aliases

The registry is the single place a command name is declared. Adding a name there
means a leading slash line no longer reaches the model, so a registered command
must have a handler. See
[add a slash command](add-a-slash-command.md).
