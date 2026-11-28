# Het orchestrator-commando — één paste, alle 34 features erin

Self-contained: de features staan in het commando zelf. `docs/goals-0.0.23.md`
blijft alleen als naslag; dit commando heeft niets anders nodig.

```
Roan 0.0.23 in één run: jij bent de orchestrator. Je laat 34 features bouwen door subagents, golf voor golf, en je neemt niets als klaar aan voordat het bewijs groen is. Repo /home/roan/Roan. Geen push, geen tag, geen emulator behalve bij feature 33.

Jij implementeert zelf niets, behalve integratiefixes die geen enkel kind kan doen (noteer die als zodanig). Je houdt docs/goals-progress.md bij: per feature status (pending / in-progress / done / blocked), nieuwe tests, pogingen, en bij blocked de reden.

De 34 features (de "klaar als" is de acceptatie, niets meer en niets minder):

1. Sync-terugstroom — lokaal geappende events na een join moeten bij de joiner aankomen; klaar als drie wegwerp-daemons elkaars tak in hun eigen keten-DB hebben en de mirror-order per node klopt. Plus presence: de eigen node mag niet "offline" staan terwijl de daemon draait.
2. Seq-hergroepering — deterministische volgorde (ts, nodeId, id) zodat N nodes convergeren; klaar als tests met 3 en 4 gelijktijdige schrijvers identieke ketens opleveren.
3. Updater met feed — latest.json + updatebundel lokaal geserveerd; updater ziet, downloadt, installeert, herstart; klaar als feed-parse-tests groen zijn en de UI onbereikbaarheid eerlijk toont.
4. Installers en signing — de Linux AppImage echt starten; keystore-script en checklist voor Windows/macOS (zonder secrets te loggen); klaar als de AppImage draait en docs/release.md klopt.
5. Plan mode — read-only plan met goedkeuring; klaar als schrijvende tools geblokkeerd zijn tot approve en daarna weer werken.
6. Auto-memory — na sessie-einde maximaal drie feiten destilleren als memory-events met dedupe; MEMORY.md vouwt eruit; klaar als distillatie-, dedupe- en vouwtest groen zijn.
7. Goals en standing orders — goal-event, paneel, en de goal gaat mee als context bij een nieuwe sessie; klaar als hij vouwt, meekomt en sluit.
8. Effort levels — laag/normaal/hoog per gesprek naar de provider waar die het ondersteunt; klaar als de mapping per provider getest is en onbekende providers het negeren.
9. Kosten en tokens — usage per beurt in turn_end, zichtbaar onder het antwoord en als sessietotaal; klaar als usage vouwt en onbekende usage geen regel geeft.
10. Achtergrondtaken — cron aansluiten met schema, paneel en een run als aparte sessie plus notificatie; klaar als schema-parse en run-sessie getest zijn.
11. Spraak invoer — mic-knop en een lokale STT-provider via dezelfde pluginvorm als web; klaar als provider-selectie en de eerlijke fout zonder mic getest zijn.
12. Import — AGENTS.md, CLAUDE.md, .cursorrules en OpenClaw-bestanden importeren als env-snapshot zonder iets te overschrijven; klaar als parser- en snapshot-test groen zijn.
13. Steer mid-turn — een bericht toevoegen aan een lopende beurt na de laatste tool-call; klaar als de steer aankomt en de rolvolgorde geldig blijft.
14. Deep research — meerdere zoekopdrachten, pagina's lezen, bronnen met citaten en een rapport als artifact, begrensd; klaar als de planner-lus met een stub-provider groen is.
15. Device control — een commando op een eigen node via de peer-verbinding met allowlist en goedkeuring; klaar als een actie zonder goedkeuring geweigerd wordt.
16. Zijvragen en queueing — een vraag zonder de hoofdcontext te vervuilen, en berichten in een wachtrij tijdens een beurt; klaar als queue-volgorde en context-isolatie getest zijn.
17. Delen en exporteren — een zelfstandige HTML-export naast de keten en de markdown-export met kop; klaar als de export alleen het gesprek bevat en geen secrets.
18. Archief en tijdelijke chats — archief, tombstone bij verwijderen, ephemeral chats; klaar als ephemeral niets publiceert en een tombstone verbergt zonder te wissen.
19. Veiligheid — OS-sandbox voor run_shell waar beschikbaar, elevated execution met audit-event, en tool-resultaten gemarkeerd als data; klaar als alle drie de lagen getest zijn, inclusief een kwaadaardige pagina.
20. Kennis — memory-zoek over de chain-DB met bron, en projecten als map plus instructies in de env-snapshot; klaar als zoekresultaten een bron hebben en de projectcontext in de prompt staat.
21. Commando's en hooks — command-events met prompt, en plugin-hooks (pre/post tool, pre/post turn); klaar als een commando expandeert en een kapotte hook de beurt niet breekt.
22. Server en SDK — de control-API met versie en auth gedocumenteerd, een typed client in de repo, en deferred tools; klaar als de SDK tegen een wegwerp-daemon werkt en een deferred schema resolvet.
23. Leren en rollen — een skill-voorstel dat pas na goedkeuring actief wordt, planner- en uitvoerder-model per taak, een goedkoop model voor zijtaken; klaar als het voorstel inactief blijft tot approve en de rolkeuze per taak werkt.
24. Browser — CDP: navigeren, lezen, klikken, screenshot; klaar als het tegen een lokale testpagina werkt en zonder browser een eerlijke fout geeft.
25. Computer use — screenshot en muis/toetsenbord alleen met een grant-event per sessie; klaar als een actie zonder grant geweigerd wordt.
26. Generatie — beeldgeneratie via de pluginvorm met resultaat als bijlage, video en muziek als aparte capability; klaar als provider-selectie en bijlage-landing getest zijn.
27. Spraakgesprek — STT plus TTS in een lus die na elk antwoord weer luistert, altijd stopbaar; klaar als de lus start en stopt en een falende TTS eerlijk meldt.
28. Werkplek — de workspace bekijken en openen in de app, en een analyse-tool die CSV/JSON leest en een chart-spec teruggeeft; klaar als paden buiten de workspace geweigerd worden en de chart-spec parset.
29. Code en git — code-intelligentie of een eerlijke "niet beschikbaar", diffs in de UI, een git-paneel, worktree-isolatie en CI-status; klaar als diff-render en git-status-parse getest zijn.
30. Surfaces — CLI/TUI over de control-socket, headless scripting, keybinds, natuurlijke-taal config, accessibility, deep links en artifacts; klaar als CLI-parse en deeplink-router getest zijn.
31. Koppelingen — een signed inkomende webhook, een uitgaande webhook bij sessie-einde, een GitHub read-only connector met token in secrets, en een A2A-stub met uitleg; klaar als de signature-check werkt en een token nooit gelogd wordt.
32. Opruimen en docs — TODO.md en docs/feature-groups.md naar de echte stand, dode code weg, elke plugin gedocumenteerd; klaar als de suites groen zijn en de docs kloppen.
33. Bewijsronde — emulator plus mocks, zeven screenshots (web-zoek met bron, foto, blob-bestand boven 512 kB terug via adb, auto-titel, eigen bericht bewerken, MCP met approval, Sync met twee nodes), apk 0.0.23 arm64 met md5, en telefoon-sync in beide richtingen.
34. Eindrapport — per feature één regel met bewijs, wat open bleef, de feature-groups-stand, links, en de melding dat er niets gepusht is.

Werkwijze:
1. Golfindeling met niet-overlappende bestandsgebieden, maximaal 5 subagents per golf: 1-4, 5-10, 11-15, 16-18, 19-23, 24-27, 28-31, 32. Dezelfde module nooit twee kinderen tegelijk.
2. Elke subagent krijgt zijn featuretekst hierboven letterlijk, zijn bestandsgebied, en dit contract: "Je bent pas klaar als de klaar-als-regel aantoonbaar groen is: nieuwe tests plus `npx tsc -p tsconfig.json --noEmit`, `npm run build`, `node --test $(find dist -name \"*.test.js\")`, `npx tsx --test tests/*.test.ts`, en `cd web && npx tsc -p tsconfig.json --noEmit && npx vitest run`, met echte output in je rapport. Blijf binnen je gebied. Geen push, geen tag, geen emulator, geen apk. Rapporteer pas DONE bij groene output, anders NOT DONE met de exacte fout."
3. Na elke golf verifieer je zelf: suites draaien, `git diff --stat` bekijken, de nieuwe tests nalezen en de klaar-als-regel per feature herhalen. Faalt er iets, spawn een fix-subagent met de exacte fout, maximaal drie pogingen per feature; daarna blocked met reden en door naar de volgende golf. Nooit stilzwijgend goedkeuren.
4. Ledger na elke golf bijwerken en lokaal committen (`git add -A && git commit`). Nooit pushen.
5. Feature 33 en 34 mogen als subagent, maar jij controleert de artefacten zelf: bestanden bestaan, md5 klopt, screenshots staan op schijf.
6. Eindlevering: docs/goals-progress.md met de definitieve stand, het eindrapport, en 3 regels status (wat werkt / wat niet / wat ik moet weten) plus hoeveel features blocked zijn en waarom.

Je werkt zelfstandig, zonder mij iets te vragen; meld alleen echte blokkades. Geen push, geen tag. AAN HET EINDE VAN DEZE RUN: 3 regels status. Geen volgend /goal — deze run is de dag.
```
