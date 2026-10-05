---
type: Concept
title: Writing style
description: The style document in the repo, the copy in ~/.Roan, and the GitHub upstream that keeps it current without a release.
tags: [roan, style, skills, github, always]
status: stable
sources:
  - id: style
    resource: style.py
    title: roan/style.py
  - id: skills
    resource: skills.py
    title: roan/skills.py
  - id: document
    resource: skills/roan-writing-style/SKILL.md
    title: roan/skills/roan-writing-style/SKILL.md
---

# What this is for

The agent has to write in Roan's style, in every reply, without being asked. That
only works if the document carrying those rules is **in the prompt on every
request**, and only if it is the **newest** version of the document. A style that
lags behind is worse than no style: it looks applied and is not.

A release is not a reason to pin the style. If Roan is 2.0 and the style is 3.0,
Roan uses 3.0.

# Three places, one document

| Place | What it is |
|---|---|
| `roan/skills/roan-writing-style/SKILL.md` | the version that ships with this repo, and the upstream on GitHub |
| `https://raw.githubusercontent.com/roanh47/Roan/pre-release/roan/skills/roan-writing-style/SKILL.md` | the same file, fetched at run time so a newer style needs no release |
| `~/.Roan/skills/roan-writing-style/SKILL.md` | what the agent actually reads, because `skills.py` reads the home and nothing else |

The home copy is the only file the prompt path touches, so the sync happens
**before** the agent is built: `cli.main()` calls `style.sync()` right after
`ensure_home()`, which covers the TUI, the REPL, Telegram and cron in one place.

The repo copy carries `always: true` and the same body as the document it was
taken from. The `always` flag is what puts the whole body in the system prompt
(see [skills, memory and profile](skills-memory-profile.md)); the caps there sit
above the length of this document on purpose, and a test fails if they ever drop
below it (`test_the_shipped_style_fits_the_always_budget`).

# The sync

`style.sync()` does three things, in this order:

1. **Seed or update from the repo.** If the bundled version is newer than what is
   in the home, it is copied over. This works with no network at all.
2. **Fetch from GitHub — at most once a day.** `CHECK_INTERVAL` is 24 hours, so a
   normal start makes no request at all. A fetch that comes back newer replaces
   the home copy; a fetch that comes back older does **nothing**, because a stale
   upstream is not a reason to go backwards.
3. **Record what happened** in `~/.Roan/writing-style.json`: the version that came
   back, the source, and the time of the last successful check. That file answers
   the only question that matters after a failure: which style was this
   installation running?

# Versions are read, not guessed

`version:` in the frontmatter is the only version. `style.version_of()` reads it
and `_parts()` compares it as numbers, so `3.10` is newer than `3.9` — string
comparison gets that backwards.

# When it fails, it says so

No network, a 404 or a timeout is not an exception that takes Roan down; it is what
a laptop without reception looks like. The copy keeps working, the check is
recorded as failed, and `status()["stale"]` becomes True. The TUI prints one line
at start-up when that happens (`_style_note`), and nothing when the style was
checked recently: a tick on every start is noise.

`ROAN_NO_NETWORK=1` skips the fetch entirely, for a machine that should never call
out; `ROAN_STYLE_URL` points the sync somewhere else, for a branch or a mirror.
Both are in [environment variables](env-vars.md).

What is **never** allowed is falling back to an older version silently. A cache
with a visible "not checked" note is honest; a quiet downgrade is not.
