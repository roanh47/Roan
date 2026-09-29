# Roan

A terminal-based agent harness. Bring any OpenAI-compatible model and a set of
tools; Roan provides the agentic loop, tool-calling, and durable memory.

## Install

Stable:

```sh
pip install roan
```

Pre-release:

```sh
pip install --pre roan
```

Development (editable, from a git clone):

```sh
pip install -e .
```

## Configure (`~/.roan/config.json`)

```json
{ "provider": "lmstudio", "model": "local-model" }
```

Providers (all OpenAI-compatible): `lmstudio`, `ollama`, `groq`, `openrouter`,
or `"provider": "custom"` with your own `base_url` and `api_key`.

Groq (free tier) example:

```json
{ "provider": "groq", "api_key": "gsk_...", "model": "llama-3.3-70b-versatile" }
```

## Files

- `~/.roan/instructions.md` — the system prompt (overrides the default).
- `~/.roan/memory.md` — durable memory (the agent can call `remember`).

## Tools

`run_shell`, `read_file`, `write_file`, `remember`.

## Status

v0 — working loop, tool-calling, memory. Next: provider discovery via `/models`,
Claude-Code-style TUI, terminal image rendering, MCP, streaming.