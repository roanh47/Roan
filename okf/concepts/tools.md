---
type: Concept
title: Tools
description: The eleven tools the model may call, and how tool results are shown.
tags: [roan, tools, agent]
status: stable
generated: { by: hermes-agent/deepseek-v4.1-flash, at: 2026-09-30T08:12:52Z }
verified: { by: process:pytest, at: 2026-09-30T08:12:52Z }
sources:
  - id: tools
    resource: ../../roan/tools.py
    title: ../../roan/tools.py
  - id: agent
    resource: ../../roan/agent.py
    title: ../../roan/agent.py
---

# The set

Defined as OpenAI-style function schemas in `agent.py`, implemented in `tools.py`:

| Tool | What it does |
|---|---|
| `run_shell` | run a shell command and return stdout/stderr |
| `read_file` | read a file, with an offset and limit |
| `write_file` | write a whole file |
| `edit_file` | targeted find-and-replace in a file |
| `list_files` | list a directory |
| `glob_files` | find files by pattern |
| `fetch_url` | fetch a URL and return it as text |
| `web_search` | search the web |
| `todo_write` | keep a task list for multi-step work |
| `read_skill` | pull the body of a skill into context (see [skills](skills-memory-profile.md)) |
| `remember` | write a durable note to `memory.md` |

Eleven tools is deliberately small. Every tool costs prompt tokens on every
request, so a new tool has to earn its place.

# The loop

`Agent.send()` (non-streaming) and `Agent.send_stream()` (streaming) both:

1. Send the message history plus the tool schemas.
2. Collect tool calls - streaming accumulates partial argument JSON per index.
3. Emit `{"type": "tool_call", ...}` and `{"type": "tool_result", ...}` events
   through `on_event`.
4. Execute each call, append the result as a `tool` message.
5. Loop until the model answers without tool calls.

`tool_summary(name, args)` renders the one-line label shown in the UI, and a tool
result is a clickable widget that expands when a tool produced more than a few
lines.

# MCP tools

Tools from configured MCP servers are added to the same list at start-up. See
[MCP](mcp.md).
