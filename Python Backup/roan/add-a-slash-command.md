---
type: Howto
title: Add a slash command
description: From the registry to the TUI handler, with the i18n keys and the tests.
tags: [roan, howto, commands]
status: stable
generated: { by: hermes-agent/deepseek-v4.1-flash, at: 2026-09-30T08:12:52Z }
verified: { by: process:pytest, at: 2026-09-30T08:12:52Z }
sources:
  - id: commands
    resource: commands.py
    title: roan/commands.py
  - id: tui
    resource: tui.py
    title: roan/tui.py
  - id: i18n
    resource: i18n.py
    title: roan/i18n.py
---

# 1. Register it

`roan/commands.py` holds the registry:

    COMMANDS: dict[str, Command] = {
        "help": Command(help="cmd_help", handler=...),
        ...
    }

`names()` returns the sorted keys. Adding a name here makes `/name` recognisable
immediately - which also means it no longer reaches the model, so a registered
command must have a handler.

# 2. Implement it

Commands that need the chat live in `RoanApp` as `_cmd_<name>(args)`:

    def _cmd_mything(self, args) -> None:
        self._sysline(t("msg_mything"))

and are wired in the TUI dispatch:

    if name == "mything":
        self._cmd_mything(args)
        return True

Commands that are pure config changes can be handled in `commands.py` instead,
which is what the non-TUI front-ends use.

# 3. Language strings

Add `cmd_mything` and any message keys to **both** blocks in `i18n.py`. The help
text is generated from the same table, so `/help` picks it up for free.

# 4. Tests

* A test that the command is in `names()`.
* A test for the handler's effect (config written, screen pushed, line printed).
* If it opens something, a test that it closes again.

Run `python3 -m pytest tests/test_i18n.py -q` first - missing keys fail there.

# Cautions

* Do **not** add a `cron` command: cron is a separate long-running process and a
  test asserts the name stays out of the registry. See [cron](cron.md).
* Anything user-visible goes through `t()`. No inline text.
* If the command changes the renderer or the theme, save the choice to the config
  so it survives a restart.
