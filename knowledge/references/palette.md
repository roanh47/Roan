---
type: Reference
title: Palette
description: The exact Catppuccin values Roan uses, per flavour.
tags: [roan, reference, colour, catppuccin]
status: stable
generated: { by: hermes-agent/deepseek-v4.1-flash, at: 2026-09-30T08:12:52Z }
verified: { by: process:pytest, at: 2026-09-30T08:12:52Z }
sources:
  - id: themes
    resource: ../../roan/themes.py
    title: ../../roan/themes.py
  - id: palette
    resource: https://catppuccin.com/palette
    title: Catppuccin palette
---

# Per flavour

| Role | latte | frappe | macchiato | mocha |
|---|---|---|---|---|
| background (mantle) | `#E6E9EF`* | `#292C3C`* | `#1E2030`* | `#181825` |
| surface | `#E6E9EF` | `#414559` | `#363A4F` | `#313244` |
| panel (surface1) | `#BCC0CC` | `#51576D` | `#494D64` | `#45475A` |
| border (lavender) | `#7287FD` | `#BABBF1` | `#B7BDF8` | `#B4BEFE` |
| accent (pink) | `#EA76CB` | `#F4B8E4` | `#F5BDE6` | `#F5C2E7` |
| text on pink | `#4C4F69` | `#232634` | `#181926` | `#11111B` |
| text | `#4C4F69` | `#C6D0F5` | `#CAD3F5` | `#CDD6F4` |

*The three backgrounds come from Textual's built-in Catppuccin themes; check
`roan/themes.py` and `BUILTIN_THEMES` for the exact current values rather than
trusting this table blindly.

# Where each value is used

* **background** - `Screen`, so the whole app.
* **surface** - the popup box, and the OptionList background.
* **panel** - inputs, buttons, selects, the `#status` bar.
* **border** - the single round frame on a popup.
* **accent** - selection bars, the primary button, focus, the status bullet, the
  title text.
* **text on pink** - the foreground whenever the background is the accent, so a
  selected row is readable in all four flavours, including the light one.

# The rule

Three surface steps, one accent, one border colour. If a fourth background step
is needed, that is a design decision, not a variable to invent.
