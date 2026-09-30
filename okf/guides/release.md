---
type: Howto
title: Release
description: The branch layout, the version, and the checklist before publishing.
tags: [roan, howto, release, git]
status: stable
generated: { by: hermes-agent/deepseek-v4.1-flash, at: 2026-09-30T08:12:52Z }
sources:
  - id: pyproject
    resource: ../../pyproject.toml
    title: ../../pyproject.toml
  - id: workflow
    resource: ../../.github/workflows/publish.yml
    title: ../../.github/workflows/publish.yml
---

# Branches

Two branches, and only two:

| Branch | Meaning | Version |
|---|---|---|
| main | the stable line | 0.2.0 |
| pre-release | everything in progress | 0.2.0rc1 |

Work lands on `pre-release`. `main` only moves when a pre-release has settled.

# Version

`pyproject.toml` holds the version and it is the only place it lives:

    version = "0.2.0rc1"

A release candidate uses the PEP 440 form, so `0.2.0rc1` and not `0.2.0-rc1`.

# Checklist

1. `python3 -m pytest tests/ -q` - all green.
2. Bump `version` in `pyproject.toml`.
3. Update `README.md` if a command, key or behaviour changed.
4. Update this bundle if a rule in it changed - especially
   [free vs paid](../concepts/free-vs-paid.md), which tracks third-party data.
5. Commit and push to `pre-release`.

Commit messages are in Dutch and say what changed and why, including the test
count. That is the house style in this repository.

# Publishing

`.github/workflows/publish.yml` publishes to PyPI with trusted publishing, so no
token is stored in the repo.

The name `roan` on PyPI is taken by an abandoned project. The reclaim goes through
the PEP 541 process (`pypi/support#12480`) and takes months, so an editable
install (`pip install -e .`) is the supported path until then. Do not document
`pip install roan` as if it worked.
