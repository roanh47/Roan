---
type: Concept
title: Skills, memory and profile
description: The three files that shape the system prompt besides the instructions.
tags: [roan, skills, memory, prompt]
status: stable
generated: { by: hermes-agent/deepseek-v4.1-flash, at: 2026-09-30T08:12:52Z }
verified: { by: process:pytest, at: 2026-09-30T08:12:52Z }
sources:
  - id: agent
    resource: agent.py
    title: roan/agent.py
  - id: skills
    resource: skills.py
    title: roan/skills.py
  - id: memory
    resource: memory.py
    title: roan/memory.py
---

# The system prompt

`Agent._build_system_prompt()` assembles, in order:

1. **Instructions** - `instructions.md` if present, otherwise
   `i18n.DEFAULT_INSTRUCTIONS`. The default tells the model it is Roan, a harness
   built to mirror Roan Heemstra, and how to behave.
2. **User profile** - `home.read_profile()`, comment lines stripped, empty means
   omitted.
3. **Skills** - `skills.skills_prompt()`: name and description only, never the
   body.
4. **Memory** - `memory.load_memory()`.

That order matters: identity first, then facts about the user, then capabilities,
then notes.

# Skills

A skill is a markdown file in `~/.Roan/skills/` with YAML frontmatter:

    ---
    name: deploy-check
    description: Check whether a deploy went out cleanly.
    ---
    Steps ...

* `skills.skills_list_text()` powers `/skills`.
* `skills.skills_prompt()` puts `name: description` of every skill in the prompt,
  which is cheap.
* `skills.get_skill(name)` reads the body, and the model asks for it through the
  **`read_skill`** tool. Only when it is needed does the body cost tokens.

This mirrors the bigger harnesses: advertise the index, load on demand.

# Memory

`~/.Roan/memory.md`, written by the model through the **`remember`** tool and
read by `memory.load_memory()`. Comment lines starting with `#` are ignored, so
the file can carry its own header without that header entering the prompt.

`/memory` shows what is in it. Memory is for durable facts that apply to every
session; anything task-specific belongs in the conversation, not here.

# Profile

`~/.Roan/user.md` is hand-written: who the user is, what they work on, how they
want to be talked to. It is the highest-leverage file in the home directory and
the setup does not write it for you.
