# Roan

A terminal-based agent harness. Bring your own OpenAI-compatible model — local or
hosted, free or paid — and Roan provides the agentic loop: tool-calling, streaming,
durable memory, sessions, and channels so the same agent can also answer on
Telegram.

```
❯ refactor this module and run the tests
● run_shell(ls -la)
● read_file(src/app.py)
● write_file(src/app.py)
● run_shell(pytest -q)
All 23 tests pass.
```

## Install

Stable (`main`):

```sh
git clone https://github.com/roanh47/Roan.git
cd Roan
pip install -e .
```

Pre-release (newer, untested):

```sh
git clone -b pre-release https://github.com/roanh47/Roan.git
cd Roan
pip install -e .
```

Requires Python 3.10+. Contributions welcome — tests run with
`pip install -e ".[dev]" && pytest`.

## Configure

On first run Roan has no configuration. Either run `/setup` inside the TUI, or
edit `~/.roan/config.json`:

```json
{ "provider": "lmstudio", "model": "local-model" }
```

Providers (all OpenAI-compatible): `lmstudio`, `ollama`, `groq`, `openrouter`,
`gemini`, `deepseek`, `cerebras`, `together`, `mistral`, or `"custom"` with your
own `base_url`. Add an `api_key` when the provider needs one:

```json
{ "provider": "groq", "api_key": "gsk_...", "model": "llama-3.3-70b-versatile" }
```

## Commands

Inside the TUI:

| Command | What it does |
| --- | --- |
| `/help` | List every command |
| `/setup` | Show the active configuration |
| `/model <name>` | Switch model (persists) |
| `/models` | Live model list from the current provider |
| `/free` | 100% free models (via models.dev) |
| `/provider <name>` | Switch provider |
| `/theme <name>` | `mocha`, `macchiato`, `frappe`, `latte` |
| `/memory` | Show what Roan remembered |
| `/new` | Start a fresh conversation |
| `/sessions` | List saved sessions |
| `/clear` | Clear the conversation |
| `/quit` | Exit |

Mouse clicks focus the input; scroll to read history.

## Telegram channel

Run the same agent as a Telegram bot:

```sh
roan telegram
```

The token comes from `telegram_token` in `~/.roan/config.json` or the
`ROAN_TELEGRAM_TOKEN` environment variable. Each chat gets its own session, and
the same `/help`, `/model`, `/new`, `/status` commands work over chat.

## MCP servers

Roan speaks the Model Context Protocol over stdio. Add servers to
`~/.roan/mcp.json`:

```json
{
  "servers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    }
  }
}
```

Every tool from every server becomes available to the agent as
`<server>__<tool>`. A server that fails to start is skipped, not fatal.

## Tools

`run_shell`, `read_file`, `write_file`, `edit_file`, `list_files`, `glob_files`,
`fetch_url`, `web_search`, `remember`.

## Files

- `~/.roan/config.json` — provider, model, api_key, telegram_token.
- `~/.roan/instructions.md` — system prompt (overrides the default).
- `~/.roan/memory.md` — durable memory (written by the `remember` tool).
- `~/.roan/sessions/` — one JSON file per conversation.

## Status

Working: agentic loop with tools, streaming, sessions, memory, TUI with skin
rendering, Telegram channel. Next: MCP client, more channels, web UI.
