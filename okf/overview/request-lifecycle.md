---
type: Overview
title: Request lifecycle
description: What happens between typing a message and seeing the answer, end to end.
tags: [roan, architecture, flow]
status: stable
generated: { by: hermes-agent/deepseek-v4.1-flash, at: 2026-09-30T08:12:52Z }
verified: { by: process:pytest, at: 2026-09-30T08:12:52Z }
sources:
  - id: tui
    resource: ../../roan/tui.py
    title: ../../roan/tui.py
  - id: agent
    resource: ../../roan/agent.py
    title: ../../roan/agent.py
  - id: tools
    resource: ../../roan/tools.py
    title: ../../roan/tools.py
---

# From Enter to answer

    user types, presses Enter
      -> HistoryInput.Submitted -> RoanApp._run_command() or the agent
      -> the user line is mounted in #messages
      -> agent.send_stream(text, on_event) runs in a worker thread
           -> the system prompt is built (instructions, profile, skills, memory)
           -> the request goes to the provider over the OpenAI SDK
           -> text deltas arrive    -> on_event -> widgets mount as they come
           -> tool calls arrive     -> on_event -> the tool runs, result is shown
           -> the loop repeats until the model answers without tool calls
      -> the session is saved to ~/.Roan/sessions/<id>.json
      -> #status is refreshed

# Slash commands

A line starting with `/` goes to `commands.py` first, not to the model:

    _run_command(raw) -> registry lookup -> handler -> True
                      -> unknown or not a command -> False -> the agent

So a typo like `/provder` never reaches the model; it prints the unknown-command
message with a hint. That is deliberate: a silently swallowed slash command is
confusing, and a model that "helpfully" answers a typo of a command is worse.

# Streaming and the UI

The agent never touches widgets. It emits events:

    {"type": "tool_call",   "name": ..., "arguments": ...}
    {"type": "tool_result", "name": ..., "result": ...}

The TUI turns those into a `ToolResult` widget - collapsed by default, click to
expand, with a `(+N regels)` count when collapsed. Text deltas are appended to the
assistant message widget.

# Auto-follow

If the view is at the bottom, new content scrolls it along. If the user scrolled
up, it does not, and `#jump` shows the number of waiting lines; clicking it
scrolls to the bottom. This is the difference between a chat that fights you and
one that does not.

# Failure

An error from the provider becomes a system line in the chat (`msg_error` /
`msg_aborted`), not a crash and not a stack trace in the message area. Ctrl+C
while streaming aborts the request and leaves the session usable.
