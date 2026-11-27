# Wat Hermes' broncode doet en Roan niet

Gelezen in `/home/roan/.hermes/hermes-agent`, niet uit het hoofd. Per punt: wat
Hermes doet (met de module), wat Roan heeft, en wat er dus mist.

## 1. De beurt is een machine van twintig fasen, niet een lus

`agent/conversation_loop.py` roept per iteratie een reeks fasen aan:
`turn_preflight`, `turn_iteration_prep`, `turn_request_assembly`, `turn_api_call`,
`turn_api_error`, `turn_response_intake`, `turn_response_check`,
`turn_empty_response`, `turn_tool_round`, `turn_tool_validation`,
`turn_overflow`, `turn_truncation`, `turn_context_compaction`, `turn_recovery`,
`turn_recovery_autorecover`, `turn_retry_state`, `turn_stop_gates`,
`turn_liveness`, `turn_usage`, `turn_final_response`, `turn_finalizer`.

Wat daar in zit en bij Roan ontbreekt:
- **Iteratiebudget** (`iteration_budget.remaining`) plus één `grace_call` als het
  budget op is — een beurt stopt gecontroleerd in plaats van oneindig of hard.
- **Overflow- en truncatie-afhandeling** als het contextvenster vol is: eerst
  comprimeren, dan pas doorgaan.
- **Leeg antwoord** (`turn_empty_response`) als aparte faalvorm met een eigen
  herstelpoging.
- **Herstel-ladder** (`turn_recovery_autorecover`): na uitputting wachten en
  opnieuw proberen volgens een schema.
- **Liveness-watchdog**: een beurt die stil valt wordt gedetecteerd, niet eindeloos
  "denkt nog".
- **Stop-gates**: interrupt, goedkeuring en budget als drie aparte poorten.

Roan: `src/daemon/turn-runner.ts` doet een tool-lus met een maximum en thats it.
Geen budget, geen overflow, geen leeg-antwoord-pad, geen watchdog.

## 2. Compressie in twee lagen, met een aux-model

`agent/compression_facade.py` + `conversation_compression.py` +
`turn_context_compaction.py`:
- laag 1: sessiehygiëne op **85%** van het venster;
- laag 2: `ContextCompressor` op **50%**, met **per-model overschrijvingen**;
- eerst worden **oude tool-resultaten gepruned** (géén LLM-call), dán pas een
  grens gekozen, dán een **gestructureerde samenvatting** door het
  `auxiliary.compression`-model;
- mislukt de samenvatting, dan is er een **deterministische fallback-samenvatting**;
- compressie is de **enige** toegestane cache-breuk; daarom is de systeemprompt
  byte-stabiel en gaat alles wat later binnenkomt via een user- of tool-bericht.

Roan: `compactMessages` vouwt alles boven 40 berichten tot een digest. Geen
percentages, geen prune-eerst, geen aux-model, geen fallback, geen
cache-discipline.

## 3. Zijtaken hebben hun eigen model, sleutel en herstel

`agent/auxiliary_client.py` (`_resolve_auto_route`), `auxiliary_health.py`,
`auxiliary_fallback_recovery.py`, `auxiliary_key_rotation.py`,
`auxiliary_rate_limit_backoff.py`:
- elke zijtaak (titel maken, compressie, vision, curator, session_search) kan
  **eigen provider/model/base_url/reasoning_effort** hebben;
- **fallback_chain** per taak, met een **cooldown** na een provider-overflow;
- **sleutelrotatie** over een pool, en **rate-limit backoff**;
- health-probe per provider.

Roan: één `settings.model` en één sleutel voor alles, ook voor titels en
samenvattingen. Als de provider hikt, valt de hele beurt om.

## 4. Redenering is een eersteklas berichtveld

`assistant_msg["reasoning"]`, plus `anthropic_thinking_policy.py` en
`anthropic_thinking_replay.py`: thinking-blokken worden bewaard, per provider
vertaald, en bij replay opnieuw meegestuurd.

Roan: slaat geen reasoning op. Daarom bestaat het `Thought`-blok niet.

## 5. Prompt-caching is een invariant, geen hoop

De systeemprompt is **byte-stabiel** voor de hele sessie; toolsetwijzigingen,
memory-herlading en skill-injectie mogen hem niet aanraken. Een skill-slash-commando
gaat als **user-bericht** mee (`agent/skill_commands.py`), submap-`AGENTS.md`-hints
worden aan het **tool-resultaat** geplakt (`agent/subdirectory_hints.py`), met een
plafond van 32.000 tekens.

Roan: bouwt de prompt elke beurt opnieuw op uit settings en memory, dus elke beurt
is een cache-miss.

## 6. Tools zijn gegated op bereikbaarheid, niet op aanwezigheid

`tools/registry.py`: elke tool heeft een `check_fn` die antwoordt of hij *bereikbaar*
is (sleutel aanwezig, service up), TTL-gecachet **per home**. Toolsets per platform
bepalen wat een sessie ziet; GUI-tools zitten in een eigen toolset die alleen een
GUI-sessie inlaadt.

Roan: registreert alles wat er is en filtert met een policy; een tool zonder
sleutel faalt pas bij de aanroep.

## 7. Delegatie heeft rollen, units, hartslagen en overdracht

`tools/delegate_tool.py`: rollen `leaf`/`orchestrator`, achtergrond-units met
eigen levensduur, `heartbeat`-events, `output_schema` met één correctie-ronde,
kern-isolatie per kind, en `process_manage(action="handoff")` om een
achtergrondproces van kind naar ouder over te dragen.

Roan: `delegate` met eigen context en een samenvatting terug. Geen rollen, geen
achtergrond, geen schema, geen overdracht.

## 8. Achtergrondprocessen zijn een register, niet een spawn

`tools/process*.py` + `process_registry*.py`: processen met id, eigenaar, notificaties
bij afronden, hartslagen, en een teardown die eerst de ouder SIGTERMt en dan de
kinderen.

Roan: geen achtergrondproces-tool. Een lang commando blokkeert de beurt.

## 9. Terminal is een backend, niet `exec`

`tools/environments/`: `local`, `docker`, `ssh`, `modal`, `daytona`, elk met eigen
mount- en omgevingsregels.

Roan: `exec` op de lokale machine.

## 10. Browsersessies hebben een levenscyclus

`browser_session.py` + `browser_launcher.py`: één browser per cache-sleutel, een
CDP-endpoint dat uit vier bronnen kan komen, een reaper die een gecrashte eigenaar
opruimt, en een expliciete toestemming voor een echt profiel.

Roan: een CDP-client, geen sessiebeheer.

## 11. MCP is een client met vertrouwen per omgeving

`tools/mcp_tool_*.py`: config, discovery, transport, registratie, content, fouten,
en een **trust-record per home** zodat een tweede omgeving nooit het vertrouwen van
de eerste erft.

Roan: een client met een vaste config, geen discovery en geen trust-model.

## 12. Geheimen zijn scoped en falen dicht

`agent/secret_scope.py`: `get_secret` weigert (`UnscopedSecretError`) zodra er meer
dan één omgeving in het proces draait, in plaats van stil `os.environ` te lezen.

Roan: één home, één `.env`-achtige map. Geen scoping, en dus ook geen vangnet als
er ooit twee omgevingen in één proces komen.

## 13. Er is een curator, een insights-laag en een skills-hub

`agent/curator.py` + `curator_backup.py` (skills opruimen, verouderde voorstellen),
`hermes_cli/sessions_insights.py` (gebruik en kosten), `tools/skills_hub_*.py`
(bladeren/installeren).

Roan: geen van drie.

## Wat dit betekent

De afstand zit niet in schermen maar in de **motor**: een beurt die tegen een
vol venster, een leeg antwoord en een hangende provider kan, een geheugen dat
zichzelf opruimt, zijtaken met eigen modellen, en een prompt die niet elke beurt
opnieuw wordt gebouwd. Dat is precies waarom Hermes dagen achter elkaar kan
draaien en Roan na een paar beurten vastloopt.
