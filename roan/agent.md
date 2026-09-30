---
type: Concept
title: Agent
description: The model loop: streaming, tool calls, the system prompt and reload.
tags: [roan, agent, core]
status: stable
generated: { by: hermes-agent/deepseek-v4.1-flash, at: 2026-09-30T08:12:52Z }
verified: { by: process:pytest, at: 2026-09-30T08:12:52Z }
sources:
  - id: agent
    resource: agent.py
    title: roan/agent.py
  - id: agent-tests
    resource: ../tests/test_agent.py
    title: tests/test_agent.py
---

# Responsibilities

`Agent` is the only thing that talks to a model. Everything else - TUI, REPL,
Telegram, cron - holds one and calls it.

* **The system prompt** - built from instructions, user profile, skills and
  memory. See [skills, memory and profile](skills-memory-profile.md).
* **The loop** - send, collect tool calls, run them, append results, repeat.
* **Streaming** - `send_stream()` yields text deltas and emits `tool_call` /
  `tool_result` events through `on_event`.
* **Session state** - `messages`, `session_id`, `save()`, `clear()`.
* **Compaction** - `compact()`.
* **Language** - `set_language()` / `language()`, so the prompt follows the UI.
* **Reload** - `reload()` re-reads the config and rebuilds the OpenAI client,
  which is how a model or key change takes effect without a restart.

# The client

The OpenAI Python SDK against an OpenAI-compatible base URL, with `base_url` and
`api_key` from the config. That is the whole compatibility story: any server
speaking the OpenAI chat-completions API works - a hosted provider, a local
llama.cpp, or a custom endpoint.

`stop()` shuts the client and any MCP servers down.

# Threading

The TUI runs the agent in a Textual worker thread and communicates through
`on_event` callbacks. The agent itself does no threading; that is the caller's
job. This is why the TUI never blocks while a model is thinking.
