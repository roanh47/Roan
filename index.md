---
okf_version: "0.2"
---

# Roan

Project board: https://github.com/users/roanh47/projects/4 — knowledge bundle

The repository **is** the bundle. This file is its table of contents, and the
concepts live next to the code they describe: the harness in [`roan/`](roan/index.md),
the suite in [`tests/`](tests/index.md), and everything about the project as a
whole here at the root.

The format is [OKF](https://okf.md) v0.2: markdown with YAML frontmatter. Every
concept declares a `type`; `index.md` and `log.md` are reserved filenames.
Nothing else is required, so any agent or editor can read it as-is.

Source of truth is the code. Where a claim is enforced by the suite, the concept
says so.

    python3 tests/validate_okf.py            # conformance + link check
    python3 tests/generate_file_map.py       # regenerate the file map

## Start here

* [README](README.md) - the front door: install, configure, run.
* [What Roan is](what-is-roan.md) - the project in one page: the goal, what it promises, what it refuses to be.
* [Architecture](architecture.md) - every module, what it owns and which way the dependencies point.
* [Request lifecycle](request-lifecycle.md) - what happens between pressing Enter and seeing an answer.
* [Glossary](glossary.md) - the words this project uses in a specific way.

## The harness

Everything in [`roan/`](roan/index.md), grouped there by hand:

* [TUI](roan/tui.md) - the Textual app: screens, renderers, bindings, layout.
* [Design system](roan/design-system.md) - the one popup style and the rules that keep it consistent.
* [Themes](roan/themes.md) - four Catppuccin flavours with pink as the only accent.
* [Providers](roan/providers.md) - the four categories and how a base URL is resolved.
* [Free vs paid](roan/free-vs-paid.md) - the classification rules, and why a cost of 0 is a trap.
* [Models](roan/models.md) - models.dev, caching and the model browser.
* [Configuration](roan/configuration.md) - ~/.Roan, the settings and custom endpoints.
* [Language](roan/language.md) - the NL/EN table and the rules that keep both honest.
* [Skills, memory and profile](roan/skills-memory-profile.md) - what goes into the system prompt.
* [Agent](roan/agent.md) - the model loop, streaming and compaction.
* [Tools](roan/tools.md) - the tools the model may call.
* [Cron](roan/cron.md) - scheduled prompts.
* [Telegram](roan/channels/telegram.md) - the Telegram channel and per-chat sessions.
* [MCP](roan/mcp.md) - external MCP servers.
* [Sessions](roan/sessions.md) - saving, restoring, compacting.

## Recipes

* [Add a slash command](roan/add-a-slash-command.md)
* [Add a popup](roan/add-a-popup.md)
* [Add a language string](roan/add-a-language-string.md)
* [Add a provider](roan/add-a-provider.md)
* [Run the tests](tests/running-tests.md)
* [Release](release.md)

## Decisions

Why it is like this, including the parts that look arbitrary until you read the
reason.

* [Build our own harness](own-harness.md) - not a fork of opencode.
* [Python, not TypeScript](python-not-typescript.md) - one wheel for every platform.
* [Local first](local-first.md) - no server to depend on.
* [TUI only](roan/tui-only.md) - the REPL is a fallback, not a second product.
* [Capital R](roan/capital-r-home.md) - `~/.Roan` and the `Roan` command.
* [Fullscreen by default](roan/fullscreen-default.md) - the alternate screen, like the new Claude Code.
* [Pink is the only accent](roan/pink-accent.md) - fixed, in all four flavours.
* [Strict free classification](roan/strict-free.md) - over-reporting free models is worse than under-reporting.
* [One shared popup style](roan/shared-popup-style.md) - five screens, one stylesheet.
* [One string table](roan/one-string-table.md) - both languages or neither.

## Reference and loose ends

* [File map](file-map.md) - every file with its line count.
* [CLI and slash commands](roan/cli-and-commands.md) - both command surfaces.
* [Config keys](roan/config-keys.md) - every key in config.json.
* [Environment variables](roan/env-vars.md) - every override and the precedence order.
* [Palette](roan/palette.md) - the exact Catppuccin values per flavour.
* [Pitfalls](pitfalls.md) - bugs that already happened once, with cause and fix.
* [Ideas](ideas.md) - what we might build or change; not commitments.
