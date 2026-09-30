---
type: Decision
title: Build our own harness, do not fork OpenCode
description: Roan is written from scratch against the same ideas, not derived from another harness's source.
tags: [roan, decision, scope]
status: stable
generated: { by: hermes-agent/deepseek-v4.1-flash, at: 2026-09-30T08:12:52Z }
sources:
  - id: readme
    resource: ../../README.md
    title: ../../README.md
---

# Decision

Roan is an independent implementation. It copies no source from OpenCode, Claude
Code or any other harness.

# Why

* **Licensing and provenance stay clean.** A fork drags in someone else's
  licence, release cadence and review process. This is a personal project that
  may be published.
* **A harness is small enough to own.** The interesting part - the loop, the
  tools, the prompt - is a few hundred lines. Forking a large TypeScript codebase
  to change a button is worse than writing the button.
* **The interface is the thing worth copying, not the code.** The behaviour
  (fullscreen TUI, slash commands, bring-your-own model, skills) is what users
  notice, and that can be reimplemented freely.

# What it costs

* Features exist here because someone built them here, not because upstream did -
  no free upgrades.
* Bugs upstream already fixed have to be found again. The
  [pitfalls](../references/pitfalls.md) list is the mitigation.
* "Like X but" comparisons invite scope creep. When in doubt: is this part of the
  four promises in [what Roan is](../overview/what-is-roan.md)?

# What it does not mean

Studying another harness's interface, reading its docs, and reproducing a UX
decision is fine and encouraged - that is how the fullscreen renderer and the
transcript view were chosen. Copying files is not.
