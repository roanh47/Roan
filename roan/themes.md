---
type: Concept
title: Themes
description: The four official Catppuccin flavours, each with its own pink as the single accent colour.
tags: [roan, themes, catppuccin, colour]
status: stable
generated: { by: hermes-agent/deepseek-v4.1-flash, at: 2026-09-30T08:12:52Z }
verified: { by: process:pytest, at: 2026-09-30T08:12:52Z }
sources:
  - id: themes
    resource: themes.py
    title: roan/themes.py
  - id: palette
    resource: https://catppuccin.com/palette
    title: Catppuccin palette
---

# The four flavours

Textual ships complete Catppuccin themes (`catppuccin-latte`,
`catppuccin-frappe`, `catppuccin-macchiato`, `catppuccin-mocha`). Roan **clones
them** and overrides only what has to be pink. That is why no stray blue or green
can appear: every colour Roan does not touch comes from the official palette.

`roan/themes.py` builds each one from `BUILTIN_THEMES["catppuccin-<flavour>"]` and
registers it under the plain name, so `/theme mocha` works.

| Flavour | Background | Surface | Pink (accent) | Lavender (border) |
|---|---|---|---|---|
| latte | `#EFF1F5` | `#E6E9EF` | `#EA76CB` | `#7287FD` |
| frappe | `#303446` | `#414559` | `#F4B8E4` | `#BABBF1` |
| macchiato | `#24273A` | `#363A4F` | `#F5BDE6` | `#B7BDF8` |
| mocha (default) | `#181825` | `#313244` | `#F5C2E7` | `#B4BEFE` |

Note the background: Textual's Catppuccin uses *mantle*, one step below base.
That is intentional, and it is what makes the `$surface` popup read as a raised
panel.

# What gets overridden

Every override exists to make pink the only accent:

    primary, accent                     -> the flavour's pink
    border, border-blurred              -> the flavour's lavender, or its panel
    button-color-foreground             -> ON_PINK (readable text on pink)
    block-cursor-background/foreground  -> pink, with bold text
    block-hover-background              -> SURFACE1
    input-selection-* / input-cursor-*  -> pink
    scrollbar, scrollbar-hover/active   -> SURFACE1, then pink on hover

`block-cursor-*` matters most: Textual's default derives a selection colour that
came out blue-ish, which is exactly the "this is not Catppuccin" complaint. A
selected row in any list is now a pink bar with dark text.

# Switching

* `/theme` opens the picker: the four flavours, each with a bullet in its own
  pink, a filled bullet marking the active one.
* `/theme mocha` sets it directly. An unknown name is rejected and the current
  flavour stays.
* The choice is saved to `config.json` under `theme` and applied on the next
  start.

# The literal-colour escape hatch

Rich markup (`Markdown`, plain `Static`) cannot use Textual's `$accent`. For those
spots `themes.py` exposes:

* `accent_color()` - the pink of the currently active flavour.
* `set_current(name)` - called by the app whenever the theme changes, so the
  literal colour follows the theme.

Use `accent_color()` in f-strings, never a hardcoded hex.
