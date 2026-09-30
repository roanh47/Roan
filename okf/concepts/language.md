---
type: Concept
title: Language
description: One string table for Dutch and English, and the rules that keep the two in sync.
tags: [roan, i18n, language]
status: stable
generated: { by: hermes-agent/deepseek-v4.1-flash, at: 2026-09-30T08:12:52Z }
verified: { by: process:pytest, at: 2026-09-30T08:12:52Z }
sources:
  - id: i18n
    resource: ../../roan/i18n.py
    title: ../../roan/i18n.py
  - id: i18n-tests
    resource: ../../tests/test_i18n.py
    title: ../../tests/test_i18n.py
---

# One table

`roan/i18n.py` holds `STRINGS: dict[str, dict[str, str]]` with exactly two keys,
`nl` and `en`. `t("key")` looks up the active language and **falls back to
English** when the key is missing there.

    t("setup_title")                       # "Setup"
    t("setup_saved", model="x", provider="y")   # .format() on the value

Every user-visible string goes through `t()`. There is no inline Dutch or English
in the TUI - a test compares the two key sets, and that test is the only reason
the two languages have stayed aligned.

# The parity rule

There are 122 keys, and both languages must have the **same ones**. `tests/test_i18n.py` asserts:

* the key sets are equal;
* there are no duplicate keys inside a language block.

The duplicate check exists because a Python dict literal silently keeps the last
value. A stray block of 30 English values once landed inside the Dutch block,
overwriting the Dutch text, while English was missing those keys and rendered
raw key names. Dict literals do not complain; the test does.

# Switching

* `/language nl` or `/language en` sets it for the session **and** saves it to
  `config.json`; `/language` with no argument lists the options.
* `init_from_config()` runs at startup and applies `config["language"]`.
* `ROAN_LANGUAGE` overrides the file.
* `set_language()` is also called on the agent, so the **system prompt** is
  written in the chosen language. The language is not just the UI.

# Adding a string

Add it to **both** blocks in the same edit, then run the i18n test. Keep Dutch
and English the same length class: strings have to fit a 46-column phone, and
"API key (empty = keep the current one)" did not. See
[add a language string](../guides/add-a-language-string.md).
