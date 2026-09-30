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

On first run Roan has no configuration. Run `Roan init` (an interactive wizard
that works over SSH), or edit `~/.Roan/config.json`:

```json
{ "provider": "lmstudio", "model": "local-model" }
```

Anything can also come from the environment, which overrides the file:
`ROAN_PROVIDER`, `ROAN_BASE_URL`, `ROAN_API_KEY`, `ROAN_MODEL`,
`ROAN_TELEGRAM_TOKEN`.

Providers (all OpenAI-compatible): `lmstudio`, `ollama`, `groq`, `openrouter`,
`gemini`, `deepseek`, `cerebras`, `together`, `mistral`, or `"custom"` with your
own `base_url`. Add an `api_key` when the provider needs one:

```json
{ "provider": "groq", "api_key": "gsk_...", "model": "llama-3.3-70b-versatile" }
```

## Chat mode

On a narrow terminal, a phone, or anywhere the full TUI doesn't fit:

```sh
Roan chat
```

Plain streaming text with the same slash commands.

## Commands

Inside the TUI:

- `/help` — list every command
- `/setup` — open the setup screen (`F2`)
- `/model <name>` — switch model (persists)
- `/models` — model browser: **Free / Paid / This provider**, live from
  models.dev, filterable per provider. Click a model to select it.
- `/free` — 100% free models (via models.dev)
- `/provider` — provider picker: **Free / Paid / Local / Custom**, live from models.dev
- `/theme <name>` — `mocha`, `macchiato`, `frappe`, `latte`
- `/memory` — show what Roan remembered
- `/skills` — list available skills
- `/language <nl|en>` — switch the UI and agent language
- `/tui <fullscreen|default>` — switch renderer (relaunches, keeps the conversation)
- `/new` — start a fresh conversation (`Ctrl+N`)
- `/sessions` — list saved sessions
- `/compact` — summarise the conversation to free context
- `/clear` — clear the conversation (`Ctrl+L`)
- `/quit` — exit

The first run opens the setup screen automatically: pick a provider, paste a key,
then pick a model from `/models`. Tool calls appear inline as `● run_shell ls -la`
with a `↳` result line you can **click to expand**. The status bar shows the
active model, provider and session. Up/Down arrows walk your input history; mouse
clicks focus the prompt.

## Free vs paid

models.dev has no "free" flag, so `cost: 0` alone is not trustworthy — and that
is how a lot of non-free things ended up under Free:

- subscription providers report `0`, because their price is per plan (Alibaba
  Coding Plan, Z.AI's plan, the Kimi/MiniMax/Xiaomi token plans);
- some gateways just put `:free` in a model id without it meaning anything;
- a provider can have one odd zero-priced preview model and end up in the list.

Roan therefore only calls something free in two cases:

1. **The provider has a real free tier** covering its whole catalogue (with rate
   limits): `google` (AI Studio), `groq`, `cerebras`, `mistral`, `nvidia`,
   `huggingface`, `chutes`, `modelscope`, `cloudflare-workers-ai`. Every model
   from these is usable for free.
2. **The model id says so, at a party where that is reliable**: OpenRouter
   (`:free`) and OpenCode Zen / Go (`-free`).

Z.AI is the one exception where `cost: 0` is accurate — its `*-flash` models are
genuinely free and the rest of its catalogue is paid.

Everything else — subscriptions, unknown gateways, providers with a single
zero-priced preview — counts as **paid**. The picker labels subscription
providers `subscription`, so you can tell a flat monthly fee from a token price.

Local servers are **not** in Free: they have their own category.

## Providers

`/provider` opens a picker with four categories:

1. **Free** — hosted providers with a real free tier.
2. **Paid** — everything else, including subscriptions (labelled `subscription`).
3. **Local** — servers on your own machine, with the default localhost ports:
   LM Studio `:1234`, Ollama `:11434`, llama.cpp `:8080`, vLLM `:8000`,
   LocalAI `:8080`, Jan `:1337`, KoboldCpp `:5001`,
   text-generation-webui `:5000`, GPT4All `:4891`. The port is editable before
   you confirm, so a server on another port (or another machine) still works.
4. **Custom** — your own OpenAI-compatible endpoints. Fill in a name, base URL
   and key and press **Add endpoint**; you can store as many as you like and
   pick between them later. Delete one with **Delete**. They live in the
   `endpoints` list in `config.json`.

Picking any provider fills in its `base_url` automatically — from
`PROVIDER_PRESETS` or else the `api` field in models.dev — so for hosted
providers you usually only need to paste a key.

## Renderers

Like Claude Code, Roan asks once whether you want the new fullscreen TUI, and
remembers your answer.

- **fullscreen** — draws on the terminal's alternate screen (like `vim`), so it
  never flickers and mouse support is on. `/tui fullscreen`.
- **default** — the classic renderer: everything stays in your terminal's native
  scrollback, so `Cmd+F` and tmux copy mode work as usual.

Switch at any time with `/tui fullscreen` or `/tui default`; the app relaunches
and carries the conversation over. `/tui` with no argument prints the active
renderer. Env overrides: `ROAN_NO_FLICKER=1` forces fullscreen,
`ROAN_DISABLE_ALTERNATE_SCREEN=1` forces classic. After two failed fullscreen
starts on a machine, Roan falls back to the classic renderer by itself.

While the TUI is running:

- `Ctrl+C` or `Ctrl+Q` — quit
- The **✕** in the top-right of the title bar — quit (click it). Every popup
  (setup, provider picker, model browser, the fullscreen prompt, the transcript)
  has the same ✕ in its top-right corner.
- `Ctrl+O` — transcript mode: `/` to search, `n`/`N` next/previous match, `g`/`G`
  top/bottom, `q` or `Esc` to go back
- `PgUp`/`PgDn`, `Ctrl+Home`/`Ctrl+End` — scroll the conversation
- Scrolling up pauses auto-follow; a **N new messages** bar appears and clicking
  it (or `Ctrl+End`) jumps back to the latest message
- Mouse: click to focus the prompt, click list options, scroll lists and menus,
  click a tool result to expand it
- `Enter` in any input in a popup confirms it — you never have to tab to a button
  (in the setup screen, typing your API key and pressing `Enter` saves)

Set `scroll_speed` in the config to multiply mouse-wheel distance.

## Telegram channel

Run the same agent as a Telegram bot:

```sh
Roan telegram
```

The token comes from `telegram_token` in `~/.Roan/config.json` or the
`ROAN_TELEGRAM_TOKEN` environment variable. Each chat gets its own session, and
the same `/help`, `/model`, `/new`, `/status` commands work over chat.

## MCP servers

Roan speaks the Model Context Protocol over stdio. Add servers to
`~/.Roan/mcp.json`:

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
`fetch_url`, `web_search`, `todo_write`, `remember`, `read_skill`.

## Files

Everything lives in `~/.Roan/`, laid out like Hermes' home directory:

- `config.json` — provider, model, api_key, language, renderer, telegram_token
- `instructions.md` — system prompt (overrides the built-in default)
- `user.md` — who you are; injected into the system prompt
- `memory.md` — durable memory (written by the `remember` tool)
- `skills/` — `*.md` skills (see below)
- `cron/` — `jobs.json`, scheduled prompts
- `plugins/` — your own Python plugins
- `sessions/` — one JSON file per conversation
- `logs/`, `cache/`, `plans/`

`Roan home` prints the layout.

## Skills

Drop a markdown file in `~/.Roan/skills/`:

```markdown
---
name: deploy
description: How to cut a release
---
Step 1 ...
```

Roan sees the name and description in its system prompt and pulls the full text
with the `read_skill` tool when it needs it. `/skills` lists them.

## Cron

Run scheduled prompts with `Roan cron` (a long-running process):

```json
{
  "jobs": [
    { "id": "morning", "schedule": "daily 09:00", "prompt": "Summarise my open items", "enabled": true }
  ]
}
```

`schedule` accepts `30s`, `15m`, `2h`, `1d` or `daily HH:MM`. Each job runs in its
own session (`cron-<id>`), so scheduled work never mixes with your chat.

## Status

Working: agentic loop with tools, streaming, sessions, memory, TUI with skin
rendering, Telegram channel. Next: MCP client, more channels, web UI.
