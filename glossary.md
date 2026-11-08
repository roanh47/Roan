---
type: Reference
title: Glossary
description: The words this project uses in a specific way, so an agent does not have to guess.
tags: [roan, glossary]
status: stable
generated: { by: hermes-agent/deepseek-v4.1-flash, at: 2026-09-30T08:12:52Z }
---

# Terms

**Harness** — the program around the model: the loop, the tools, the prompt, the
UI. Roan is a harness; the model is something you plug in.

**Flavour** — one of the four Catppuccin variants: latte, frappe, macchiato,
mocha. A flavour is a whole palette, not an accent colour.

**Accent** — the one colour used for emphasis, selection and primary buttons.
Always that flavour's pink. There is no second accent.

**Surface level** — one of the three background steps: `$background` (the
screen), `$surface` (a popup), `$panel` (a field inside a popup).

**Popup** — any modal screen: setup, provider picker, model browser, theme
picker, transcript. All five share one CSS block.

**Free-tier provider** — a provider whose *whole* catalogue is free with no
subscription. Not "a provider that happens to have one free model".

**Plan provider** — a provider that is cheap only because you pay a monthly
subscription (an "Alibaba coding plan"). Not free, and never listed as free.

**Local provider** — a server on your own machine on a well-known localhost
port. Listed separately from free, because "free" and "runs here" are different
promises.

**Custom endpoint** — a named, saved OpenAI-compatible endpoint of your own. You
can keep several.

**Fullscreen renderer** — Textual drawing on the terminal's alternate screen, so
the app owns the whole window. The default.

**Classic renderer** — Textual drawing inline, in the terminal's own scrollback.
Opt-in, via `/tui default`.

**Home** — the `~/.Roan` directory, with a capital R.

**Skill** — a markdown file in `~/.Roan/skills/` whose body is pulled into the
prompt on demand through the `read_skill` tool.

**Compact** — summarise the conversation and replace the old messages with the
summary, to keep long sessions usable.
