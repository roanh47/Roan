# Hoe je een agent bouwt (en wat Roan daarvan mist)

Gelezen, niet verzonnen: Anthropic's *Building effective agents* (dec 2024),
*Effective context engineering for AI agents*, de Claude-cookbook over
compaction/tool-clearing/memory, en Oracle's analyse van de vier
context-operaties. Bronnen onderaan.

## 1. Een agent is een lus, geen framework

> "Agents are typically just LLMs using tools based on environmental feedback in
> a loop." — *Building effective agents*

De hele motor is: **model → tool-call → omgeving → resultaat → model**. Alles
daaromheen is boekhouding. Dezelfde tekst maakt het onderscheid dat de meeste
projecten verpesten:

- **Workflow**: LLM's en tools in een vooraf bepaalde codepad (voorspelbaar, saai).
- **Agent**: het model bepaalt zélf de volgende stap (flexibel, duurder, foutgevoeliger).

Advies van de bron: begin bij de simpelste vorm (één call met retrieval), voeg
pas een lus toe als het echt niet anders kan, en wantrouw frameworks die de
prompt en het antwoord achter abstracties verstoppen.

**Voor Roan:** de lus bestaat (`src/daemon/turn-runner.ts` + `src/agent.ts`).
Wat ontbreekt is de boekhouding eromheen — zie verder.

## 2. Context is een budget, geen opslag

> "Good context engineering means finding the smallest possible set of
> high-signal tokens that maximize the likelihood of your desired outcome."

Twee harde feiten uit die post:

- **Context rot**: hoe meer tokens, hoe slechter het model terugvindt wat erin
  staat. Het is een helling, geen klif — maar hij is meetbaar.
- **Aandachtsbudget**: elke token kost iets, ook als hij "klopt".

De vier bewegingen die daaruit volgen (de conventie in 2026):

| Beweging | Wat het doet | Waar het in Hermes zit |
|---|---|---|
| **Select** | alleen relevante stukken erin; de rest als verwijzing (pad, id, query) | tool-resultaten met paden, `session_search` |
| **Compress** | compacten of tool-resultaten wissen | `ContextCompressor` op 50%, hygiëne op 85% |
| **Write** | notities die een reset overleven | `MEMORY.md`, memory-events, progress files |
| **Isolate** | subagent met eigen venster, alleen de samenvatting terug | `delegate_task` |

Twee details die bijna iedereen fout doet:

1. **Eerst wissen, dan samenvatten.** Anthropic raadt aan om te beginnen met het
   wissen van oude tool-resultaten die de agent al heeft verwerkt — geen
   LLM-call, geen verlies van beslissingen.
2. **Compressie moet omkeerbaar zijn waar het kan.** Oracle's vergelijking:
   *masking* (marker + verwijzing) en *offloading* (pad + versie) zijn
   terug te halen; *samenvatten* is dat niet, en een policy-regel die in de
   samenvatting verdwijnt is een echte bug.

**Voor Roan:** `compactMessages` doet alleen het derde (samenvatten), zonder de
eerste twee. Dat is precies de verkeerde volgorde.

## 3. Een lange taak heeft een "harnas", niet alleen een lus

De les uit Anthropic's stuk over langlopende agents: een agent die uren draait
heeft naast de lus twee dingen nodig — **een voortgangsbestand** en **een
feature-lijst met status**. Na een reset leest hij die en gaat verder, in plaats
van opnieuw te beginnen. Het harnas is wat een lange run overleeft; het model is
vervangbaar.

**Voor Roan:** de keten is al een event-log, dus dit is bijna gratis: een
`progress`-event per milestone en een `features`-event met status per item. Dan
kan een nieuwe sessie verder waar de oude stopte.

## 4. Tools zijn een interface voor een junior, niet voor een API

Uit hetzelfde stuk, en dit is de meest onderschatte regel:

- Schrijf de tool-beschrijving zoals je een docstring voor een junior schrijft:
  voorbeeld, randgevallen, invoerformaat, grens met andere tools.
- **Poka-yoke**: maak het onmogelijk om fout te doen. Anthropic's voorbeeld:
  relatieve paden gingen mis zodra de agent uit de root liep → absolute paden
  verplicht maken, en het ging foutloos.
- Test hoe het model je tool gebruikt, niet of je handler werkt.

**Voor Roan:** de tools hebben schemas, maar geen voorbeelden en geen
poka-yoke. `run_shell` met een relatief pad is dezelfde val.

## 5. Wat je moet meten

De bron noemt het niet als feature maar als voorwaarde: zonder evals weet je
niet of een wijziging helpt. Minimaal: een set van 20-50 echte taken met een
verwacht resultaat, en per run: geslaagd, aantal stappen, kosten, duur. Dan is
"beter" een getal in plaats van een gevoel.

**Voor Roan:** er zijn 1568 unit-tests en nul taak-evals. Dat is de grootste
blinde vlek na de context-laag.

## 6. De volgorde die ik zou aanhouden

1. **Beurt-harnas**: budget, noodrem, watchdog, `reason` (Q1 — gedaan).
2. **Context in de juiste volgorde**: tool-resultaten wissen → maskeren →
   pas als laatste samenvatten, met een deterministische fallback.
3. **Voortgang vastleggen**: `progress`- en `features`-events, zodat een
   herstart verder gaat in plaats van opnieuw begint.
4. **Aux-modellen**: zijtaken (titel, compressie, distill) op een eigen,
   goedkoop model met fallback — dat is het verschil tussen € en €€€.
5. **Tools poka-yoke**: absolute paden, voorbeelden in het schema, grenzen
   benoemd.
6. **Evals**: 30 taken, kosten en stappen per run, als vaste meting.
7. Pas daarna de schermen (logs, analytics, cron) — die tonen alleen wat de
   motor al doet.

## Bronnen

- Anthropic, [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- Anthropic, [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- Claude-cookbook, [Context engineering: memory, compaction and tool clearing](https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools)
- Oracle, [The four operations that decide whether your agent survives production](https://blogs.oracle.com/developers/what-is-context-engineering-the-four-operations-that-decide-whether-your-agent-survives-production)
- Sourcegraph, [Context engineering for AI agents](https://sourcegraph.com/blog/context-engineering)
- Chroma, [Context rot](https://research.trychroma.com/context-rot)
