---
type: Howto
title: Add a provider
description: Three ways to add one: a preset, a local endpoint, or a custom entry in the config.
tags: [roan, howto, providers]
status: stable
generated: { by: hermes-agent/deepseek-v4.1-flash, at: 2026-09-30T08:12:52Z }
verified: { by: process:pytest, at: 2026-09-30T08:12:52Z }
sources:
  - id: models
    resource: ../../roan/models.py
    title: ../../roan/models.py
  - id: config
    resource: ../../roan/config.py
    title: ../../roan/config.py
---

# Decide where it belongs

| The provider is... | Put it in |
|---|---|
| a hosted API with a fixed base URL, used often | `PROVIDER_PRESETS` in `config.py` |
| a server you run on localhost | `LOCAL_ENDPOINTS` in `models.py` |
| something you type once for yourself | the Custom tab, or `add_endpoint()` |

Do not put a localhost server in Free. See [providers](../concepts/providers.md)
for why the categories are separate.

# 1. A preset

    PROVIDER_PRESETS["acme"] = {
        "base_url": "https://api.acme.example/v1",
        "api_key": None,
        "label": "Acme",
    }

`load_config()` and `resolve_base_url()` pick it up automatically. Users pick it
from the Paid tab, or from Free if it is genuinely free - see
[free vs paid](../concepts/free-vs-paid.md).

# 2. A local endpoint

    LOCAL_ENDPOINTS.append(
        ("myserver", "My Server", "http://localhost:9876/v1"),
    )

It appears under Local, needs no key, and counts as configured for
`is_configured()`.

# 3. Custom

Nothing to change in the code:

    add_endpoint("thuis", "https://thuis.example/v1", "sk-...")

or use the Custom tab in the picker, which can add and delete entries and keeps
several.

# After adding

* A free-tier provider also has to be in `FREE_TIER_PROVIDERS`, deliberately.
* Add a description to `PROVIDER_DESCRIPTIONS` in `i18n.py` if the row would
  otherwise be bare - a row is `Name  .  description`.
* Run `python3 -m pytest tests/test_providers.py tests/test_models_free.py -q`.
