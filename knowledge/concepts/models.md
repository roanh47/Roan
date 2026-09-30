---
type: Concept
title: Models
description: Where model metadata comes from, how it is cached, and what the model browser does.
tags: [roan, models, models.dev]
status: stable
generated: { by: hermes-agent/deepseek-v4.1-flash, at: 2026-09-30T08:12:52Z }
verified: { by: process:pytest, at: 2026-09-30T08:12:52Z }
sources:
  - id: models
    resource: ../../roan/models.py
    title: ../../roan/models.py
  - id: agent
    resource: ../../roan/agent.py
    title: ../../roan/agent.py
---

# Where the data comes from

`https://models.dev/api.json` is the single source: roughly 225 providers, each
with an `api` field (the base URL) and a model list. `models.py` wraps it:

| Function | Returns |
|---|---|
| `_dev_data()` | the whole payload, cached for 300s |
| `clear_cache()` | drops that cache - tests call it to stay offline |
| `list_dev()` | every provider |
| `list_providers(category)` | `(id, name)` pairs for `free`, `paid`, `all` |
| `list_local()` | the nine localhost endpoints |
| `provider_meta(provider)` | plan, name, env var, docs link, models |
| `provider_models(provider)` | the model ids of one provider |
| `fetch_provider_models(provider)` | asks the provider itself, as a fallback |

The provider is also asked directly when models.dev does not know it, which is
what makes a custom endpoint or a fresh local server work.

# The model browser

`ModelsScreen` has three tabs - Free, Paid, This provider - plus a provider
dropdown (hidden when the browser was opened for one specific provider) and a
search box. It is opened from the setup screen and from `/models`.

Rows are `model  .  provider`, capped at 400 with a "... and N more" line, since
some providers list hundreds. The hint line shows the count for the current
filter. Selecting is Enter on the highlighted row, clicking a row, or the **Kies**
button; **Terug** and the close button both cancel.

# The model in the config

`config["model"]` is a plain string. The default `"local-model"` is a
**placeholder**, not a model: `config.is_configured()` treats it as "nothing
chosen yet", so the mandatory setup keeps firing until a real model is set. Do
not use it as a real default anywhere else.

# Changing the model at runtime

`/model <name>` sets it directly; `/model` with no argument prints the current
one. `Agent.reload()` re-reads the config and rebuilds the client, so a change
takes effect on the next message without a restart.
