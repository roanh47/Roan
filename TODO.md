# To do

Eén lijst, per versie. Een vinkje betekent: het werkt en het is bewezen — op een
echte machine of met een test die de hele route aflegt. Wat een versie niet haalt,
schuift naar de volgende; er is geen tweede lijst.

De volledige vergelijking met Hermes staat met vinkjes in
`docs/feature-parity.md` (§ Samenvatting).

## 0.0.29 — volgende release

- [ ] **Eén build, één waarheid.** Elke build is dezelfde app: een frontend die
      met de daemon **op dat apparaat** praat, op **dezelfde poort**. Geen enkele
      shell (Android-Kotlin, Tauri-sidecar, systemd-unit) zet host, poort of de
      control-gate — die defaults zijn van de daemon en gelden overal gelijk.
      Klaar als een `grep` in `src-tauri/`, `scripts/` en de unit-files geen
      host/poort-override meer vindt, de gegenereerde
      `gen/android/.../RoanNode.kt` niet als oude kopie in de boom staat, en de
      app op alle vier de platformen `localhost:6769` dialt.
- [ ] **De daemon is bereikbaar of het is een bug.** De app en de daemon komen
      uit dezelfde build op hetzelfde apparaat, dus "onbereikbaar" hoort niet te
      bestaan: geen wachtscherm, geen retry-lus. Als het tóch gebeurt, is dat een
      fout met een reden in de daemon-log en één regel in de UI — geen banner die
      blijft staan.
- [ ] **Gedachten zichtbaar en uitklapbaar.** De dock zegt nu alleen dát hij
      denkt. De redenering zelf moet opgevangen worden (de reasoning-delta's van
      de provider, niet de zichtbare tekst), als apart `reasoning`-deel in de
      beurt bewaard worden en in het transcript als inklapbaar "Thought"-blok
      verschijnen — dichtgeklapt by default, open te klikken, en nooit
      meegestuurd als gewoon antwoord. Levert een provider het niet, dan is er
      geen blok (en geen leeg blok).
- [ ] **Libnode niet twee keer initialiseren.** De log van de telefoon toont
      `Assertion failed: !init_called.exchange(true)` en
      `pthread_mutex_lock called on a destroyed mutex`: de Node-runtime start
      twee keer in hetzelfde proces en de app stort dan af. Eén keer starten, of
      het hele proces herstarten — nooit een tweede runtime in hetzelfde proces.

## Daarna

- [ ] **Libnode per ABI meebundelen** (of per-ABI splitsen): de universele apk
      heeft alleen arm64-libnode, dus op een x86_64-emulator start geen daemon.
- [ ] **Echte responsiviteit** voor pc/tablet/telefoon als geheel.
- [ ] **Admin-instelling in de app** bovenop `src/sudo/install.ts`.
- [ ] **Eigen bericht bewerken** — de handler bestaat; het bewijs ontbreekt.
- [ ] **Tijdelijke chats** die niets publiceren en niet in de historie blijven.
- [ ] **Gesprek delen** als read-only link; de export bestaat, de link niet.
- [ ] **API-sleutel naar `secrets/`** in plaats van in `config.json`.
- [ ] **Bewijsronde afmaken:** de zeven feature-screenshots en een blob boven
      512 kB die via adb terugkomt.
- [ ] **Slankere apk** (162 MB universeel debug → release + ABI-splitsing).
- [ ] **Discovery en sync met twee online machines bewijzen.**
- [ ] **Oude foutregels** uit het transcript halen zodra een beurt weer lukt.
- [ ] **Schrijfstijl-skill upstream** als bestand in de repo.
- [ ] **Eén poort live bewijzen** op emulator én telefoon (gesprek + sync).
- [ ] **Windows- en macOS-certificaat** (code-signing / Apple Developer ID).
- [ ] **MCP-servers automatisch vinden** (#10).
- [ ] **Basiskennis vanaf één plek** bijwerken (#18).
- [ ] **Zonder API-sleutels lezen** (#17).
- [ ] **Relay** voor een keten waarin niet elk device elk device ziet.
- [ ] **App-icoon** van de profielfoto.
- [ ] **Update-feed als losse release** — bekijken of `latest.json` iets toevoegt.
- [ ] **MSIX/Store-kanaal** naast de MSI, met de updater uit in die build.

## Nog niet gebouwd (vergeleken met Hermes, Claude Code, Grok, Codex)

Deze staan nog in geen enkele sectie omdat ze groter zijn dan een punt:

- [ ] **Kanalen** — Telegram, Discord, Slack, Signal, WhatsApp, mail. Hermes is
      hier omheen gebouwd; Roan heeft er nul. Dit is de grootste leemte.
- [ ] **Terminal-surface** — een echte TUI naast de app (Claude Code's
      thuisbasis), zodat de agent ook in een shell te bedienen is.
- [ ] **IDE-koppeling** — VS Code/JetBrains-extensie die dezelfde daemon gebruikt.
- [ ] **Plugin-catalogus** — een marktplaats met manifesten, versies en
      installatie uit de app (Hermes' marketplace; wij hebben alleen de loader).
- [ ] **Meerdere profielen** — geïsoleerde homes naast elkaar in één installatie.
- [ ] **Geheugen-curator** — een achtergrondproces dat memory en skills opruimt,
      consolideert en verouderde feiten voorstelt te verwijderen.
- [ ] **Prompt-caching en compressie als beleid** — naast `compactMessages` ook
      cache-bewuste prefixen per provider.
- [ ] **Live databronnen** — X/Twitter, nieuws, beurs; Grok leeft daarvan, wij
      hebben alleen web_search en web_fetch.
- [ ] **Cloud-sandbox en PR-flow** — een run in een wegwerp-container die een
      branch + pull request oplevert (Codex/Claude Code).
- [ ] **Worktree-isolatie** — elke taak in een eigen git-worktree.
- [ ] **Push-notificaties** bij een achtergrondtaak of klaar-zijnde beurt.
- [ ] **Kosten-totaal per sessie en per maand**, niet alleen per beurt.
- [ ] **Bestandsbijlagen groter dan 8 MB** — nu reist dat niet mee.
- [ ] **Semantisch zoeken over de keten** (embeddings), niet alleen substring.

## Afgerond

- **0.0.31** — de shell overschrijft de daemon-defaults niet meer.
- **0.0.30** — de telefoon luistert op de tailnet (binding kwam van de daemon).
- **0.0.29** — een config zonder sleutel wist de lokale sleutel niet meer.
- **0.0.28** — de app kan zijn eigen daemon weer bereiken (tokenloze `hello`).
- **0.0.27** — composer gecentreerd, insets via de shell, rail open op breed,
      banner met Retry, new chat, `node_remove`, file explorer, `access.fullDisk`,
      sudo via een smalle allowlist.
- **0.0.26** — de gebundelde daemon sterft niet meer op een ongeldige file-URL.
- **0.0.25** — één poort (6769), MSI in plaats van exe, vast Android-certificaat.
- **0.0.24** — eerste release met één vaste Android-sleutel en GitHub-updates.
- **0.0.23** — 34 features gebouwd; new chat opent zichzelf.
- **0.0.22** — foto's door de keten, checkpoints, share-sheet.
- **0.0.21** — echte MCP-client, approval-banner, export met bijlagen.
- **0.0.20** — web-tools via plugins, env/skills/workspace als inhoud.
