---
type: Howto
title: Add a language string
description: Add a key to both language blocks in one edit, and keep it short enough for a phone.
tags: [roan, howto, i18n]
status: stable
generated: { by: hermes-agent/deepseek-v4.1-flash, at: 2026-09-30T08:12:52Z }
verified: { by: process:pytest, at: 2026-09-30T08:12:52Z }
sources:
  - id: i18n
    resource: i18n.py
    title: roan/i18n.py
  - id: i18n-tests
    resource: ../tests/test_i18n.py
    title: tests/test_i18n.py
---

# The edit

`roan/i18n.py` has a `STRINGS` dict with a `nl` block and an `en` block. Add the
key to **both**, in the same change:

    "msg_mything": "Mijn ding gedaan",        # nl
    "msg_mything": "My thing is done",        # en

Then use it: `t("msg_mything")`.

# Why both, always

`t()` falls back to English, so a missing Dutch key looks fine on an English
machine and shows the English text in Dutch. Worse, a duplicate key silently keeps
the last value - a stray English block inside the Dutch block once overwrote 30
Dutch strings while English was missing those keys entirely. The test suite checks
both properties:

    python3 -m pytest tests/test_i18n.py -q

# Length

Strings must fit a **46-column phone**, the narrowest supported terminal. Rough
budget: 38 characters for a field label or a hint, 30 for a button.

* `"API key (empty = keep the current one)"` was too long, became
  `"API key (empty = keep)"`.
* `"Set it up first; then this closes."` keeps the meaning in 36 characters.

If a string genuinely needs more room, restructure the popup instead of letting
it clip.

# Placeholders

`t()` runs `.format(**kwargs)` on the value, so `{name}` placeholders work:

    t("models_hint", n=12)

Literal braces in a translated string are format fields, so escape them as `{{`
and `}}`.
