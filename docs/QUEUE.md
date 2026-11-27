# Werkqueue

Eén item per ronde. Bovenaan pakken, afvinken, volgende. Een item is pas klaar
als de acceptatieregel groen is **met echte uitvoer**; anders gaat het naar
`blocked` met de exacte fout en schuift de ronde door.

Deze lijst is de enige bron voor de zelfwerkende lus (`docs/LOOP.md`). Nieuwe
ideeën komen onderaan, nooit tussen de eerste drie.

## Q1 — Beurt met budget en noodrem ✅
Bron: `docs/hermes-findings.md` §1 · Hermes: `agent/conversation_loop.py`, `agent/turn_stop_gates.py`, `agent/turn_liveness.py`
De turn-runner krijgt een iteratiebudget met één respijt-call, een interrupt-poort
en een watchdog die een stille beurt met een reden afbreekt.
**Klaar als:** een test met een provider die blijft hangen de beurt binnen de grens
afbreekt, een test met een provider die alleen tools teruggeeft op het budget stopt,
en `turn_end` in beide gevallen een `reason` heeft.
**Bewijs:** `src/agent.ts` (poort, `TurnEndReason`, `TurnStallError`), `src/turn/lock.ts` (`ReleaseOptions.reason`), `src/daemon/turn-runner.ts` (reden naar `turn_end`); tests in `src/daemon/turn-gates.test.ts`: “a provider that only calls tools stops on the budget, after exactly one grace call”, “a provider that goes silent is aborted by the watchdog, with a reason”, “an interrupted turn sends no request and ends with reason interrupted”. Gates: tsc 0, build 0, dist 1568/1568, tsx 116/116, web tsc 0 + vitest 156/156.

## Q2 — Leeg antwoord en overflow als eigen faalvormen ✅
Bron: §1 · `agent/turn_empty_response.py`, `agent/turn_overflow.py`
Vol venster → eerst comprimeren en opnieuw. Leeg antwoord → één herstelpoging met
expliciete instructie, daarna een eerlijke fout.
**Klaar als:** een te grote history comprimeert en doorgaat; een leeg antwoord
precies één herhaal-call doet.
**Bewijs:** `src/context/overflow.ts` (`isContextOverflow`, `compressForOverflow`), `src/agent.ts` (`EMPTY_RETRY_PROMPT`, één compressie- en één leeg-retry per beurt, `reason` `empty`/`overflow`), `src/types.ts` (`TurnEndReason`), `docs/protocol.md`; tests in `src/daemon/turn-recovery.test.ts`: “a history too large for the window is compressed and the turn continues”, “an empty answer gets exactly one explicit retry, then an honest error”, “a window rejection that cannot shrink ends the turn instead of looping”. Gates: tsc 0, build 0, dist 1571/1571, tsx 116/116, web tsc 0 + vitest 156/156.

## Q3 — Compressie in twee lagen met een aux-model
Bron: §2 · `agent/compression_facade.py`, `conversation_compression.py`
85% hygiëne en 50% compressor, eerst tool-resultaten prunen zonder LLM-call, dan
samenvatten via een apart compressiemodel, met deterministische fallback.
**Klaar als:** beide drempels getest, pruning vóór de LLM-call, en een falende
samenvatting levert de fallback zonder de beurt te breken.

## Q4 — Zijtaken met eigen model en fallback
Bron: §3 · `agent/auxiliary_client.py`, `auxiliary_fallback_recovery.py`
Titels, compressie, memory-distill en vision krijgen eigen `provider/model` met een
fallback-lijst en cooldown na falen.
**Klaar als:** een titel met het aux-model gaat en niet met het hoofdmodel, en een
falende aux-provider na één poging de fallback gebruikt.

## Q5 — Redenering vastleggen en uitklappen
Bron: §4 · `assistant_msg["reasoning"]`, `anthropic_thinking_policy.py`
Reasoning-delta's worden als `reasoning`-deel op het bericht bewaard, als
`reasoning`-event in de keten gezet, en als inklapbaar `Thought`-blok getoond.
**Klaar als:** een stub-provider met reasoning het blok oplevert, een provider
zonder reasoning géén (leeg) blok, en het blok dichtgeklapt start.

## Q6 — Tool-bereikbaarheid als poort
Bron: §6 · `tools/registry.py` (`check_fn`, TTL-cache per home)
Elke tool krijgt `available()`; de prompt bevat alleen beschikbare tools.
**Klaar als:** een ontbrekende sleutel de tool uit de schema-lijst houdt en hem
terugzet zodra de sleutel er is.

## Q7 — Oude foutregels opruimen
Een fout die door een geslaagde herhaling is ingehaald verdwijnt uit het
transcript zonder uit de keten te verdwijnen.
**Klaar als:** een gefaalde en daarna geslaagde beurt geen foutregel meer toont,
maar de fout wel in de export staat.

## Q8 — Model per gesprek
Bron: `docs/app-features.md` §Modellen
Het model hoort bij de sessie, niet bij het device.
**Klaar als:** twee gesprekken tegelijk met verschillende modellen antwoorden en
het na een herstart nog zo is.

## Q9 — Thinking level als knop
De bestaande mapping (`src/providers/effort.ts`) krijgt een keuze per gesprek in
de composer.
**Klaar als:** de keuze in de keten belandt, per gesprek geldt en na herstart blijft.

## Q10 — Approval modes per gesprek
Eén schakelaar: *ask everything* / *auto-allow reads* / *plan only*.
**Klaar als:** een schrijvende tool in "auto-allow reads" nog steeds vraagt, en in
"plan only" geweigerd wordt tot goedkeuring.

## Q11 — Policy vóór de tool-call
`run_shell` in `src/tools.ts` raadpleegt `policy.ts` niet.
**Klaar als:** een deny-regel de uitvoering tegenhoudt vóór `exec`, met een test.

## Q12 — Logs-pagina
De daemon heeft `/log`; de app krijgt een pagina met filter en "kopieer".
**Klaar als:** de pagina de laatste regels toont, filtert op fout/waarschuwing, en
werkt zonder de daemon (eerlijke melding).
