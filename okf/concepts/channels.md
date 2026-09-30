---
type: Concept
title: Channels
description: The Telegram front-end: per-chat agents, HTML escaping, and message splitting.
tags: [roan, telegram, channels]
status: stable
generated: { by: hermes-agent/deepseek-v4.1-flash, at: 2026-09-30T08:12:52Z }
verified: { by: process:pytest, at: 2026-09-30T08:12:52Z }
sources:
  - id: telegram
    resource: ../../roan/channels/telegram.py
    title: ../../roan/channels/telegram.py
  - id: base
    resource: ../../roan/channels/base.py
    title: ../../roan/channels/base.py
  - id: telegram-tests
    resource: ../../tests/test_telegram.py
    title: ../../tests/test_telegram.py
---

# One front-end, one agent per chat

`roan/channels/` holds front-ends that are not the TUI. The only implemented one
is Telegram, started with `Roan telegram`. Every other interface - the TUI, the
`chat` REPL, Telegram - drives the same `Agent` class; nothing about the agent is
UI-specific.

# Token

`ROAN_TELEGRAM_TOKEN`, or `telegram_token` in `config.json`. The env var wins,
because `load_config()` applies env overrides last. Without a token the channel
exits with a message telling you where to put one.

# Per-chat state

Sessions are keyed by chat id, so two chats are two conversations. `parse_update()`
turns a Telegram update into `(chat_id, text, message_id)`.

# Robustness that matters

* **Splitting.** `split_message(text, limit)` cuts long answers on the 4096-char
  Telegram limit, preferring a newline or space boundary instead of mid-word.
* **Escaping.** `escape()` escapes HTML before `parse_mode: "HTML"`, so a model
  that emits `<` or `&` does not break the message. On a send failure the code
  retries **without** `parse_mode`, so a formatting bug degrades instead of
  dropping the message.
* **Commands.** `handle_command(text, agent, reset_fn)` handles `/new`, `/clear`
  and friends inside the chat before the text reaches the model.

# Testing

`tests/test_telegram.py` tests the pure functions - splitting, escaping, update
parsing, command handling - without touching the network. Keep it that way: the
HTTP client is one thin class, and the logic lives in functions beside it.
