---
type: Concept
title: Providers
description: Four categories - free, paid, local, custom - and how a base URL and key are resolved for each.
tags: [roan, providers]
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
  - id: provider-tests
    resource: ../../tests/test_providers.py
    title: ../../tests/test_providers.py
---

# Four categories

The picker has four tabs, and the split is a promise, not a filter:

| Tab | What it means | Source |
|---|---|---|
| **Free** | the whole catalogue is usable without paying | filtered `models.dev` |
| **Paid** | everything else | the rest of `models.dev` |
| **Local** | a server on your own machine, on its well-known port | a hardcoded list of 9 |
| **Custom** | your own saved endpoints, as many as you like | `config["endpoints"]` |

Local is deliberately **not** under Free. "Free" means "no money", "local" means
"runs here"; conflating them was a correction from the user.

# The nine local endpoints

    lmstudio                LM Studio               http://localhost:1234/v1
    ollama                  Ollama                  http://localhost:11434/v1
    llamacpp                llama.cpp               http://localhost:8080/v1
    vllm                    vLLM                    http://localhost:8000/v1
    localai                 LocalAI                 http://localhost:8080/v1
    jan                     Jan                     http://localhost:1337/v1
    koboldcpp               KoboldCpp               http://localhost:5001/v1
    text-generation-webui   text-generation-webui   http://localhost:5000/v1
    gpt4all                 GPT4All                 http://localhost:4891/v1

Ports are the upstream defaults. A local endpoint never needs an API key, which
is also how `is_configured()` knows a setup is complete.

# Resolving a base URL

`resolve_base_url(provider)` checks, in order:

1. `PROVIDER_PRESETS` - the ten hand-written presets (`lmstudio`, `ollama`,
   `groq`, `openrouter`, `gemini`, `deepseek`, `cerebras`, `together`, `mistral`,
   `custom`).
2. `list_local()` - the nine localhost entries.
3. The `api` field of that provider in `models.dev`.

So for most hosted providers, choosing one is enough and the URL fills itself in.
The setup screen only shows the base-URL field when the provider is `custom` or
still empty.

Watch out: `save_config` normalises `base_url` from the preset when the provider
is a known one, so a manually passed URL for provider `groq` is overwritten by
Groq's own. That is intended, but surprising in tests.

# Custom endpoints

Stored as a list in `config.json`, managed with `add_endpoint(name, base_url,
api_key)`, `get_endpoint(name)`, `get_endpoints()` and `remove_endpoint(name)`.
The tab lists them by name and URL, and shows an add form and a delete button
only on that tab.

    "endpoints": [
      {"name": "thuis", "base_url": "https://thuis.example/v1", "api_key": "..."}
    ]

Custom endpoints are deliberately **not cached** in the picker, so a newly added
one appears immediately. Free and paid are cached, because building those rows
costs a provider lookup each and there are hundreds of them.

# Searching

Every provider list has a search box: live, case-insensitive, matching the id and
the display label. `Enter` picks the top hit; `Esc` clears the search before it
closes the popup. The search stays inside the active tab, which is what makes the
result predictable.

# What a row shows

`Name  .  description`, where the description is a short human line or a model
count (`121 modellen`). A plan provider is marked with `!` and a note. The
provider id, env var and docs link appear in the info line under the list, not in
the row: the rows used to show the raw id and that was noise.
