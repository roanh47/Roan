---
type: Concept
title: Design system
description: One shared CSS block styles every popup, so setup, providers, models, theme and transcript cannot drift apart.
tags: [roan, design, css, tui]
status: stable
generated: { by: hermes-agent/deepseek-v4.1-flash, at: 2026-09-30T08:12:52Z }
verified: { by: process:pytest, at: 2026-09-30T08:12:52Z }
sources:
  - id: tui
    resource: ../../roan/tui.py
    title: roan/tui.py (POPUP_CSS)
  - id: look-tests
    resource: ../../tests/test_tui_look.py
    title: ../../tests/test_tui_look.py
---

# The rule

Every popup's outer `Vertical` carries `classes="popup"`, and `POPUP_CSS` - one
module-level constant in `tui.py` - styles all of them. A screen's own `CSS` is
`POPUP_CSS + "<its own ids>"`. Adding a popup means adding the class, not copying
styles.

    CSS = POPUP_CSS + """
    #setup-box { width: 92%; max-width: 74; }
    """

# Depth instead of borders

Three surface levels carry the hierarchy, so there are no borders on widgets:

| Level | Token | Mocha value | Used for |
|---|---|---|---|
| Screen | `$background` | `#181825` | the app background |
| Popup | `$surface` | `#313244` | the modal box |
| Field | `$panel` | `#45475A` | inputs, buttons, selects |

A popup gets exactly **one** border: `border: round $border`, in the theme's
lavender. Everything inside it is flat. This is deliberate: an earlier version
had a border on every widget and the complaint was "why are there lines
everywhere"; removing them all made it look empty; the landing point is one frame
per popup plus the three surface levels.

# Building blocks

| Class | Purpose |
|---|---|
| `.popup` | the modal box: round border, `$surface`, padding `1 2`, `height: auto` |
| `.titlebar` + `.title` + `.close` | title left, close button right, title aligned with the field labels |
| `.section` | a muted field label ("Provider", "API key") |
| `.value` | the current value next to a pick button, `1fr` with ellipsis |
| `.row` | a `Horizontal` of value plus button, one row tall |
| `.hint` | one muted line above the actions |
| `.actions` | the button row, right-aligned, one row tall |

The canonical popup shape:

    + title ------------------------------------------ X +
    |                                                    |
    |  <section>                                         |
    |  <value>                             [ Kies... ]   |
    |  <section>                                         |
    |  [ input                                          ]|
    |                                                    |
    |  <hint>                                            |
    |                             [Cancel] [Primary]     |
    +----------------------------------------------------+

# Rules that were bugs once

* **The title must line up with the labels.** `.popup .titlebar .title { padding: 0 }`.
  The box already pads `1 2`, so the default `padding: 0 2` on `.title` pushed
  the title two columns right of every field label.
* **A hint never shares a row with buttons.** It was `1fr` next to the buttons
  once, which pushed the save button to column 69 on a 62-column screen: off
  screen and unreachable. The hint gets its own row.
* **Row containers get explicit heights.** An unset height on a `Horizontal`
  inside the popup resolved to `1fr` and produced two blank rows around the
  category tabs.
* **`height: auto` lives on the box, never on a row.**
* **Sections carry no top margin.** With `margin-top: 1` on every `.section` the
  setup screen grew past an 18-row terminal. Spacing comes from the title bar's
  bottom margin and the hint/actions top margins only.

# Sizes

Popups are a percentage with a `max-width` cap, so they grow with the terminal
but never get silly on a wide monitor:

| Popup | Width | Height |
|---|---|---|
| Setup | 92%, max 74 | auto |
| Providers | 92%, max 104 | 86% |
| Models | 92%, max 96 | 88% |
| Theme | 62%, max 46 | auto |
| Transcript | 95%, max 140 | 95% |

Tested to fit at 60x24, 50x20 and 46x18 - a phone over SSH is a first-class case.
