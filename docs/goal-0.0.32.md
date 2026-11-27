# /goal — Roan 0.0.32: de motor, niet de schermen

Kopieer alles hieronder in één keer. Het is self-contained: de assistent heeft
geen andere context nodig.

---

Roan 0.0.32: de motor, niet de schermen. Repo `/home/roan/Roan`. Geen push, geen
tag, geen emulator. Jij werkt zelf, met subagents alleen voor werk dat geen
gesprek nodig heeft. Je leest eerst `docs/hermes-findings.md` — dat is de
bevindingenlijst uit Hermes' broncode — en daarna bouw je de zes dingen die daar
ontbreken. Niets is klaar voordat de klaar-als-regel groen is met echte uitvoer.

1. **Een beurt met een budget en een noodrem.** De turn-runner krijgt een
   iteratiebudget met één respijt-call, een harde interrupt-poort, en een
   liveness-watchdog die een stille beurt na N seconden afbreekt met een reden.
   Klaar als: een test met een provider die blijft hangen de beurt binnen de
   grens afbreekt, een test met een provider die alleen tools teruggeeft stopt op
   het budget in plaats van oneindig, en `turn_end` in beide gevallen een
   `reason` heeft.

2. **Overflow en leeg antwoord als eigen faalvormen.** Vol contextvenster →
   eerst comprimeren en opnieuw, niet crashen. Leeg antwoord → één herstelpoging
   met een expliciete instructie, daarna een eerlijke fout. Klaar als: een test
   met een te grote history comprimeert en doorgaat, en een test met een leeg
   antwoord precies één herhaal-call doet.

3. **Compressie in twee lagen met een aux-model.** Laag 1 op 85% van het venster,
   laag 2 op 50%; eerst oude tool-resultaten prunen (geen LLM-call), dan een
   gestructureerde samenvatting via een apart `compression`-model, met een
   deterministische fallback als de samenvatting faalt. Klaar als: tests de twee
   drempels bewijzen, pruning vóór de LLM-call gebeurt, en een falende
   samenvatting de fallback-tekst oplevert zonder de beurt te breken.

4. **Zijtaken met hun eigen model en fallback.** Titels, compressie, memory-distill
   en vision krijgen elk een eigen `provider/model` uit settings met een
   fallback-lijst en een cooldown na falen. Klaar als: een test bewijst dat een
   titel met het aux-model gaat en niet met het hoofdmodel, en dat een falende
   aux-provider na één poging de fallback gebruikt.

5. **Redenering vastleggen.** De provider-stream levert reasoning-delta's; die
   worden als `reasoning`-deel op het assistant-bericht bewaard, als apart
   `reasoning`-event in de keten gezet, en in het transcript als inklapbaar
   "Thought"-blok getoond (dichtgeklapt, geen leeg blok als een provider het niet
   levert). Klaar als: een test met een stub-provider die reasoning stuurt het
   blok oplevert, en een test zonder reasoning geen blok toont.

6. **Tool-bereikbaarheid als poort.** Elke tool krijgt een `available()` die
   antwoordt of hij bruikbaar is (sleutel aanwezig, service up), gecachet, en de
   prompt krijgt alleen de tools die beschikbaar zijn. Klaar als: een test met een
   ontbrekende sleutel die tool uit de schema-lijst houdt, en een test dat hij
   terugkomt zodra de sleutel er is.

Werkwijze: lees eerst `docs/hermes-findings.md` en de betrokken Hermes-modules in
`/home/roan/.hermes/hermes-agent` (turn-fasen, compression, auxiliary_client,
registry). Houd per punt bij welke test het bewijst. Faalt iets, probeer het
maximaal drie keer en noteer daarna `blocked` met de exacte fout — nooit
stilzwijgend goedkeuren.

Bewijs: `npx tsc -p tsconfig.json --noEmit`, `npm run build`,
`node --test $(find dist -name "*.test.js")`, `npx tsx --test tests/*.test.ts`,
`cd web && npx tsc -p tsconfig.json --noEmit && npx vitest run` — alle vijf groen,
met de output in je rapport.

Lever aan het eind: de zes punten met hun bewijs, `docs/hermes-findings.md`
bijgewerkt waar je iets nieuws vond, drie regels status (wat werkt, wat niet, wat
de gebruiker moet weten), en **een nieuw, plak-klaar /goal-commando** voor de
volgende ronde (prompt-caching-discipline, credential pool, achtergrondprocessen,
terminal-backends) in dezelfde stijl, met dezelfde slotregel. Niets gepusht, geen
tag.
