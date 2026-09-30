---
type: Decision
title: Pink is the only accent
description: One accent colour - that flavour's Catppuccin pink - and a fixed palette underneath it.
tags: [roan, decision, design, colour]
status: stable
generated: { by: hermes-agent/deepseek-v4.1-flash, at: 2026-09-30T08:12:52Z }
verified: { by: process:pytest, at: 2026-09-30T08:12:52Z }
sources:
  - id: themes
    resource: ../../roan/themes.py
    title: ../../roan/themes.py
  - id: themes-tests
    resource: ../../tests/test_themes.py
    title: ../../tests/test_themes.py
---

# Decision

Every theme uses its flavour's pink as `primary` and `accent`, and nothing else
introduces a second accent colour. Borders are the flavour's lavender; everything
else comes from the official Catppuccin palette.

| Flavour | Pink |
|---|---|
| latte | `#EA76CB` |
| frappe | `#F4B8E4` |
| macchiato | `#F5BDE6` |
| mocha | `#F5C2E7` |

# Why

An accent colour is a promise about what "this is important" looks like. Two
accent colours means the user has to relearn which is which. A fixed pink also
means a screenshot of the app is recognisable, and it is a decision the user can
make once instead of per theme.

The migration path matters too: an earlier accent was a self-chosen `#FF2E88`,
which was bright but not Catppuccin, and the complaint was "this is not
Catppuccin pink". Deriving the accent from the palette per flavour fixed the
colour and kept the "always pink" rule intact.

# What it costs

* In latte (a light theme) pink-on-light has less contrast than a dark accent
  would. The selection foreground is the flavour's text colour to compensate.
* A user who hates pink cannot change it. That is accepted: it is one of the few
  fixed points in the design.

# How it is enforced

`tests/test_themes.py` asserts `theme.primary == theme.accent == PINK[flavour]`
for all four flavours. If someone adds a theme, that test tells them.

# The trap that caused the worst bug here

Textual's default `block-cursor-background` derives a bluish selection colour.
Lists were therefore highlighted in a colour that had nothing to do with the
theme, which read as "this is not Catppuccin". All `block-cursor-*`,
`input-selection-*`, `input-cursor-*` and scrollbar variables are now set
explicitly. If a new widget shows a colour you did not choose, look for another
unset theme variable.
