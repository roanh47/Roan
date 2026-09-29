# Roan

Een persoonlijke agent harness voor de terminal. Jouw naam, jouw modellen, jouw tools.

Roan draait een chat-loop met tool-calling (shell, files, geheugen) bovenop elke
OpenAI-compatibele provider — lokaal (LM Studio / Ollama) of cloud (Groq, OpenRouter,
en elke andere `/v1`-endpoint).

## Installatie

```sh
pip install roan          # zodra de naam op PyPI is geclaimd (PEP 541)
# of lokaal:
pip install -e .
```

## Configuratie (`~/.roan/config.json`)

```json
{
  "provider": "lmstudio",
  "model": "local-model"
}
```

Providers (allemaal OpenAI-compatibel): `lmstudio`, `ollama`, `groq`, `openrouter`.
Of `"provider": "custom"` met een eigen `base_url` + `api_key`.

Voorbeeld Groq (gratis tier):
```json
{ "provider": "groq", "api_key": "gsk_...", "model": "llama-3.3-70b-versatile" }
```

## Bestanden

- `~/.roan/instructions.md` — de basis-instructieset (standaard: "Je naam is Roan…").
- `~/.roan/memory.md` — duurzaam geheugen (het model kan `remember` aanroepen).

## Tools

`run_shell`, `read_file`, `write_file`, `remember`.

## Status

v0 — werkende loop + tool-calling + geheugen. Komend: provider-lijst via `/models`,
TUI à la Claude Code, foto-rendering, MCP, streaming.