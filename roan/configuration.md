---
type: Concept
title: Configuration
description: The ~/.Roan home, every config key, the env overrides, and what counts as configured.
tags: [roan, config, home]
status: stable
generated: { by: hermes-agent/deepseek-v4.1-flash, at: 2026-09-30T08:12:52Z }
verified: { by: process:pytest, at: 2026-09-30T08:12:52Z }
sources:
  - id: config
    resource: config.py
    title: roan/config.py
  - id: home
    resource: home.py
    title: roan/home.py
  - id: home-tests
    resource: ../tests/test_home.py
    title: tests/test_home.py
---

# The home directory

    ~/.Roan/                (capital R; a lowercase ~/.roan is migrated once)
      config.json           settings
      instructions.md       replaces the default system prompt
      user.md               who the user is; goes into the system prompt
      memory.md             durable notes (the remember tool)
      skills/               *.md skills, name + description go into the prompt
      cron/jobs.json        scheduled prompts
      plugins/              your own python plugins
      sessions/             one json per conversation
      logs/                 roan.log
      cache/                scratch files
      plans/                markdown plans

`home.ensure_home()` creates all of it and is called by `cli.main()` before
anything else, so every entry point starts from a complete home.

`home.layout()` powers `Roan home`, which prints the tree and how many items each
directory holds.

Placeholder files (`memory.md`, `user.md`) start as comment-only. `read_profile()`
strips comment lines and treats a comment-only file as empty, which matters
because those files go straight into the system prompt: a template that leaks
into the prompt is worse than no file.

# Paths live in one place

Every path is a module attribute in `config.py`:

    ROAN_DIR, CONFIG_PATH, INSTRUCTIONS_PATH, MEMORY_PATH, USER_PATH,
    SKILLS_DIR, CRON_DIR, PLUGINS_DIR, LOGS_DIR, CACHE_DIR, PLANS_DIR

Tests monkeypatch these attributes to isolate a run. That only works because
`home.py`, `skills.py` and `cron.py` read them through **functions**
(`_dirs()`, `skills_dir()`, `jobs_path()`) instead of binding them at import
time. New code must do the same.

# What counts as configured

Two different questions, and mixing them up caused a bug:

* `has_config()` - is there a config file, or an API key in the environment. True
  as soon as you change anything, including the theme.
* `is_configured()` - can this thing actually chat. True when there is a real
  model **and** either an API key or a localhost base URL.

The mandatory setup keys off `is_configured()`. With `has_config()` a user who
only picked a theme was considered done and got a broken app.

# Env overrides

`load_config()` reads the file, then lets env vars win - and finally normalises
`base_url`/`api_key` from the preset for a known provider. See
[environment variables](env-vars.md).

# Reading and writing

* `load_config()` → the full dict, file + env + preset normalisation.
* `save_config(updates)` → merges into the file. It **normalises** a known
  provider's `base_url`, so passing a custom URL for provider `groq` gets
  overwritten by Groq's own.
* `DEFAULT_CONFIG` is the reference for every key. Never read a key without a
  default; never write a key that is not in there.
