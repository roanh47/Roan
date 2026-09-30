---
type: Decision
title: The TUI is the product
description: No supported embedding API; every front-end is a thin shell over the same Agent.
tags: [roan, decision, scope]
status: stable
generated: { by: hermes-agent/deepseek-v4.1-flash, at: 2026-09-30T08:12:52Z }
sources:
  - id: tui
    resource: ../../roan/tui.py
    title: ../../roan/tui.py
  - id: repl
    resource: ../../roan/repl.py
    title: ../../roan/repl.py
---

# Decision

`Roan` starts the TUI. There is also a `chat` REPL and a `telegram` channel, but
those are conveniences for a non-TTY or a phone, not a library surface.

# Why

* A supported embedding API is a compatibility contract. This project does not
  want one: it wants to be a program you run.
* The value is in the whole experience - keys, popups, the status bar, streaming.
  A library would be the agent without the product.
* Three thin front-ends over one `Agent` is already the right amount of
  structure. A fourth, programmatic one would need a different design, not a
  smaller one.

# What it costs

* Nobody can `import roan` and drive it from a script. The escape hatch is
  `Roan chat` in a pipe, or the code itself.
* `chat` must keep working well enough for a narrow terminal. It is a fallback,
  so it is allowed to be plain.

# The rule for new front-ends

If a new front-end appears, it holds one `Agent` and does not reimplement the
prompt, the tools or the config. Telegram is the model: 212 lines, all of it
transport and formatting.
