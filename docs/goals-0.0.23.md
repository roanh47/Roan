# Goals voor 0.0.23 — de complete clone in één dag

Elke goal is plak-klaar. Je plakt goal 1; aan het eind van die run geeft de agent
goal 2 letterlijk terug (hij staat hieronder al klaar — de agent hoeft hem niet te
verzinnen, alleen te herhalen). Zo blijft de lus dicht zonder dat jij iets hoeft
te bedenken.

## Vaste regels (gelden in elke goal, staan ook in elke goal)

- Repo: `/home/roan/Roan`. Branch `main`. **Geen push, geen tag** — pushen start
  de release-build.
- Groen bewijs per goal: `npx tsc -p tsconfig.json --noEmit`, `npm run build`,
  `node --test $(find dist -name "*.test.js")`, `npx tsx --test tests/*.test.ts`,
  `cd web && npx tsc -p tsconfig.json --noEmit && npx vitest run`.
- Alles Engels in code, comments, logs, testnamen. UI Engels; de agent mag
  Nederlands antwoorden als de gebruiker dat doet.
- Commit lokaal per goal (`git add -A && git commit`), nooit pushen.
- Geen emulator, geen apk, geen telefoon werk — behalve in goal 33.
- De agent werkt zelfstandig, vraagt niets, meldt alleen echte blokkades.
- Slot van elke run: 3 regels (wat werkt / wat niet / wat je moet weten) +
  het volgende /goal letterlijk uit dit bestand.

---

## Goal 1 — sync-terugstroom en presence

```
Roan goal 1/34: de sync ademt beide kanten op. Repo /home/roan/Roan, geen push, geen tag, geen emulator.

Hoofdzaak: lokaal geappende events na een join bereiken de joiner niet (join-time sync werkt, inkomende events landen, de push vanaf de ontvangende kant blijft stil). Zoek de oorzaak in de uitgaande sessies (store-subscribe versus het store-incident dat de control-kant gebruikt, en de lastSentSeq-boekhouding) en dicht het. Bewijs met drie wegwerp-daemons: B en C schrijven tegelijk, alle drie de nodes zien elkaars tak in hun eigen state (keten-DB bevat beide teksten), en de mirror-order blijft kloppen (elke node houdt zijn eigen tak eerst). Script in ~/.hermes/cache/scratch/proof-three-branches.cjs bestaat al; werk het bij en laat het PASS geven. Daarna: de presence-bug — de eigen node toont "offline" in het Sync-paneel terwijl de daemon draait; liveness mag niet alleen van peer-heartbeats afhangen. Unit-test dat bij.

Bewijs: root- en tests-suite groen, beide typechecks schoon, het drie-daemons-script PASS in beide richtingen.

AAN HET EINDE: 3 regels status + het volgende /goal letterlijk uit docs/goals-0.0.23.md (goal 2/34), niet herschrijven.
```

## Goal 2 — seq-hergroepering bij meer dan twee nodes

```
Roan goal 2/34: seq-hergroepering. Repo /home/roan/Roan, geen push, geen tag, geen emulator.

Bij drie of meer nodes die tegelijk schrijven ontstaan takken die nu per paar samenvoegen; ontwerp en bouw één hergroepering die voor N nodes convergeert: een deterministische volgorde (bijv. (ts, nodeId, id)) zodat elke node dezelfde uiteindelijke keten krijgt, met tests die drie en vier schrijvers tegelijk simuleren en bewijzen dat alle nodes na replay identiek zijn. Documenteer de regel in docs/chain.md.

Bewijs: nieuwe tests (3 en 4 schrijvers) groen, volle suites groen, typechecks schoon.

AAN HET EINDE: 3 regels status + goal 3/34 letterlijk uit docs/goals-0.0.23.md.
```

## Goal 3 — updater echt, met feed

```
Roan goal 3/34: de updater werkt aantoonbaar. Repo /home/roan/Roan, geen push, geen tag.

Bouw de update-feed lokaal: een latest.json met een tweede versie (0.0.24-test) en een updatebundel, geserveerd vanaf de machine. Test de updater tegen die feed op Linux: app ziet versie, downloadt, installeert, herstart. Schrijf een test die de feed-parse en de versievergelijking afdekt (nieuwer/ouder/gelijk), en laat de UI de feed-status eerlijk tonen als hij onbereikbaar is. Geen GitHub-release.

Bewijs: feed-parse-tests groen, handmatige run beschreven met echte output, suites groen.

AAN HET EINDE: 3 regels status + goal 4/34 letterlijk uit docs/goals-0.0.23.md.
```

## Goal 4 — installers en signing-voorbereiding

```
Roan goal 4/34: elke installer start. Repo /home/roan/Roan, geen push, geen tag.

Start de Linux AppImage lokaal (echt, niet alleen bouwen) en leg vast wat er gebeurt. Bereid signing voor: een script dat een release-keystore voor Android aanmaakt en in CI-secrets documenteert (zonder secrets te loggen), en een checklist voor Windows (SmartScreen) en macOS (Gatekeeper/notarisatie) in docs/release.md. Geen release publiceren.

Bewijs: AppImage gestart (output/versie), checklist in docs, suites groen.

AAN HET EINDE: 3 regels status + goal 5/34 letterlijk uit docs/goals-0.0.23.md.
```

## Goal 5 — plan mode

```
Roan goal 5/34: plan mode. Repo /home/roan/Roan, geen push, geen tag.

Een read-only plan-modus: de agent onderzoekt en schrijft een plan, voert niets uit tot de gebruiker het plan goedkeurt. Ketenevent `plan` (append-only), UI-toggle in de composer, en de turn-runner weigert schrijvende tools zolang de modus actief is (allowlist: read/zoek-tools mogen). Tests: plan-modus blokkeert write/exec, goedkeuren heft op, events vouwen over de keten.

Bewijs: tests groen (blokkeren + opheffen), suites groen, typechecks schoon.

AAN HET EINDE: 3 regels status + goal 6/34 letterlijk uit docs/goals-0.0.23.md.
```

## Goal 6 — auto-memory die destilleert

```
Roan goal 6/34: geheugen dat zichzelf bijhoudt. Repo /home/roan/Roan, geen push, geen tag.

Na een sessie-einde destilleert de daemon (met het auxiliary-model) maximaal drie durable feiten uit het gesprek en schrijft ze als `memory`-event naar de keten (append-only, met dedupe tegen bestaande). MEMORY.md in de home vouwt uit die events. UI: geheugen-rij in Settings met verwijderen. Tests: distillatie-prompt parse, dedupe, vouwen.

Bewijs: tests groen, suites groen, typechecks schoon.

AAN HET EINDE: 3 regels status + goal 7/34 letterlijk uit docs/goals-0.0.23.md.
```

## Goal 7 — goals en standing orders

```
Roan goal 7/34: goals. Repo /home/roan/Roan, geen push, geen tag.

Een `goal`-event en een Goals-paneel: een staande opdracht met status, die de daemon bij een nieuwe sessie als eerste context meegeeft en waarvan de voortgang als `goal_update`-events wordt bijgehouden. Sluit-knop. Tests: goal vouwt over de keten, nieuwe sessie krijgt hem, afsluiten werkt.

Bewijs: tests groen, suites groen.

AAN HET EINDE: 3 regels status + goal 8/34 letterlijk uit docs/goals-0.0.23.md.
```

## Goal 8 — thinking/effort levels

```
Roan goal 8/34: denkniveau. Repo /home/roan/Roan, geen push, geen tag.

Een `effort`-instelling per gesprek (laag/normaal/hoog) die naar de provider gaat waar die het ondersteunt (reasoning effort / thinking budget) en zichtbaar is in de composer. Onbekende providers negeren het zonder fout. Tests: mapping per provider, onbekend = geen parameter.

Bewijs: tests groen, suites groen.

AAN HET EINDE: 3 regels status + goal 9/34 letterlijk uit docs/goals-0.0.23.md.
```

## Goal 9 — kosten en tokens per beurt

```
Roan goal 9/34: kosten zichtbaar. Repo /home/roan/Roan, geen push, geen tag.

Providers rapporteren usage al; bewaar het per beurt (prompt/completion tokens) in het `turn_end`-event en toon het onder het antwoord (Tokens: in/out, en kosten als de provider prijzen heeft). Een sessie-totaal in de drawer. Tests: usage-vouwen, onbekende usage = geen regel.

Bewijs: tests groen, suites groen.

AAN HET EINDE: 3 regels status + goal 10/34 letterlijk uit docs/goals-0.0.23.md.
```

## Goal 10 — achtergrondtaken

```
Roan goal 10/34: achtergrondtaken. Repo /home/roan/Roan, geen push, geen tag.

De bestaande cron-module aansluiten: een taak met schema (elke N uur / dagtijd), een Background-paneel om taken te maken en te stoppen, en een run die als aparte sessie in de keten verschijnt. Notificatie bij klaar via de bestaande foreground-service-tick. Tests: schema-parse, run maakt sessie, stoppen werkt.

Bewijs: tests groen, suites groen.

AAN HET EINDE: 3 regels status + goal 11/34 letterlijk uit docs/goals-0.0.23.md.
```

## Goal 11 — spraak invoer

```
Roan goal 11/34: spraak naar tekst. Repo /home/roan/Roan, geen push, geen tag.

Mic-knop in de composer (alleen als de runtime het toestaat), opname naar een lokale STT-provider (whisper.cpp of een geconfigureerde OpenAI-compat endpoint; geen cloud-key vereist als lokaal beschikbaar), transcript in de composer als concept. Provider-keuze via dezelfde pluginvorm als web (ABC + registry). Tests: provider-selectie, mislukte opname = eerlijke fout.

Bewijs: tests groen, suites groen, typechecks schoon.

AAN HET EINDE: 3 regels status + goal 12/34 letterlijk uit docs/goals-0.0.23.md.
```

## Goal 12 — import uit andere agents

```
Roan goal 12/34: importeren. Repo /home/roan/Roan, geen push, geen tag.

Importeer bestaande workspace-bestanden van andere agents (AGENTS.md, CLAUDE.md, .cursorrules, OpenClaw/SOUL-bestanden) in de eigen home: een importscherm dat kiest wat meegenomen wordt, schrijft als env-snapshot de keten op, en nooit een bestaand bestand overschrijft zonder bevestiging. Tests: parser per formaat, geen overschrijven, snapshot meereist.

Bewijs: tests groen, suites groen.

AAN HET EINDE: 3 regels status + goal 13/34 letterlijk uit docs/goals-0.0.23.md.
```

## Goal 13 — sturen tijdens een beurt

```
Roan goal 13/34: bijsturen midden in een beurt. Repo /home/roan/Roan, geen push, geen tag.

Naast Stop: een "steer"-pad dat een bericht aan een lopende beurt toevoegt als user-bericht ná de laatste tool-call (dezelfde vorm als Hermes: assistant(tool_calls) → tool → user), zonder de beurt te breken. UI: tweede knop naast Stop zolang de beurt loopt. Tests: steer komt aan, volgorde blijft geldig, geen tweede user-bericht achter elkaar.

Bewijs: tests groen, suites groen.

AAN HET EINDE: 3 regels status + goal 14/34 letterlijk uit docs/goals-0.0.23.md.
```

## Goal 14 — deep research

```
Roan goal 14/34: deep research. Repo /home/roan/Roan, geen push, geen tag.

Een research-modus die met de web-plugin werkt: meerdere zoekopdrachten, pagina's lezen met web_fetch, bronnenlijst met citaten, en een rapport dat als artifact in de sessie komt. Begrensd (max N zoekopdrachten, max tijd) en eerlijk over wat het niet vond. Tests: planner-lus met een stub-provider, bronnen-dedupe.

Bewijs: tests groen, suites groen.

AAN HET EINDE: 3 regels status + goal 15/34 letterlijk uit docs/goals-0.0.23.md.
```

## Goal 15 — device control tussen eigen nodes

```
Roan goal 15/34: eigen nodes besturen. Repo /home/roan/Roan, geen push, geen tag.

Een node mag een commando op een andere eigen node uitvoeren via de bestaande peer-verbinding (allowlist van commando's, altijd met goedkeuring, resultaat als ketenevent). Geen remote-control van vreemde machines, alleen eigen keten. Tests: allowlist, goedkeuring vereist, resultaat landt.

Bewijs: tests groen, suites groen.

AAN HET EINDE: 3 regels status + goal 16/34 letterlijk uit docs/goals-0.0.23.md.
```

## Goal 16 — zijvragen en message queueing

```
Roan goal 16/34: chat-flow. Repo /home/roan/Roan, geen push, geen tag.

Zijvragen: een vraag stellen zonder de hoofdcontext te vervuilen (aparte tijdelijke sessie, antwoord terug in de chat als citaat). Message queueing: berichten die je typt terwijl de agent werkt gaan in een wachtrij en worden na de beurt verstuurd, zichtbaar in de composer. Tests: queue-volgorde, zijvraag raakt hoofdcontext niet.

Bewijs: tests groen, suites groen.

AAN HET EINDE: 3 regels status + goal 17/34 letterlijk uit docs/goals-0.0.23.md.
```

## Goal 17 — delen en exporteren

```
Roan goal 17/34: delen. Repo /home/roan/Roan, geen push, geen tag.

Read-only deel-link voor een gesprek: een export die als zelfstandige HTML naast de keten gezet kan worden (lokaal bestand, geen upload), plus de bestaande markdown-export uitgebreid met een kop (datum, model, aantal beurten). Geen server, geen upload. Tests: HTML-export bevat alleen het gesprek, geen secrets.

Bewijs: tests groen, suites groen.

AAN HET EINDE: 3 regels status + goal 18/34 letterlijk uit docs/goals-0.0.23.md.
```

## Goal 18 — archief en tijdelijke chats

```
Roan goal 18/34: opruimen. Repo /home/roan/Roan, geen push, geen tag.

Archief (verbergen zonder wissen), verwijderen (tombstone-event, nooit hard delete), en tijdelijke chats die niet in de historie blijven (ephemeral vlag; events worden niet gepubliceerd). UI in de drawer. Tests: archief vouwt, tombstone verbergt, ephemeral publiceert niets.

Bewijs: tests groen, suites groen.

AAN HET EINDE: 3 regels status + goal 19/34 letterlijk uit docs/goals-0.0.23.md.
```

## Goal 19 — veiligheid

```
Roan goal 19/34: veiligheid. Repo /home/roan/Roan, geen push, geen tag.

Drie lagen: (1) OS-sandbox voor run_shell waar beschikbaar (bubblewrap/landlock op Linux, sandbox-exec op macOS) met een eerlijke fout als het niet kan; (2) elevated execution alleen na expliciete goedkeuring met een eigen audit-event; (3) injectie-bescherming: tool-resultaten en web-content worden gemarkeerd als data, nooit als instructie, met een test die een kwaadaardige pagina simuleert. Tests per laag.

Bewijs: tests groen, suites groen.

AAN HET EINDE: 3 regels status + goal 20/34 letterlijk uit docs/goals-0.0.23.md.
```

## Goal 20 — kennis: memory-zoek en projecten

```
Roan goal 20/34: kennis. Repo /home/roan/Roan, geen push, geen tag.

Memory-zoek: een tool die door memory-events en sessies zoekt (FTS in de chain-DB) en resultaten met bron teruggeeft. Projecten: een project is een map + instructies die als env-snapshot meereist; de agent kan een project kiezen en krijgt de instructies als context. Tests: zoekresultaten met bron, project-context in de prompt.

Bewijs: tests groen, suites groen.

AAN HET EINDE: 3 regels status + goal 21/34 letterlijk uit docs/goals-0.0.23.md.
```

## Goal 21 — commando's en hooks

```
Roan goal 21/34: commando's en hooks. Repo /home/roan/Roan, geen push, geen tag.

Slash/custom commands: een `command`-event met naam + prompt, in de composer met `/`, reist mee over de keten. Lifecycle hooks: plugin-hooks (pre/post tool, pre/post turn) via dezelfde plugin-context als tools. Tests: commando expandeert, hook vuurt met de juiste payload, een kapotte hook breekt de beurt niet.

Bewijs: tests groen, suites groen.

AAN HET EINDE: 3 regels status + goal 22/34 letterlijk uit docs/goals-0.0.23.md.
```

## Goal 22 — zelf als server en SDK

```
Roan goal 22/34: als server. Repo /home/roan/Roan, geen push, geen tag.

De control-API documenteren en stabiel maken (versie, auth, frames) als headless surface; een klein SDK-pakket in de repo (typed client) dat create/send/stream/state kan. Deferred tools: tool-definities kunnen lui geladen worden (naam+samenvatting eerst, schema op aanvraag). Tests: SDK-client tegen een wegwerp-daemon, deferred schema resolvet.

Bewijs: tests groen, suites groen.

AAN HET EINDE: 3 regels status + goal 23/34 letterlijk uit docs/goals-0.0.23.md.
```

## Goal 23 — zelflerende skills en modelrollen

```
Roan goal 23/34: leren en rollen. Repo /home/roan/Roan, geen push, geen tag.

Zelflerende skills: na een geslaagde taak kan de agent een skill-voorstel schrijven (SKILL.md) dat pas na goedkeuring actief wordt. Dual-model rollen: per taak een planner- en een uitvoerder-model (config), en een goedkoop model voor zijtaken (titels, samenvattingen) met dezelfde fallback-keten. Token-caching: provider-side caching respecteren (geen context-mutatie midden in een gesprek). Tests: skill-voorstel blijft inactief tot goedkeuring, rolkeuze per taak.

Bewijs: tests groen, suites groen.

AAN HET EINDE: 3 regels status + goal 24/34 letterlijk uit docs/goals-0.0.23.md.
```

## Goal 24 — browser

```
Roan goal 24/34: browser. Repo /home/roan/Roan, geen push, geen tag.

Een browser-tool via CDP (Chromium die de app zelf start of een bestaande endpoint): navigeren, lezen, klikken, screenshot. Alles lokaal, geen cloud. Availability via de tool-registry (check of CDP bereikbaar is). Tests: tegen een lokale testpagina; geen browser = eerlijke fout.

Bewijs: tests groen, suites groen.

AAN HET EINDE: 3 regels status + goal 25/34 letterlijk uit docs/goals-0.0.23.md.
```

## Goal 25 — computer use

```
Roan goal 25/34: computer use. Repo /home/roan/Roan, geen push, geen tag.

Screenshot + muis/toetsenbord op de eigen machine, alleen na expliciete goedkeuring per sessie (een `computer`-grant-event), met een zichtbare indicator zolang het aan staat. Linux-eerst (X11/Wayland via ydotool/xdotool waar beschikbaar), eerlijke fout elders. Tests: grant vereist, actie zonder grant geweigerd.

Bewijs: tests groen, suites groen.

AAN HET EINDE: 3 regels status + goal 26/34 letterlijk uit docs/goals-0.0.23.md.
```

## Goal 26 — generatie (beeld, video, muziek)

```
Roan goal 26/34: generatie. Repo /home/roan/Roan, geen push, geen tag.

Beeldgeneratie via dezelfde providerplug-invorm (ABC + registry): een lokale backend (ComfyUI of OpenAI-compat /images) en resultaat als bijlage in de chat. Video/muziek idem als aparte capability met dezelfde vorm. Geen cloud-verplichting; key-only providers alleen als geconfigureerd. Tests: provider-selectie, resultaat landt als bijlage.

Bewijs: tests groen, suites groen.

AAN HET EINDE: 3 regels status + goal 27/34 letterlijk uit docs/goals-0.0.23.md.
```

## Goal 27 — spraakgesprekken

```
Roan goal 27/34: praten. Repo /home/roan/Roan, geen push, geen tag.

Live spraakmodus: STT (uit goal 11) + TTS via een providerplug-in, met een gesprekslus die na elk antwoord weer luistert. Alleen op verzoek starten, altijd stopbaar. Tests: lus start/stopt, TTS-provider faalt = eerlijke melding.

Bewijs: tests groen, suites groen.

AAN HET EINDE: 3 regels status + goal 28/34 letterlijk uit docs/goals-0.0.23.md.
```

## Goal 28 — werkplek: bestanden en analyse

```
Roan goal 28/34: werkplek. Repo /home/roan/Roan, geen push, geen tag.

File library: de workspace bekijken en openen vanuit de app (lijst, preview, download), alleen binnen de workspace. Data-analyse: een tool die CSV/JSON leest en een chart-spec teruggeeft die de UI als grafiek rendert. Tests: paden buiten workspace geweigerd, chart-spec parse.

Bewijs: tests groen, suites groen.

AAN HET EINDE: 3 regels status + goal 29/34 letterlijk uit docs/goals-0.0.23.md.
```

## Goal 29 — code-intelligentie en git

```
Roan goal 29/34: code. Repo /home/roan/Roan, geen push, geen tag.

LSP-achtige code-intelligentie (definitie/verwijzingen via een taal-server als die er is, anders eerlijke "niet beschikbaar"), diffs in de UI voor tool-resultaten die bestanden wijzigen, git-paneel (status, stage, commit) en worktree-isolatie voor parallel werk. CI-koppeling: een knop die de laatste run-status van de repo toont als geconfigureerd. Tests: diff-render, git-status parse.

Bewijs: tests groen, suites groen.

AAN HET EINDE: 3 regels status + goal 30/34 letterlijk uit docs/goals-0.0.23.md.
```

## Goal 30 — surfaces

```
Roan goal 30/34: surfaces. Repo /home/roan/Roan, geen push, geen tag.

CLI/TUI over de control-socket (thin: chat, sessies, status), headless scripting-mode, keybinds/multiline in de app, natuurlijke-taal config ("zet het model op X"), accessibility (labels, focus), deep links (roan://session/<id>) en artifacts/canvas (een naastliggend document per sessie). Tests per surface waar zinvol (CLI-parse, deeplink-router).

Bewijs: tests groen, suites groen.

AAN HET EINDE: 3 regels status + goal 31/34 letterlijk uit docs/goals-0.0.23.md.
```

## Goal 31 — koppelingen

```
Roan goal 31/34: koppelingen. Repo /home/roan/Roan, geen push, geen tag.

Webhooks: inkomende trigger (signed) die een taak start; uitgaande webhook bij sessie-einde. Connectors: OAuth-accountvorm (begin met één echte: GitHub read-only) met tokens in secrets, nooit in de keten. A2A: minimaal protocol-stub met documentatie waarom het nog niet aan gaat. Tests: signature-check, token nooit gelogd.

Bewijs: tests groen, suites groen.

AAN HET EINDE: 3 regels status + goal 32/34 letterlijk uit docs/goals-0.0.23.md.
```

## Goal 32 — opruimen en documentatie

```
Roan goal 32/34: de puntjes. Repo /home/roan/Roan, geen push, geen tag.

Werk TODO.md en docs/feature-groups.md bij naar de echte stand (elke regel met bewijs), verwijder dode code en verouderde docs, en zorg dat elke nieuwe plugin/provider in docs staat met een voorbeeld. Root- en webtests volledig groen, beide typechecks schoon, build schoon.

Bewijs: suites groen, docs bijgewerkt, geen dode exports (tsc + grep).

AAN HET EINDE: 3 regels status + goal 33/34 letterlijk uit docs/goals-0.0.23.md.
```

## Goal 33 — de bewijsronde (emulator, adb, sync, apk)

```
Roan goal 33/34: alles bewijzen op een echt scherm. Repo /home/roan/Roan, geen push, geen tag.

Start emulator + mocks (mock-llm 9998, mock-mcp 9750), adb reverse/forward zoals eerder. Bewijs met screenshots in local/proof/round-0.0.23/: (1) de web-plugin zoekt echt en noemt een bron, (2) een foto in de chat, (3) een bestand >512 kB via het blob-kanaal en teruggevonden via adb in Download, (4) het meteen-goed-genoemde gesprek, (5) eigen bericht bewerken (tik bubbel → composer vult → aangepast verstuurd), (6) MCP-tool met approval, (7) de Sync-pagina met twee nodes. Daarna: apk 0.0.23 arm64 bouwen, md5 noteren, naar local/builds kopiëren. Tot slot de telefoon-check: type op de telefoon, zie het bericht op de server en andersom.

Bewijs: screenshots op schijf, apk + md5, sync in beide richtingen, suites groen.

AAN HET EINDE: 3 regels status + goal 34/34 letterlijk uit docs/goals-0.0.23.md.
```

## Goal 34 — de eindstaat

```
Roan goal 34/34: afsluiten. Repo /home/roan/Roan, geen push, geen tag.

Schrijf het eindrapport: wat er sinds goal 1 is gebouwd (per goal één regel met bewijs), wat bewust open bleef, en de volledige feature-groups-stand. Controleer dat de boom schoon is (git status), dat alle suites groen zijn, en dat local/builds de juiste apk bevat. Geef de filebrowser-links van de apk en de bewijsmap. Zeg expliciet dat er niets gepusht is en wat er nodig is om 0.0.23 te publiceren (push + tag v0.0.23).

Bewijs: suites groen, git schoon, apk-link + md5, bewijsmap-link.

AAN HET EINDE: 3 regels status. Geen volgend goal — de dag is klaar.
```
