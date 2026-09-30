---
type: Idea Log
title: Ideas
description: What we might build or change next, with the reasoning. Not a commitment and not a plan.
tags: [roan, ideas, backlog]
status: draft
generated: { by: hermes-agent/deepseek-v4.1-flash, at: 2026-09-30T09:20:00Z }
sources:
  - id: readme
    resource: README.md
    title: README.md
  - id: architecture
    resource: architecture.md
    title: architecture.md
---

# How to read this

This file is the **why**: what the idea is, what problem it solves, and what it
would cost. It deliberately carries no status, because status changes weekly and
would drift.

The **state** lives on the GitHub Project board, which has three columns:

| Column | Meaning |
|---|---|
| To Do | agreed, not started |
| Doing | someone is on it now |
| Done | shipped, with a commit or a release behind it |

So: read here to understand an idea, look at the board to see where it stands. An
idea that is not on the board is not being worked on, and that is fine — most of
these will never happen, and that is the point of writing them down separately
from the code.

    gh project item-list 1 --owner roanh47

# Near

**`Roan doctor`** — one command that checks the things that actually go wrong:
is the config readable, is the provider reachable, is there a key where one is
needed, does the model id exist, what is the terminal size, is the alternate
screen available. Every setup problem we hit by hand would have been one line of
output from this. Cheap to build, and it pays for itself the first time someone
runs Roan over SSH on a phone.

**Session search** — `~/.Roan/sessions/` holds one JSON per session and nothing
reads them but the restore path. Searching across them ("when did I set up the
Groq key?") turns dead files into memory. The natural shape is `/sessions --find
<term>`, reusing the existing `session_search` idea.

**Split `tui.py` into `roan/screens/`** — it is the biggest file by a wide margin
and holds every screen. The architecture page already names the trigger: past
about 2.500 lines, split the screens out. Not yet, but know the exit.

**Token and cost accounting** — sessions record messages but not what they cost.
With metered providers that is the number people want, and it is the one that
makes local models obviously worth it. Needs a `usage` field per turn and a
per-session total.

**A second channel** — `BaseChannel` is the seam and Telegram proves it works.
Signal and Discord are the obvious next two; the interesting question is which
one can be run without standing up a server, because that constraint is not
negotiable.

# Middle

**Vision** — `photo.py` renders an image into half-blocks for the *terminal*.
That is not the same as sending an image to a model that can see it. The provider
layer already speaks OpenAI-compatible chat, so this is mostly a message-shape
change plus a UI path for attaching a file.

**`Roan cron` improvements** — the schedule parser handles intervals and
`daily HH:MM`. Real cron expressions, a `--list`, and a way to see the last
output of a job would all help. The 30-second poll is fine; the visibility is not.

**Cost-aware routing** — pick a model per turn based on the task and the price.
Attractive in theory. In practice it needs honest per-model quality data, which
nobody has, so it will probably stay a manual `/model` choice.

**Plugins: wire up or delete** — `~/.Roan/plugins/` exists in the layout and nothing loads from it.
Either wire it up (a plugin can register tools and slash commands) or delete the
directory, because an empty promise in a documented layout is worse than no
plugin system.

# Far

**Web UI** — the README lists it as the next thing after channels. It is a real
amount of work and it breaks the one hard constraint (nothing to host), unless it
runs locally only, which mostly means it duplicates the TUI with a worse input
model. Worth doing only if there is a use case the TUI cannot serve.

**Publishing under the name roan** — the name is not taken on npm or PyPI in
the sense that matters; it is taken in the sense that someone else owns it, so
this is the PEP 541 process, which takes months and can be refused. Until then
installs are from the repository, which is fine for the only user.

# Rejected

Kept because a rejected idea with a reason is worth more than a blank page.

* **Forking opencode instead of building this** — see [own-harness.md](own-harness.md).
* **A second, richer REPL next to the TUI** — the REPL exists only as a fallback
  for a terminal too small for the TUI. A better REPL is a distraction.
* **A configurable accent colour** — pink is fixed. Given the choice, every theme
  decays into whatever colour the last screenshot used. See
  [roan/pink-accent.md](roan/pink-accent.md).
