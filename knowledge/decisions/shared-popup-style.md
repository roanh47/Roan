---
type: Decision
title: One shared style for every popup
description: All modal screens draw from a single CSS constant instead of each carrying their own copy.
tags: [roan, decision, design, tui]
status: stable
generated: { by: hermes-agent/deepseek-v4.1-flash, at: 2026-09-30T08:12:52Z }
verified: { by: process:pytest, at: 2026-09-30T08:12:52Z }
sources:
  - id: tui
    resource: ../../roan/tui.py
    title: ../../roan/tui.py
  - id: look-tests
    resource: ../../tests/test_tui_look.py
    title: ../../tests/test_tui_look.py
---

# Decision

`POPUP_CSS` in `tui.py` styles every modal screen. A screen's `CSS` is that
constant plus its own width and height. The outer box of every popup carries
`classes="popup"`.

# Why

Five popups with five copies of the same box style drift apart. They did: the
setup screen had padding the others did not, two screens used different border
colours, and the hint row behaved differently in each. One constant makes that
impossible, and a test asserts every popup carries the class.

# What it costs

* A shared rule can be wrong in five places at once. The compensation is that a
  fix is also right in five places at once - the hint-row bug was fixed once and
  applied everywhere.
* A screen that genuinely needs a different look has to override, which is
  visible in that screen's CSS. That friction is intentional.
* `tui.py` grows. If the screens are ever split into `roan/screens/`, `POPUP_CSS`
  moves to its own module and every screen imports it.

# The rules it encodes

See [design system](../concepts/design-system.md) for the building blocks and the
four bugs this decision exists to prevent.
