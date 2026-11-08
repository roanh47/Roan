---
type: Concept
title: TUI
description: The Textual application: two renderers, one app, and the layout rules that make it fit a phone.
tags: [roan, tui, textual]
status: stable
generated: { by: hermes-agent/deepseek-v4.1-flash, at: 2026-09-30T08:12:52Z }
verified: { by: process:pytest, at: 2026-09-30T08:12:52Z }
sources:
  - id: tui
    resource: tui.py
    title: roan/tui.py
  - id: fullscreen-tests
    resource: ../tests/test_tui_fullscreen.py
    title: tests/test_tui_fullscreen.py
---

# Two renderers, one app

`RoanApp(agent, avatar_path, renderer)` is the whole UI. `renderer` picks how
Textual draws it, and that is the only difference:

| Renderer | Textual call | Effect |
|---|---|---|
| `fullscreen` (**default**) | `app.run()` | Alternate screen. The app owns the whole window, like vim. No flicker, mouse on. |
| `default` | `app.run(inline=True)` | Draws inline, in the terminal's own scrollback. `Cmd+F` and tmux copy mode keep working. |

`config.resolve_renderer()` decides: `ROAN_DISABLE_ALTERNATE_SCREEN` forces
classic, `ROAN_NO_FLICKER=1` forces fullscreen, otherwise `config["tui"]`, and
**fullscreen when nothing was ever chosen**. After two failed fullscreen starts
`note_fullscreen_failure()` writes `tui: "default"` and the app boots classic on
its own.

`run_tui()` loops: it re-reads the renderer after every exit, so `/tui <mode>`
returns a `{"relaunch": mode}` result and the app comes back in the other mode
with the conversation intact.

There is no first-run question about the renderer. There used to be, imitating
Claude Code, but once fullscreen became the default there was nothing left to
ask, so the dialog was deleted along with `should_offer_fullscreen()`.

# Layout

    +-- avatar (25% wide, top-left) ------------------+
    |  Roan - je agent harness                    X   |   titlebar + close
    +-------------------------------------------------+
    |  #messages                        height 1fr    |   the conversation
    +-------------------------------------------------+
    |  #jump      (only when scrolled up)             |   docked bottom
    |  #queue     (only while messages wait)          |   docked bottom
    |  #input     the prompt                          |   docked bottom
    |  #status    model . provider . key state        |   docked bottom, last row
    +-------------------------------------------------+

`#messages` is a `VerticalScroll`; the rest are docked to the bottom in reverse
order. The status bar is always the last row (`region.y + height == screen
height`), which a test asserts at 62x24 and 100x50.

The avatar is the user's photo, rendered as half-block characters by `photo.py`
(`▀` with a foreground and a background, two pixels per cell). `_resolve_avatar()`
looks at the constructor argument, then `config["avatar"]`, then the bundled
`roan/assets/avatar.png`.

# Bindings

| Key | Action |
|---|---|
| `Ctrl+Q` | Quit |
| `Ctrl+C` | Stop the running reply first, quit on the next press (`priority=True`) |
| `Ctrl+L` | Clear the chat |
| `Ctrl+N` | New session |
| `F2` | Setup screen |
| `Ctrl+O` | Transcript |
| `Ctrl+End` / `Ctrl+Home` | Scroll to bottom / top |
| `PageUp` / `PageDown` | Page |

Escape means "back" inside a popup. In a popup with a search field, escape
**first clears the search** and only closes on the second press.

# Modals

Every modal screen is a `ModalScreen` with the same title bar and the same shared
CSS ([design system](design-system.md)):

| Screen | Opened by | Returns |
|---|---|---|
| `SetupScreen` | first start, `F2`, `/setup` | `True` saved, `False` cancelled |
| `ProviderScreen` | setup, `/provider` | `{provider, base_url, api_key}` |
| `ModelsScreen` | setup, `/models`, clicking the model chip | `(provider, model)` |
| `ThemeScreen` | `/theme` | the flavour name |
| `CommandScreen` | `Ctrl+P`, `/commands` | the command name |
| `SessionsScreen` | `/sessions` | the session id |
| `NewSessionScreen` | `/new`, `Ctrl+N` | the name of the new session |
| `RenameScreen` | `r` in the session picker | the new name |
| `SkillsScreen` | `/skills` | nothing; it only shows what is on disk |
| `TranscriptScreen` | `Ctrl+O` | nothing |

Two of them guard their own work: `ModelsScreen` is pushed from a worker thread
and `_models_busy` makes a second click during the fetch a no-op, so three rapid
clicks on the model chip open exactly one browser. `SessionsScreen` restores the
picked session (see [sessions](sessions.md)).

The command palette is a **table**, not a sentence: the left column is
`/name` plus its argument hint, padded to the widest *visible* left column, and
the description starts at one fixed column after it. `_rebuild` runs on every
filter change, so the column follows what is on screen. Both columns are clipped,
never wrapped.

The setup screen is **mandatory** while `config.is_configured()` is false: no
clos button, no Cancel, Escape only shows a nudge, and it reopens if it somehow
closes. `Ctrl+C` still quits, so you can never get stuck. See
[configuration](configuration.md).

`SkillsScreen` exists because a browser of what is on disk is not a message: it
lists every skill with `★` for an always-on one and `○` for a load-on-demand
one, and shows the full body of the highlighted skill in a scrolling pane. It
writes **nothing** into `#messages` — a list of files does not belong to the
conversation. See [skills, memory and profile](skills-memory-profile.md).

# Input

`HistoryInput` is an `Input` subclass that keeps a per-session history and walks
it with the up/down arrows. Clicking works everywhere: mouse support is on in
both renderers, and a tool result is a clickable widget that expands on click.

# The two sides of the conversation

`user_line(text)` and `roan_reply(text)` build every message row, so the live
chat, a restored session (`_render_history`) and the transcript cannot drift
apart. The user gets `$accent` (the flavour's pink) `❯` plus pink bold text;
Roan gets the same glyph in `$text-muted` in its own column, with the markdown
beside it. Both colours live in `RoanApp.CSS`, not in the markup: Rich markup
wins from CSS, so a colour in the text would ignore the theme.

# Streaming

The agent runs in a worker thread (`@work(thread=True)`), so the UI never blocks.
Events come back through `on_event` callbacks that mount widgets incrementally,
and the view auto-follows unless you scrolled up, in which case `#jump` shows how
many new lines are waiting and clicking it jumps back down. `scroll_speed` in
the config multiplies mouse-wheel scrolling.

The prompt stays enabled while a reply is running. What you submit is queued,
`#queue` counts it, and `_reply_done` sends the next one as soon as the current
reply finishes — one stream at a time, popping the queue before sending so a
message can never go out twice. `Ctrl+C` during a reply sets `_stop`, empties
the queue and leaves the app running and usable; `Ctrl+Q` always quits.

# One empty column next to a scrollbar

The lists in the popups are one column narrower than `scrollable_content_region`
(`SCROLLBAR_GAP`). Textual draws a vertical scrollbar flush against the right
edge of the inner width — measured in 8.2.8, see `Widget._arrange_scrollbars` —
so `margin-right` or `padding-right` can only ever put that column *outside* the
scrollbar, next to the popup border. Making the row itself one column shorter
puts it on the correct side, and `scrollbar-gutter: stable` keeps that width
steady when the scrollbar appears or disappears.
