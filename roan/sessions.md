---
type: Concept
title: Sessions
description: One JSON file per conversation, restore on start, and compaction for long chats.
tags: [roan, sessions, history, compact]
status: stable
generated: { by: hermes-agent/deepseek-v4.1-flash, at: 2026-09-30T08:12:52Z }
verified: { by: process:pytest, at: 2026-09-30T08:12:52Z }
sources:
  - id: agent
    resource: agent.py
    title: roan/agent.py
  - id: tui
    resource: tui.py
    title: roan/tui.py
---

# Storage

`sessions/` holds one JSON file per conversation, named by session id. The id is a
timestamp with `-2`, `-3` and so on behind it when two sessions start in the same
second, so two conversations never share a file. A file holds `id`, `messages` and
— when the user gave one — `name`; `/sessions` falls back to the id only when it
has neither a name nor a first user message.

    Agent(session_id=None, restore=True, use_mcp=True)

On construction the agent picks up the newest session (unless `restore=False`),
which is why the TUI comes back to the same conversation after a restart. `/new`
starts a fresh one.

# The picker

`/sessions` pushes `SessionsScreen`, a `ModalScreen` **above** the conversation:
the screen stack is `["Screen", "SessionsScreen"]`, `#messages` stays mounted with
its widgets and is only dimmed behind the popup. Nothing is written into
`#messages` — not the list, and not a "no sessions yet" line either; that message
is an option in the list instead. A reference to something on disk belongs in the
window made for it, not between the messages.

The screen follows the shared popup conventions
([shared popup style](shared-popup-style.md)): a `Vertical(classes="popup")` with
`_titlebar(...)` and a ✕, `CSS = POPUP_CSS + <own ids>`, Escape and ✕ to close, and
a hint line under the list that says what Enter and Escape do.

One row per session, one line, newest first, ordered by the file's mtime rather
than its name (the name is usually a timestamp, but "newest" means last touched).
A row carries three things:

    ○ maak de popup boven het chatbox    2026-10-02 13:58  ·  2 berichten

* the mark: `●` for the session you are in, `○` for the others;
* the title: the name you gave it, or else the first user message flattened to one
  line, with the session id as fallback when the file has neither. A list of
  timestamps is not a menu;
* a right-hand column with the date and the message count.

`_session_entries()` builds that in one read per file and `SessionsScreen._meta()`
picks how much of the right-hand column fits: the full stamp, then without the
year, then without the time, and as a last resort the bare `×n`. The row is never
wrapped — it is padded so the right-hand column ends on the same column on every
row, and clipped with `…` when a title is longer than the space left. So at 46
columns a row reads `○ vraag nummer 7 o…  10-02  ·  ×2`, and it still fits.

The box is 66% high on purpose: at 88% the popup overlapped the border of the
input frame on a 24-row terminal, which reads as a broken render. At 66% it
floats above the chatbox at every size.

Enter (or clicking a row) restores it: `_restore_session` sets the `session_id`,
resets the message list to the system prompt and lets `Agent._restore()` put that
conversation back, then re-renders it. **`Agent.clear()` is deliberately not
called**, because it saves immediately and would overwrite the file being
restored. `save()` only runs when the file actually yielded messages, so a broken
or empty file is not wiped out by the restore path.

# Naming

A row is a pointer, so the title has to be something you recognise. That is why
`/new` (and `Ctrl+N`) opens `NewSessionScreen` first: it asks for a name and starts
nothing until it has one. A conversation with no messages has no first message to
fall back on, so without a name it is a bare timestamp in the list — exactly the
session you cannot find back.

The name lives in the session file as `name`, which is why `Agent.save()` writes it
next to `id` and `messages`: a rename would otherwise be gone on the next turn.
`agent.set_session_name()` is the single writer, refuses an empty name, and returns
`False` when there is no file to write to.

`r` in the picker opens `RenameScreen` with the current name already in the field,
so you extend it instead of retyping it. Renaming the session you are in moves
`Agent.session_name` along too (`RoanApp._session_renamed`), because a stale name in
the agent is a name the next `save()` writes back.

Both screens are ordinary popups: Enter commits, Escape and ✕ leave everything as
it was, and an empty name keeps the screen open with a line that says so.

# The message history

Held in `Agent.messages` as OpenAI-style dicts: `system`, `user`, `assistant`,
`tool`. The TUI renders the same list in the transcript (Ctrl+O), skipping the
system message.

# Compaction

Long conversations eventually cost more than they are worth. `/compact` calls
`Agent.compact()`:

1. Ask the model to summarise the conversation.
2. Replace the old messages with that summary, keeping the system prompt.

`compact(force=False)` refuses when there is nothing worth summarising, and the
TUI prints "nothing to compact" rather than sending a pointless request.

This is the same idea as the bigger harnesses, and it is what keeps a session
usable for hours on a small context window.
