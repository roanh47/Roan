---
okf_version: "0.2"
---

# Roan — knowledge bundle

Everything an agent needs to work on Roan without reading 4.657 lines of Python
first. Plain markdown plus YAML frontmatter, so OpenCode, Claude Code, Cursor or
any other agent can consume it as-is.

Source of truth is the code in this repository. Where a statement is enforced by
the test suite, the concept says so. Check the bundle after editing it:

    python3 knowledge/references/validate_okf.py

and regenerate the file map after a structural change:

    python3 knowledge/references/generate_file_map.py

## Start here

* [What Roan is](overview/what-is-roan.md) - the project in one page: the goal, the promises, the non-goals.
* [Architecture](overview/architecture.md) - every module, what it owns, and how they depend on each other.
* [Request lifecycle](overview/request-lifecycle.md) - what happens between pressing Enter and seeing an answer.
* [Glossary](overview/glossary.md) - the words this project uses in a specific way.

## Concepts

* [TUI](concepts/tui.md) - the Textual app: screens, renderers, bindings, layout.
* [Design system](concepts/design-system.md) - the one popup style, and the rules that keep it consistent.
* [Themes](concepts/themes.md) - four Catppuccin flavours with pink as the only accent.
* [Providers](concepts/providers.md) - the four categories and how a base URL is resolved.
* [Free vs paid](concepts/free-vs-paid.md) - the classification rules, and why a cost of 0 is a trap.
* [Models](concepts/models.md) - models.dev, caching, and the model browser.
* [Configuration](concepts/configuration.md) - ~/.Roan, the config keys and custom endpoints.
* [Language](concepts/language.md) - the NL/EN table and the rules that keep both honest.
* [Skills, memory and profile](concepts/skills-memory-profile.md) - what goes into the system prompt.
* [Tools](concepts/tools.md) - the tools the model may call.
* [Cron](concepts/cron.md) - scheduled prompts.
* [Channels](concepts/channels.md) - the Telegram channel and per-chat sessions.
* [MCP](concepts/mcp.md) - external MCP servers.
* [Sessions](concepts/sessions.md) - saving, restoring and compacting.
* [Agent](concepts/agent.md) - the loop, streaming, tool calls and compaction.

## Guides

* [Add a slash command](guides/add-a-slash-command.md) - from the registry to the TUI, with the tests.
* [Add a popup](guides/add-a-popup.md) - the modal recipe, using the shared style.
* [Add a language string](guides/add-a-language-string.md) - in both languages, with parity.
* [Add a provider](guides/add-a-provider.md) - local, preset or custom.
* [Run the tests](guides/run-the-tests.md) - how to run them and what they guard.
* [Release](guides/release.md) - the two branches and the release checklist.

## Decisions

* [Decision log](decisions/index.md) - why the project is built this way, one record per choice.

## References

* [File map](references/file-map.md) - every file in the repo and what it is for.
* [CLI and slash commands](references/cli-and-commands.md) - both command surfaces.
* [Config keys](references/config-keys.md) - every key in config.json.
* [Environment variables](references/env-vars.md) - the env overrides.
* [Palette](references/palette.md) - the exact Catppuccin values used.
* [Pitfalls](references/pitfalls.md) - bugs already hit once, so they are not hit twice.
