---
type: Reference
title: Pitfalls
description: Bugs that already happened once, with the cause and the fix, so they do not happen twice.
tags: [roan, reference, pitfalls, bugs]
status: stable
generated: { by: hermes-agent/deepseek-v4.1-flash, at: 2026-09-30T08:12:52Z }
verified: { by: process:pytest, at: 2026-09-30T08:12:52Z }
sources:
  - id: tests
    resource: tests
    title: tests
---

# Rendering and layout

**A modal's background defaults to semi-transparent.** Textual's `ModalScreen`
uses the background at 60% alpha, which over a black terminal looks black. That
was the "everything is black, this is not Catppuccin" report. Fix: set the screen
background opaque and dim only the backdrop behind a modal.

**Every Textual widget has a border by default.** `Select`, `OptionList`, `Input`
and `Button` all draw one, so a popup ended up with a frame around every element.
Fix: one frame per popup, `border: none` on the rest.

**Removing all the borders makes a screen look empty.** The opposite complaint
arrived the next day. The answer is not borders but three surface levels plus one
frame per popup.

**An unset height on a `Horizontal` can resolve to `1fr`.** Two blank rows
appeared around the provider category tabs because of it. Every row container now
states its height.

**A title with `padding: 0 2` inside a box that already pads `1 2` is indented
twice.** The title must line up with the field labels.

**A hidden field still occupies space unless it is `display = False`.** The base
URL field is always composed and hidden with `display`, so `_save()` and the tests
can still query it.

# Data and configuration

**`models.dev` reports `cost: 0` for subscription plans and for gateway
resellers.** Filtering on it put 76 providers under Free, most of them wrong. See
[free vs paid](roan/free-vs-paid.md).

**`load_config()` rewrites a known provider's `base_url` from its preset.** A test
that saves `base_url: http://localhost:1234/v1` with provider `groq` gets Groq's
URL back. Use `provider: "custom"` or the matching preset in tests.

**`has_config()` is not `is_configured()`.** The config file exists after any
write, including a theme change, so keying the mandatory setup off it let an
unconfigured user into a broken app.

**An uncached `_dev_data()` makes an HTTP request per lookup.** Building the
provider list for 225 providers took 225 requests. The 300-second cache is not an
optimisation, it is a requirement.

**Caching the custom endpoint list hides a new entry.** A just-added endpoint did
not appear until the popup was reopened. Only free and paid are cached now.

# Screen width

**A `1fr` hint next to buttons pushes the buttons off screen.** The save button
ended up at column 69 on a 62-column terminal. The hint gets its own row.

**Long strings clip on a phone.** The narrowest supported terminal is 46 columns,
so a label has about 38 characters. Shorten the string or restructure the popup -
never let it clip silently.

**`margin-top` on every section overflows an 18-row screen.** The setup form grew
past the bottom. Spacing comes from the title bar and the hint/actions margins
only.

# Code and tests

**A duplicate key in a Python dict keeps the last value, silently.** Thirty Dutch
strings were overwritten by a stray English block; English rendered raw key names.
The i18n test now checks for duplicates as well as parity.

**Two functions with the same name in one module: the last one wins.** An old
`provider_models()` silently replaced the new one and reintroduced the `cost: 0`
bug. Grep before adding a function to a file that already has one.

**A test that writes into the real `~/.Roan` leaks state.** It happened with a
skills file. Use the `roan_cfg` / `tmp_roan` fixtures; they monkeypatch every path.

**`pip install -r requirements.txt` overwrites a ROCm install with the CPU build
of torch.** Not a Roan bug, but it is the kind of thing that ruins an evening -
check which torch is installed after any requirements install on the AMD machine.

# Editing this repository

**A scripted slice edit can delete far more than intended.** Deriving an end index
from the wrong anchor once cut 374 lines out of `tui.py` instead of 56. Always
check `git diff --stat` and the list of removed `def`s after a bulk edit, and
restore from git rather than patching forward.
