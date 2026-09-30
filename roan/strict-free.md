---
type: Decision
title: When in doubt a provider is paid
description: Free is an allow-list, not a heuristic, because a wrong free claim is a broken promise.
tags: [roan, decision, providers]
status: stable
generated: { by: hermes-agent/deepseek-v4.1-flash, at: 2026-09-30T08:12:52Z }
verified: { by: process:pytest, at: 2026-09-30T08:12:52Z }
sources:
  - id: models
    resource: models.py
    title: roan/models.py
  - id: free-tests
    resource: ../tests/test_models_free.py
    title: tests/test_models_free.py
---

# Decision

A provider appears under Free only if its entire catalogue is free with no
subscription, and that has to be stated in `FREE_TIER_PROVIDERS`. Per-model free
variants are honoured only for the three aggregators that sell them as a product.

# Why

The Free tab is a promise: "you can use this without paying". A provider that
turns out to need a credit card is a broken promise, and it is the kind of broken
promise that makes someone stop trusting the whole list. A paid provider that is
actually free is a mild annoyance; the reverse is not.

The trigger was concrete: a subscription plan with `cost: 0` per model ended up
under Free, and the user noticed immediately ("Alibaba coding plan is 20 per
month").

# What it costs

Free is a short list - nine providers - and it needs manual review when a
provider changes its pricing. That is the point: a short honest list beats a long
list with wrong entries.

# The rule in code

    free  = provider in FREE_TIER_PROVIDERS
    free |= provider in {"openrouter", "opencode", "opencode-go"}
            and model ends with ":free" or "-free"
    free |= provider in {"zai", "z-ai"} and "flash" in model
    otherwise: paid

See [free vs paid](free-vs-paid.md) for the full reasoning and the
providers that are excluded by name.
