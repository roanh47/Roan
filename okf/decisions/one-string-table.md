---
type: Decision
title: One string table for two languages
description: Every user-visible string lives in one dictionary, keyed identically in Dutch and English.
tags: [roan, decision, i18n]
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

# Decision

`roan/i18n.py` holds `STRINGS["nl"]` and `STRINGS["en"]` with identical key sets.
`t("key")` looks up the active language and falls back to English. The agent's
system prompt follows the same setting.

# Why

* **The language is the user's, not the program's.** A Dutch UI that answers in
  English is worse than either. `set_language()` therefore reaches the agent too.
* **One file means one edit.** Splitting per-feature translation files makes it
  easy to add a string and forget the other language.
* **A test can then be exact.** Key-set equality is checkable; "did you remember
  Polish" is not.

# What it costs

* `i18n.py` is 543 lines and holds three unrelated things: the string table, the
  default instructions, and the provider descriptions. If it grows past ~700
  lines, split the instructions out into markdown files.
* Translators would need to edit Python. With two languages maintained by the
  same person, that is fine.

# The trap

A duplicate key in a Python dict literal keeps the last value and raises nothing.
A stray block of English values once landed in the Dutch block, silently
overwriting 30 Dutch strings, while English rendered raw key names. The test now
checks for duplicates as well as for parity. Never "fix" the table by hand
without running it.
