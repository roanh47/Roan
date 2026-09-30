# roan/

The harness itself, described next to the code. `roan/` is the installed package:
4.657 lines of Python in 23 files, no dependency on anything above it.

Concepts are grouped by hand rather than by folder, because the package is flat.

## How it works

* [TUI](tui.md) - the Textual app: screens, renderers, bindings, layout.
* [Design system](design-system.md) - the one popup style, and the rules that keep it consistent.
* [Themes](themes.md) - four Catppuccin flavours with pink as the only accent.
* [Palette](palette.md) - the exact colour values per flavour.
* [Providers](providers.md) - the four categories and how a base URL is resolved.
* [Free vs paid](free-vs-paid.md) - the classification rules, and why a cost of 0 is a trap.
* [Models](models.md) - models.dev, caching and the model browser.
* [Configuration](configuration.md) - ~/.Roan, the settings and custom endpoints.
* [Config keys](config-keys.md) - every key in config.json.
* [Environment variables](env-vars.md) - every override and the precedence order.
* [Language](language.md) - the NL/EN table and the rules that keep both honest.
* [Agent](agent.md) - the model loop, streaming and compaction.
* [Tools](tools.md) - the tools the model may call.
* [Skills, memory and profile](skills-memory-profile.md) - what goes into the system prompt.
* [Sessions](sessions.md) - saving, restoring, compacting.
* [Cron](cron.md) - scheduled prompts.
* [MCP](mcp.md) - external MCP servers.
* [CLI and slash commands](cli-and-commands.md) - both command surfaces.

## Channels

* [Telegram](channels/telegram.md) - the Telegram channel and per-chat sessions.

## Recipes

* [Add a slash command](add-a-slash-command.md)
* [Add a popup](add-a-popup.md)
* [Add a language string](add-a-language-string.md)
* [Add a provider](add-a-provider.md)

## Decisions

* [TUI only](tui-only.md) - the REPL is a fallback, not a second product.
* [Capital R](capital-r-home.md) - `~/.Roan` and the `Roan` command.
* [Fullscreen by default](fullscreen-default.md) - the alternate screen, like the new Claude Code.
* [Pink is the only accent](pink-accent.md) - fixed, in all four flavours.
* [Strict free classification](strict-free.md) - over-reporting free models is worse than under-reporting.
* [One shared popup style](shared-popup-style.md) - five screens, one stylesheet.
* [One string table](one-string-table.md) - both languages or neither.
