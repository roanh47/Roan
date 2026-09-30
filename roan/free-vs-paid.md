---
type: Concept
title: Free vs paid classification
description: How Roan decides a provider is free, and why models.dev's cost field cannot be trusted.
tags: [roan, providers, free, models.dev]
status: stable
stale_after: 2027-03-31T00:00:00Z
generated: { by: hermes-agent/deepseek-v4.1-flash, at: 2026-09-30T08:12:52Z }
verified: { by: process:pytest, at: 2026-09-30T08:12:52Z }
sources:
  - id: models
    resource: models.py
    title: roan/models.py
  - id: free-tests
    resource: ../tests/test_models_free.py
    title: tests/test_models_free.py
  - id: models-dev
    resource: https://models.dev/api.json
    title: models.dev API
---

# The trap

`models.dev` has no "is this free" field. It has `cost` per model, and a lot of
models report `cost: 0` for reasons that have nothing to do with being free:

* **Subscription plans.** Alibaba's coding plan, Z.AI's plan, MiniMax's plan and
  about ten others report `cost: 0` because you pay a monthly fee instead of per
  token. The user found this one: "Alibaba coding plan is 20 per month".
* **Gateways.** bothub, kenari, unorouter and kilo resell other providers' models
  and paste a `:free` suffix on everything, including models that are not.
* **One lucky preview model.** Cohere, Google and Groq each had exactly one
  `cost: 0` preview model, which put the whole provider under Free.

The first version filtered on `cost == 0` and Free had 76 providers, most of them
wrong.

# The rules

`is_free_model(provider, model)` is true in exactly two cases:

1. **The provider is a genuine free tier**: its whole catalogue is free with no
   subscription. That is the explicit allow-list `FREE_TIER_PROVIDERS`:
   `cerebras`, `chutes`, `cloudflare-workers-ai`, `google`, `groq`,
   `huggingface`, `mistral`, `modelscope`, `nvidia`.
2. **Per-model free**, only for the aggregators where a free variant is a real
   product: `openrouter`, `opencode`, `opencode-go`. There the model id must end
   with `:free` or `-free`.

Plus one narrow exception: `COST_ZERO_FREE_PROVIDERS` is `{"zai", "z-ai"}`, where
a model whose id contains `flash` counts as free.

Everything else is paid. When in doubt: **paid**. A provider wrongly listed as
paid is a small annoyance; a provider wrongly listed as free is a broken promise.

# Providers that must stay out of Free

The gateways (`bothub`, `kenari`, `unorouter`, `kilo`) and any provider whose
free claim rests on a single model (`cohere`, Google's Lyria, Groq's allam) are
removed from Free by name. If one of them starts offering a real free tier, add
it to `FREE_TIER_PROVIDERS` deliberately, not by relaxing the rule.

# Keeping it honest

* `is_plan_provider(provider)` marks the subscription plans so the UI can label
  them.
* `is_free(provider)` is the provider-level question; `is_free_model(provider,
  model)` is the per-model one. The picker uses the first, the model browser the
  second.
* `_dev_data()` caches the models.dev payload for 300 seconds. Never call it in a
  loop without the cache; an uncached version made an HTTP request per lookup.

This is the most volatile part of the project, because it depends on a third
party's data. Re-check it if Free grows a lot.
