---
type: Decision
title: Capital R: ~/.Roan and the Roan command
description: The home directory and the primary command both use a capital R, with a lowercase alias.
tags: [roan, decision, naming]
status: stable
generated: { by: hermes-agent/deepseek-v4.1-flash, at: 2026-09-30T08:12:52Z }
sources:
  - id: config
    resource: config.py
    title: roan/config.py
  - id: cli
    resource: cli.py
    title: roan/cli.py
---

# Decision

* The home directory is `~/.Roan`, not `~/.roan`.
* The command is `Roan`, with `roan` also installed as an alias.
* `Roan` with no arguments starts the TUI.

# Why

It is the user's name. `~/.Roan` matches the way the name is written everywhere
else in the project, and a tool that is named after a person should spell that
name correctly. The lowercase alias exists because lowercase is what fingers type
and because Linux filesystems are not the place to have an argument about it.

# What it costs

Two console scripts instead of one, and a one-time migration:

    config.migrate_legacy_dir()

renames an existing `~/.roan` to `~/.Roan` if the new one does not exist yet. It
runs once at startup and is a no-op afterwards.

# The trap

On a case-insensitive filesystem (macOS by default) `~/.roan` and `~/.Roan` are
the same path, so the migration check "does the old one exist and the new one not"
behaves differently. Do not add logic that assumes the two names are distinct.
