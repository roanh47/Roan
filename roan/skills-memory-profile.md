---
type: Concept
title: Skills, memory and profile
description: The three files that shape the system prompt besides the instructions.
tags: [roan, skills, memory, prompt]
status: stable
generated: { by: hermes-agent/deepseek-v4.1-flash, at: 2026-09-30T08:12:52Z }
verified: { by: process:pytest, at: 2026-09-30T08:12:52Z }
sources:
  - id: agent
    resource: agent.py
    title: roan/agent.py
  - id: skills
    resource: skills.py
    title: roan/skills.py
  - id: memory
    resource: memory.py
    title: roan/memory.py
---

# The system prompt

`Agent._build_system_prompt()` assembles, in order:

1. **Instructions** - `instructions.md` if present, otherwise
   `i18n.DEFAULT_INSTRUCTIONS`. The default tells the model it is Roan, a harness
   built to mirror Roan Heemstra, and how to behave.
2. **User profile** - `home.read_profile()`, comment lines stripped, empty means
   omitted.
3. **Memory** - `memory.load_memory()`.
4. **Skills** - `skills.skills_prompt()`: the body of every `always: true`
   skill, then `name: description` of the rest. The list never carries a body.

That order matters: identity first, then facts about the user, then notes, then
capabilities. Inside the skills part the binding block comes first, so the style
rules land before the list can bury them.

# Skills

A skill is a markdown file in `~/.Roan/skills/` with YAML frontmatter:

    ---
    name: deploy-check
    description: Check whether a deploy went out cleanly.
    ---
    Steps ...

Two layouts are read: a loose `*.md` in the skills folder, and
`<topic>/SKILL.md` for one skill per topic.

* `skills.skills_list_text()` powers `/skills`.
* `skills.get_skill(name)` reads the body, and the model asks for it through the
  **`read_skill`** tool. Only when it is needed does the body cost tokens.

This mirrors the bigger harnesses: advertise the index, load on demand.

## `always: true` — the exception, for rules that may not be optional

The index is cheap, and that is also its weakness: a skill saying "always write
like this" had **no effect**, because the body was reachable only if the model
happened to call `read_skill`. A rule that must always apply cannot depend on
that.

A skill with `always: true` in its frontmatter has its **whole body** inlined
into the system prompt on every request, under `[Schrijfstijl — altijd van toepassing]`
with the line "Deze regels gelden voor ELK bericht dat je schrijft". The block
comes **before** the loose skill list, so identity and instructions are already
in place when the model reads it and the list cannot bury it. `true`, `yes`,
`1`, `on` and `ja` all count; without the key nothing changes.

    ---
    name: roan-writing-style
    description: De schrijfstijl van Roan
    always: true
    ---
    Zinnen blijven onder ~25 woorden. Nooit beginnen met "Zeker".

## What the caps do, and why they are never silent

`MAX_ALWAYS_CHARS` (4 000) caps one skill, `MAX_ALWAYS_TOTAL` (12 000) caps all
of them together. Both are visible, in two places:

* in the prompt — a clipped body ends with which rule was cut, how long the
  skill is and how to fetch the rest (`read_skill(name)`); a skill that does not
  fit the total budget is named in `[NIET meegestuurd: …]` with the advice to
  drop `always` or shorten the skill;
* in the **`/skills` screen** — `skills.always_warnings()` returns the same
  verdict per skill and the popup prints it above the body.

The two paths walk the same budget (`_walk_always`), so they cannot disagree.
A style guide that is silently truncated is worse than no style guide: it looks
applied and is not.

# `/skills` is a screen, not a message

`/skills` used to write the whole list into the chat as markdown, where it
stayed until the conversation was cleared. It opens `SkillsScreen` instead: a
`ModalScreen` in the house style (`Vertical(classes="popup")`, `_titlebar(...)`
with the ✕, `CSS = POPUP_CSS + …`) that lists every skill as
`★` (always on, body in every request) or `○` (name and description only, body
via `read_skill`), and shows the **full body** of the highlighted one in a
scrollable pane. Escape, `q` or ✕ closes it, and nothing lands in `#messages`.

# Memory

`~/.Roan/memory.md`, written by the model through the **`remember`** tool and
read by `memory.load_memory()`. Comment lines starting with `#` are ignored, so
the file can carry its own header without that header entering the prompt.

`/memory` shows what is in it. Memory is for durable facts that apply to every
session; anything task-specific belongs in the conversation, not here.

# Profile

`~/.Roan/user.md` is hand-written: who the user is, what they work on. It is the
highest-leverage file in the home directory and the setup does not write it for
you. Only lines without a leading `#` are sent, and it holds **facts, not
instructions**: how you want to be talked to belongs in `instructions.md` or in
a skill, so it is one edit instead of two competing ones.

`KNOWLEDGE.md`, next to it, is the one file to open when you want to know what
you can tell Roan: three lines, one per source, and nothing invented about the
user.
