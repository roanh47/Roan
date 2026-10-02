---
type: Concept
title: Memory
description: The durable notes in ~/.Roan/memory.md, the remember tool that fills them, and the screen that edits them.
tags: [roan, memory, tui, knowledge]
status: stable
sources:
  - id: memory
    resource: memory.py
    title: roan/memory.py
  - id: tui
    resource: tui.py
    title: roan/tui.py
  - id: memory-tests
    resource: ../tests/test_memory.py
    title: tests/test_memory.py
---

# One file, one line per note

`~/.Roan/memory.md` is what Roan still knows next session. `Agent` puts it in
the system prompt as "Geheugen uit eerdere sessies" (see
[agent](agent.md)), so it is part of every request the moment it is non-empty.

The unit is **one line**: `remember(note)` appends one stripped line, and
`entries()` reads them back as a list of stripped, non-empty lines.
`load_memory()` goes through `home.read_profile()`, which also drops blank lines
and lines starting with `#` — so a comment in `memory.md` is a comment, not a
note, and `entries()` will not offer it for removal.

| call | what it does |
|---|---|
| `load_memory()` | the text as the model sees it (no comments, no blanks) |
| `entries()` | the same text as a list: one note per line |
| `remember(note)` | appends one note; the agent's `remember` tool |
| `forget(note)` | removes that one line and rewrites the file |

`forget()` removes only the **first** match, because two identical lines are two
notes and you may want to drop them one at a time. It rewrites the file at once:
a removal that only lived in the running process would be back after a restart.
`True` means a line really went away, `False` means the note was empty, unknown,
or the file is not there.

# The screen

`/memory` opens `MemoryScreen` instead of printing the file into the chat.
Before issue #21 it did exactly that: a `Markdown` dump in `#messages` that
stayed there until you cleared the conversation, and offered no way to add or
remove anything. The chat belongs to the conversation; a file on disk needs a
screen. `/skills` and `/sessions` moved the same way.

    ╭──────────────────────────────────────────────────╮
    │  Geheugen (3)                                ✕    │
    │  Houdt van lokale modellen                         │
    │  Woont in Utrecht                                  │
    │  Drinkt geen koffie                                │
    │  Houdt van lokale modellen                         │  <- volledig, max 4 regels
    │   Nieuwe notitie…                      Toevoegen    │
    │  3 notities                              Verwijder   │
    │  Enter = toevoegen · Esc = terug                  │
    │  Roan vult dit met remember                       │
    ╰──────────────────────────────────────────────────╯

* **List** — one line per note, `scrollbar-gutter: stable` and
  `text-overflow: ellipsis` like `/skills` and `/sessions`.
* **Detail** — the highlighted note in full, in a `VerticalScroll` capped at four
  rows. The transcript does the same with `ToolResult`: short in the list, whole
  when you want to read it.
* **Input + Toevoegen** — also `Enter`, and the field is cleared afterwards so
  the next note can be typed straight away.
* **Verwijder** — removes the highlighted note (also `d` / `delete`). The order
  matters: the note leaves the file first, the list is redrawn from the file
  afterwards, so what you see is what is on disk.
* **Empty state** — the note list is hidden and `#memory-empty` takes its place.
  In the screen, not as a chat line, and it says who fills this: the `remember`
  tool and this screen.

`_reload()` always reads `memory.md` again rather than trusting a list on the
screen. Everything the screen shows is therefore something a fresh
`load_memory()` also returns.

# Form

`MemoryScreen` follows [the popup pattern](add-a-popup.md) exactly: outer
`Vertical(classes="popup")`, `_titlebar(...)` with the close button,
`CSS = POPUP_CSS + "<own ids>"`, Escape to close. Width `92%` and height `84%` so
it fits a 24-row terminal and stays readable at 46 columns; the keyboard hint is
two short lines because it also has to say where notes come from. Two of the
strings that carry that message live in [i18n](language.md) in both languages,
like every other visible string.

Two traps this screen hit, both from
[the shared popup style](shared-popup-style.md):

* `Input` and `Static` default to `width: 100%`, so in a row next to a button
  they push it outside the frame. `#memory-input { width: 1fr }` and
  `classes="value"` on the status line are what put the buttons back inside.
* Notities are user text, so they go into the list and the detail pane as a
  `rich.text.Text`, never as markup: `[iets]` in a note must stay `[iets]`.
