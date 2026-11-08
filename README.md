# Roan

Terminal-agent in TypeScript. Core en UI zijn gescheiden: de agent-loop weet niets
van de terminal, de TUI is een schil die alleen events tekent.

```
src/
  agent.ts      de loop: model → tool → model, met stappenbudget
  provider.ts   OpenAI-compatibel endpoint, streaming
  tools.ts      read_file, write_file, list_dir, run_shell
  config.ts     omgeving en systeemprompt
  index.ts      CLI: TUI of één opdracht
  tui/app.tsx   Ink-interface
```

## Draaien

```bash
npm install
npm run dev                 # TUI, via tsx
npm run dev -- -p "hoi"     # één opdracht, zonder TUI
npm run build && node dist/index.js
```

Instellingen gaan via de omgeving:

```bash
export ROAN_API_URL=http://127.0.0.1:1234/v1   # LM Studio, OpenAI, opencode-go…
export ROAN_API_KEY=                            # leeg mag bij een lokale server
export ROAN_MODEL=qwen3-coder
```

De standaard is een lokale LM Studio op poort 1234.

## Waarom deze opzet

- **De core is UI-loos.** Alles wat de agent doet komt binnen als `AgentEvent`, dus
  dezelfde code drijft de TUI en `roan -p`. Een tweede interface (web, Telegram)
  is een nieuwe schil, geen tweede agent.
- **Tools zijn een lijst, geen schakelaar.** `builtinTools` is een array; een tool
  toevoegen is één object met een JSON-schema en een `run`.
- **Paden blijven binnen de werkmap.** `read_file` en `write_file` weigeren alles
  wat via `..` of een absoluut pad buiten `--cwd` valt.
- **Streaming vanaf het begin.** Het antwoord wordt stukje bij stukje getoond in
  plaats van pas als het model klaar is.

## Wat er nog niet is

- Geen tokens/tijd-budget per beurt, alleen een stappenbudget van 24.
- Geen toestemming vragen vóór `run_shell`; die draait direct.
- Geen geschiedenis op schijf; elke start begint leeg.
- Nog geen binaries: daarvoor is `bun build --compile` de volgende stap.
