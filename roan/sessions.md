---
type: Concept
title: Sessions
description: One JSON file per conversation, restore on start, and compaction for long chats.
tags: [roan, sessions, history, compact]
status: stable
generated: { by: hermes-agent/deepseek-v4.1-flash, at: 2026-09-30T08:12:52Z }
verified: { by: process:pytest, at: 2026-09-30T08:12:52Z }
sources:
  - id: agent
    resource: agent.py
    title: roan/agent.py
---

# Storage

`sessions/` holds one JSON file per conversation, named by session id. The id is
generated when a session starts and shown by `/sessions`.

    Agent(session_id=None, restore=True, use_mcp=True)

On construction the agent picks up the newest session (unless `restore=False`),
which is why the TUI comes back to the same conversation after a restart. `/new`
starts a fresh one; `/sessions` lists them.

# The message history

Held in `Agent.messages` as OpenAI-style dicts: `system`, `user`, `assistant`,
`tool`. The TUI renders the same list in the transcript (Ctrl+O), skipping the
system message.

# Compaction

Long conversations eventually cost more than they are worth. `/compact` calls
`Agent.compact()`:

1. Ask the model to summarise the conversation.
2. Replace the old messages with that summary, keeping the system prompt.

`compact(force=False)` refuses when there is nothing worth summarising, and the
TUI prints "nothing to compact" rather than sending a pointless request.

This is the same idea as the bigger harnesses, and it is what keeps a session
usable for hours on a small context window.
