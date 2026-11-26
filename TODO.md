# To do

Deze lijst is de takenlijst van het project. `WORK.md` beschrijft wat bewezen is en
wat de volgende stap is in gewone taal; hier staan de punten als afvinkbare taken
met de plek waar het werk zit. De volledige feature-vergelijking met andere agents
staat in `docs/feature-parity.md` — dit zijn de rondes die daaruit volgen.

Een punt gaat pas op `[x]` als het werkt — op een echte machine, of met een test
die de hele route aflegt — niet als de code is geschreven. Elk `[x]` hieronder
noemt het bestand en de test waar het op rust; bij een `[ ]` staat wat er nog
mist. Laatst tegen de code gelegd: 2026-11-26, op de 0.0.23-branch.

## Ronde 1 — het gesprek zelf (transcript-hygiëne)

- [x] **Interne context-stappen onzichtbaar.** ≥3 tools achtereen zijn één
      uitklapbare "internal steps N"-pilletje; bewezen op de emulator
      (`local/proof/round-1/steps-toggle-and-actions.png`). De "chat staat
      er 2×" bleek bovendien geen weergave- maar een echo-bug: de daemon
      stempelde het bericht met een eigen uuid, dus de pending-bubbel
      matchte nooit. Het id van de client reist nu mee.
- [x] **Denk-status altijd zichtbaar.** De turn-lock schreef turn_start/
      turn_end al in de keten maar de adapter broadcastte ze nooit — de
      dock bestond dus gewoon niet. Nu wel: bewezen in
      `thinking-dock-running-memory.png` ("Roan is working · running memory"
      + Stop). Stuck-melding (2 min stilte gerapporteerd, 5 min bekent)
      zit erin en is unit-getest; een live vastloper duurt per definitie
      minuten en is dus niet te screenshotten met een mock die instant is.
- [x] **Bericht-acties.** Copy op elk antwoord, Regenerate op het laatste:
      checkpoint markeert de seam, dezelfde vraag opnieuw, nieuw antwoord
      eronder, niets verwijderd. Bewezen in `regenerate-branch.png` en
      hard geassert op de host (smoke-round1).

## Ronde 1c — schone webversie, veilige sync (zien op de telefoon-web, 18 nov)

- [x] **Geen statusbalk-ruimte in de webversie.** De vaste vloeren (30/34px)
      leven alléén onder `.app-shell`, gezet bij boot als een shell
      wordt gedetecteerd (`main.tsx` + `shell.ts`). Bewezen: headless-Chromium
      op 412px breed — de header zit tegen de bovenkant, geen strook
      (`local/proof/round-1c`-reeks; de app op de emulator tekent
      rand-aan-rand achter de doorzichtige systeembalk).
- [x] **Icoontje even groot op elk scherm.** Eén maat: 26px voor
      `.titlebar__mark` en `.rail__mark`. Pixel-exact gemeten met een
      PNG-scan van twee emulator-schoten: 72×66 tegen 71×66 (1px
      antialias-ruis) — hetzelfde icoontje. Visie schatte hier eerst scheef;
      de meetlat won.
- [x] **Sync standaard alléén tailscale.** `ROAN_PEER_BIND`
      (tailscale|lan|loopback|adres; legacy `ROAN_PEER_HOST` blijft
      werken). Zonder tailnet-adres: loopback — de deur staat niet open op
      elk netwerk. Server-journal: `listening on 100.64.0.1:7412
      (tailscale)`.
- [x] **Invite zonder docker-ruis.** Interface-namen `docker*`/`br-*`/`veth*`
      gaan er nooit in. De verse invite draagt precies één route:
      `hosts: ["100.64.0.1"]`.

## Basis-hygiëne — geen features, wel de lat (altijd open)

Dingen die elk referentieproduct gewoon heeft. Geen roadmap-werk, maar
kleine gaten die dicht moeten zodra ze boven komen — zie de "two lanes"
sectie in `docs/feature-groups.md` voor de volledige basislijst.

- [ ] **Eigen bericht bewerken.** Regenerate zit erin; een tikje op je eigen
      bubbel om te verbeteren en opnieuw te sturen nog niet. (chat-apps, ronde 1-nazorg)
- [x] **Sessies hernoemen.** Potlood per gesprek in de drawer; een
      `session_title`-event in de keten (append-only, reist mee, vouwt in
      de index). Live bewezen op de server met een wegwerp-thuis:
      voor `["New chat","Oud"]` → na `["New chat","Ronde 1c","Oud"]`.
      Onderweg een echte protocol-bug gevonden en gedicht: de generieke
      onRequest-vanger slikte het frame in vóór de eigen handler
      (`67811a9`, regressietest in `control.test.ts`). Op de emulator
      rendert invoer en potlood; de Enter via adb's synthetische toets
      werd door Gboard opgegeten, dus daar reed het bewijs via de
      directe frame-toets.
- [x] **Sessies zoeken.** Ctrl-K opent de drawer op het zoekveld en de filter
      matcht titels én berichttekst (`web/src/App.tsx`, `sessionText`), over de
      events die de client heeft (de eerste 10.000). `src/chain/search.ts` doet
      hetzelfde als pure module met tests, maar de UI gebruikt die nog niet.
- [x] **Export/backup-knop.** ⤓ per gesprek in de drawer (markdown, mét de
      hernoemde titel) en "Export the whole chain" op de Sync-pagina (JSONL).
      Beide ook naar de Android download-map als het storage-venster open
      staat. Bewezen: bestand teruggevonden via adb in
      /storage/emulated/0/Download. (0.0.19)
- [x] **Notificatie als beurt klaar is.** De foreground service tailt de
      log op de "notify:turn-done"-regel en tikt "Roan is done". (0.0.19)
- [x] **Midden-beurt sturen.** Stop bestaat en bijsturen nu ook: een bericht
      tijdens een beurt wordt ná de tool-resultaten en vóór de volgende request
      ingevoegd (`src/turn/steer.ts`, `steer`-frame, `onSteer` in de composer),
      en staat als `message` met `steer: true` in de keten.
      `steer.test.ts`, `turn-runner.test.ts`.
- [x] **Bijlagen buiten de workspace** (foto's). De composer heeft een
      Photo-knop: de foto wordt vóór verzenden naar 1024px jpeg
      geschroond, reist als base64 op het bericht-event en verschijnt in
      de bubbel. Bewezen 0.0.20: emulator-screenshot met de bewijsfoto
      zichtbaar in de chat. Bestanden (niet-foto's) boven 512 kB gaan sinds
      deze branch via het blob-kanaal — zie "Bestanden boven 512 kB" onder
      Keten en sync.
- [x] **Gebruik per beurt.** Tokens en kosten reizen op het `turn_end`-event en
      staan als regel onder het antwoord (`src/usage.ts`, `usageLine` in
      `Transcript.tsx`); `tests/turn-usage.test.ts`. Een sessietotaal is er niet.
- [ ] **Tijdelijke chats** die niet in de historie blijven. De fold kent
      `ephemeral` (`src/chain/sessions.ts`) maar niets schrijft het en er is
      geen knop.
- [ ] **Gesprek delen** als read-only link. Het bestanddeel is er: de export
      schrijft markdown én één zelfstandige, geëscapete HTML-file
      (`src/chain/export-html.ts`). Er is geen host en geen intrekbare link.
- [ ] **API-sleutel buiten de keten.** `settings_save` schrijft `apiKey` in
      `config.json` (`src/daemon/settings-write.ts`) en `config.json` zit in de
      env die `publishEnv` elke 10 s in de keten zet (`env-sync.ts`,
      `env/types.ts`) — dus de sleutel reist mee naar elk device en staat in elke
      `chain.db`. Versleuteld is hij ook niet: het bestand is gewoon JSON op
      0600. Nodig: de sleutel naar `secrets/`, of een strip in de packer. Zie
      `docs/security.md` §1.

## SOON-golf — de agent krijgt handen (0.0.20)

- [x] **Web search als tool.** `web_search` in de toollijst: https-only,
      antwoorden als citaten-lijst (titel, url, snippet). DuckDuckGo's
      lite-endpoint is het primaire spoor; vanaf datacenter-IP's muurt
      DuckDuckGo (202-bot-wall), dus er is een gegarandeerde Wikipedia-
      fallback (nl, dan en) die altijd citeerbaar antwoordt en dat ook
      zegt. Bewezen: emulator-beurt waar de agent de tool aanroept en
      antwoordt mét bron `nl.wikipedia.org/wiki/Hanze`.
- [x] **Web fetch als tool.** `web_fetch` leest één pagina tot 64 kB in
      10 s en geeft de leesbare tekst; privé- en loopback-adressen
      geweigerd, https-only.
- [x] **MCP echt starten** en **learned approvals**. `McpRuntime` dialt elke
      ingeschakelde server per beurt (http en stdio, `src/mcp/client.ts`) en de
      tools gaan door dezelfde regels; een allow wordt een `tool_approval`-event
      en de volgende keer vraagt hij niet meer. `mcp/client.test.ts`,
      `chain/gates.test.ts`.
- [x] **Per-tool regels**: aan/uit per tool en of hij vragen moet stellen, in een
      scherm en meereizend over de keten. `tool_rule`-events, gezet door de
      Tools-pagina (`ToolsPanel.tsx`, `tool_rule`/`tools_state` in `main.ts`).
      `chain/gates.test.ts`.

## Ronde 2 — de agent-home (workspace-verbouwing)

- [x] **Slogan: "One agent, everywhere".** Op het onboarding-scherm en de
      About-pagina (0.0.17).
- [x] **Tab "Devices" heet voortaan "Sync".** De pagina toont élke node in
      de keten — naam, adres, live-stip, "this device"-tag — en de gebruiker
      hernoemt met het potlood: de nieuwe naam is het volgende aankondigings-
      event, dus elk toestel vouwt hetzelfde rooster (bewezen: twee
      wegwerp-daemons in beide richtingen, en de emulator-drive hernoemde
      "localhost" → "Emulator-node" door de echte UI). "Node" richting de
      gebruiker, "daemon" in code en logs. Bonus: Ctrl-K opent de drawer op
      het zoekveld en zoek vindt ook berichttekst, niet alleen titels.

- [x] **`~/.Roan` met hoofdletter.** `paths.ts` hernoemt een bestaand `~/.roan`
      één keer bij de start (`migrateLegacyHome`), `RoanNode.kt` doet hetzelfde
      vóór `ROAN_HOME` op Android, en de keten-db verhuist tegelijk naar
      `state/` (`migrateStateSplit`). `tests/paths-migration.test.ts`.
- [x] **`state/` nieuw.** chain.db verhuist bij de start naar `~/.Roan/state/`
      (WAL en SHM mee, één keer, niets gekopieerd). `workspace/` is de agent z'n
      eigen bureau; `synced-workspace/` blijft de map waarvan de inhoud als
      events reist. Bewezen: server (keten-id vóór = ná) én Android (zelfde
      install, keten-id `529f8283` ongewijzigd, workspace daarna leeg).
- [x] **`storage/`-venster op Android.** Settings → "Storage window" → de
      daemon zet symlink-siblings (`shared/ downloads/ dcim/ documents/
      pictures/ music/`) náást `.Roan` in `files/`, het Termux-patroen, en
      weigert met een duidelijke reden als All files access ontbreekt
      (MANAGE_EXTERNAL_STORAGE zit in de build). Puur getest; de echte grant
      test de eigenaar op z'n telefoon.
- [ ] **Schrijfstijl-skill upstream.** `skills/writing-style/` staat **niet** in de
      repo (gecontroleerd: `src/skills/` heeft alleen fold/parse/proposal; er is
      geen top-level `skills/`). Wat er wel is: de eerste start schrijft SOUL.md,
      IDENTITY.md en AGENTS.md en de turn-prompt draagt ze als "Who you are" en
      de regels (`bootstrap.ts`, `context/prompt.ts`). Wat mist: de geclonede
      skill met remote `upstream` → `github.com/roanh47/Roans-Writing-Style-Skill`.
- [x] **Foreground service op Android.** De service bezit de daemon met een
      zichtbare notificatie ("Roan is running — One agent, everywhere"); de app
      dicht op de achtergrond en de node ademt door (bewezen: state via adb
      forward met de app dicht). Een beurt die klaar is terwijl de app dicht
      is, meldt "Roan is done" — de daemon markeert het moment met een
      logregel die de service tailt. (0.0.19)

## Schrijfstijl

- [x] **Mijn schrijfstijl, hardcore.** SOUL.md, IDENTITY.md en AGENTS.md worden
      bij de eerste start geschreven (nooit over een eigen bewerking heen) en
      reizen mee in de env-snapshot. De turn-prompt draagt ze als twee blokken —
      "Who you are" en "How you write — a rule, not a suggestion" — en het
      regelbloek zegt zelf: elk antwoord wordt er afgemeten. Bewezen: server
      publiceerde de snapshot naar de keten, dus de telefoon vouwt dezelfde
      gids bij de eerstvolgende sync.

## Telefoon is een node

- [x] **Daemon in de apk.** `libnode.so` zit in `jniLibs` (arm64-v8a + x86_64), de
      JNI-brug en `start-node.cpp` in `src-tauri/android/`, de gebundelde daemon
      als `assets/roan-daemon.js` (geladen door `RoanNode.kt`), gewired door
      `scripts/android-daemon.sh` (ook in `build-local.sh` en de Android-CI-job).
      In `local/builds/Roan-0.0.23-arm64.apk` staan `lib/arm64-v8a/libnode.so` en
      `assets/roan-daemon.js` (met `unzip -l` gecontroleerd). Dat hij op een
      toestel ook start is het punt hieronder.
- [ ] **Installeren en een keten beginnen op de telefoon.** Apk erop, app open,
      create a chain, en `roan-daemon.log` in de app-data laten zien dat de
      daemon daar draait.
- [x] **Foreground service** zodat de daemon blijft draaien als de app weg is —
      zie het punt hierboven: `RoanService.kt` bezit de node met een zichtbare
      notificatie, en met de app dicht antwoordt de daemon nog (0.0.19).
- [ ] **Sync tussen telefoon en server bewijzen** met beide online.
- [x] **Share-sheet** en de notificatiechannel zoals in `docs/mobile.md`.
      Bewezen 0.0.20: ACTION_SEND text/plain staat in het manifest van de
      apk, koude én warme bezorging parkeren in de one-slot inbox
      (logcat `RoanShare: parked`), en de composer toont de tekst als
      prefill. Onderweg een echte bug gevonden: `onCreate` shadowde de
      launch-intent met de service-intent, dus een koude share parkeerde
      niets — `getIntent()` is het geworden (`9eada5e`).

## v0.0.2

Alles hieronder is lokaal gebouwd en getest, niet gepusht. Een versie gaat pas
naar GitHub als Roan hem zelf op zijn machines heeft gehad.

- [ ] **Updater in de app.** De plugin, de publieke sleutel en het feed-adres
      staan in `tauri.conf.json` en `web/src/update.ts` is getest — maar de tegel
      (`UpdateCard.tsx`) zit in `SettingsPanel`, dat nergens gemount is, en de
      About-pagina toont alleen de versie. Er is dus nog geen scherm dat hem
      aanbiedt. Op Android is er geen apk-updatepad: `installUpdate` is de
      Tauri-updater (desktop), er is geen download-and-install van een apk.
- [x] **Signeersleutel.** Keypair gegenereerd, publieke sleutel in
      `tauri.conf.json`, privésleutel en wachtwoord in de CI-secrets
      (`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`).
- [ ] **Update-feed als aparte release** met vaste tag `update-feed`, zodat
      `latest.json` altijd dezelfde URL houdt en de versie-release precies vier
      bestanden blijft houden. `src/packaging/update-feed.ts` kan dat bestand
      lezen en schrijven (`update-feed.test.ts`), maar niets roept het aan en
      `.github/workflows/release.yml` publiceert die tag niet — die bouwt alleen
      de vier installatiebestanden bij een versietag.
- [ ] **Updater echt testen** met een tweede versie: 0.0.1 erop, 0.0.2 publiceren,
      knop indrukken, kijken of hij bijwerkt en herstart.
- [x] **RUN THIS FIRST in de dmg.** `scripts/dmg/RUN THIS FIRST.command` zet de
      app in Applications, haalt de quarantine-vlag weg en opent hem.
      `scripts/dmg/build-dmg.sh` bouwt de dmg met dat bestand erin.
- [ ] **Die dmg bouwen en testen op de Mac.** Moet op macOS gebeuren, de server
      kan geen .app of dmg maken.
- [ ] **App-icoon van de profielfoto.** De set is gegenereerd uit
      `src-tauri/icons/icon-source.jpg` met `scripts/make-icons.py`: de foto zelf
      op Windows/Linux/Android, en op macOS dezelfde foto in de gewone
      afgeronde-vierkantvorm (824 van 1024, radius 185), niet bijgesneden. Nog
      niet gezien op alle vier de platforms.
- [ ] **Alles lokaal leveren** via Filebrowser in plaats van GitHub-releases,
      zolang een versie nog niet getest is.

## Updates

Dezelfde punten als onder v0.0.2, hier met de stand van de code erbij.

- [ ] **Updater voor alle vier de installaties.** Desktop: plugin + feed-adres
      staan klaar (`tauri.conf.json`, `web/src/update.ts`). Android: geen
      apk-updatepad in deze code, dus daar werkt het nog niet.
- [x] **Signeersleutel voor de updater.** Publieke sleutel in
      `tauri.conf.json` (`plugins.updater.pubkey`), privésleutel en wachtwoord in
      de CI-secrets (`release.yml`).
- [ ] **Update-feed.** `.github/workflows/release.yml` publiceert geen
      `latest.json` en geen `update-feed`-tag; alleen de vier
      installatiebestanden per versietag.
- [ ] **Knop in de app.** `UpdateCard.tsx` bestaat en is getest, maar zit in
      `SettingsPanel` dat niets mount; de About-pagina toont alleen de versie.
- [ ] **Android-update.** Geen download- en installatiepad voor een apk: het
      manifest heeft geen `REQUEST_INSTALL_PACKAGES` en er is geen
      PackageInstaller-code.

## Releases

- [ ] **Slankere apk.** De zwaarste build was 455 MB (debug, vier
      architecturen). Een per-ABI release-build is nu 93 MB
      (`local/builds/Roan-0.0.23-arm64.apk`); het doel van 40–60 MB is nog niet
      gehaald.
- [ ] **Apk echt installeren** op de telefoon en laten starten — de x86_64-build
      draait op de emulator (`local/proof/round-0.0.23/app-running.png`) en de
      apk's worden gebouwd (t/m 0.0.23), maar de start op een echt toestel staat
      nergens vast.
- [ ] **Ondertekenen van de desktop-apps.** `src/packaging/notarize.ts` plant de
      notarisatiestappen en `msix.ts` rendert een manifest (beide met tests),
      maar `tauri.conf.json` heeft geen `signingIdentity` of
      Windows-certificaat, niets roept die modules aan en er wordt niets
      ondertekend; zonder dat waarschuwen SmartScreen en Gatekeeper bij elke
      nieuwe gebruiker.

## Keten en sync

- [x] **Seq-conflicten bij meer dan twee devices.** Twee devices die tegelijk
      schrijven pakken hetzelfde seq; in plaats van de link op `conflicted` te
      zetten houden ze hun eigen branch en zet `compareBranches` de siblings in
      één totale orde (ts, dan node, dan id) die elke node hetzelfde uitrekent.
      `src/sync/order.ts`, `order.test.ts`, en de 3/4-writer-tests.
- [ ] **Discovery op twee online machines bewijzen.** De code is er
      (`src/daemon/discovery.ts`, Tailscale-scan + probe, `discovery.test.ts`);
      een run met twee echte machines staat niet in `local/proof/`.
- [x] **Bestanden boven 512 kB.** Het blob-kanaal: een groot of binair bestand
      reist als gehashte `blob`-chunks en de `workspace`-put verwijst naar de
      hash (`src/workspace/blob.ts`, `publishWorkspace` in `main.ts`).
      `workspace/blob.test.ts`, `workspace/sync.test.ts`.
- [ ] **Tests voor env, relay en workspace-sync tussen twee daemons** in de
      suite. `tests/integration/two-daemons.test.ts` start twee daemons en
      bewijst alleen dat ze op dezelfde head uitkomen; env, relay en
      workspace-sync worden daar niet geassert.

## App

- [x] **Checkpoints in de UI.** Lijst met punten en een knop om terug te
      springen. De chat heeft de 📌-knop per antwoord (de titel van het
      gesprek als label), het panel onder Settings toont de punten mét
      "Go back here"-knop. Bewezen 0.0.20: emulator-screenshot van het
      panel met "Poortvraag bewijs" (#13) en de terugknop.
- [x] **Workspace bekijken en openen** vanuit de app, niet alleen syncen. De
      Workspace-pagina lijst de bestanden, toont een preview, laat tekst
      bewerken en opslaan (dat reist meteen mee) en biedt een download-link
      (`WorkspacePanel.tsx`, `workspace_list`/`workspace_read`/`workspace_write`).
      `WorkspacePanel.test.tsx`.
- [x] **MCP-configuratie in de app**, met een scherm en de config die over de
      keten meereist. De Tools-pagina zet servers op (`mcp_server_save`/
      `mcp_server_delete` worden `mcp_server`-events) en de daemon dialt ze.
      `ToolsPanel.tsx`, `chain/gates.test.ts`.
- [x] **Titel van een nieuw gesprek** meteen goed zetten. Het eerste bericht
      hernoemt de sessie via `autoTitleFor` → `session_title`, en een verse
      keten opent met "New chat" in plaats van een lege lijst (`main.ts`,
      `chain/sessions.test.ts`).
- [ ] **Oude foutregels** uit het transcript halen zodra een beurt opnieuw lukt.
      Wat er is: twee identieke foutregels na elkaar worden één
      (`Transcript.tsx`); een geslaagde herkansing ruimt de oude regel niet op.

## Later

- [ ] Android-app als volwaardige node, voor zover het besturingssysteem een
      achtergrondproces toestaat.
- [ ] Relay voor een keten waarin niet elk device elk device ziet.

## Uit de GitHub-issues

Deze lijst is overgenomen uit de open issues van `roanh47/Roan` (13 stuks, stand
november 2026), zodat alles op één plek staat. Het nummer erbij is het issuenummer.

### Geldt nog voor deze app

- [ ] **#18 De basiskennis bijwerken vanaf één plek.** Eén canonieke bron voor wat
      Roan weet, met een cache lokaal, in plaats van vier losse bestanden die uit
      elkaar kunnen lopen. Wat er is: `MEMORY.md` wordt gevouwen uit
      `memory`-events (`context/memory-md.ts`) en `src/knowledge/` heeft een
      project- en zoekmodule met tests. Wat mist: die kennis als tool of in de
      prompt, en één bron boven de losse bestanden.
- [ ] **#17 Zonder API-sleutels dingen bereiken.** Alleen lezen, alleen anonieme
      webaanroepen: GitHub nu, OneDrive en een publieke URL later. Geen
      credentials in de keten. Wat er is: `src/connectors/github.ts` leest issues
      en bestanden read-only, maar met een token uit `secrets/` en zonder route
      in de daemon — dus geen anoniem pad en nog niet bereikbaar.
- [x] **#11 Sessie exporteren** als markdown of JSON, zodat een gesprek deelbaar
      is. De export schrijft markdown, één zelfstandige HTML-file en JSONL voor
      de hele keten (`chain/export-markdown.ts`, `chain/export-html.ts`,
      `chain/export.ts`), per gesprek en voor de keten.
- [ ] **#10 MCP-servers automatisch vinden** in de gebruikelijke configmappen in
      plaats van ze met de hand aanwijzen. `src/import/discover.ts` vindt
      instructiebestanden (AGENTS.md, CLAUDE.md, …), geen MCP-configuratie.

### Vervallen, hoort bij de oude TUI/Python-versie

Deze zijn geschreven voor de harness met een terminalinterface. Die bestaat niet
meer, dus ze gaan dicht zodra je zegt dat het mag.

- **#1** Roan meer laten lijken op opencode of claude code: gaat over de TUI, en
  er is geen TUI meer.
- **#6** Web UI channel: bestaat al, dat is `scripts/webui.mjs` op poort 6769.
- **#7** Meer kanalen dan Telegram: de app is het kanaal geworden.
- **#8** Theme polish voor de vier Catppuccin-varianten in de TUI.
- **#9** TUI accessibility: toetsenbordhulp en screenreaders in de terminal.
- **#12** Plugin API-documentatie voor Python-plugins.
- **#5** PyPI-naam `roan`: inmiddels gepubliceerd als `Roan47`.
- **#14** Tien jaar zonder update, alles live: de app haalt providers en modellen al
  live uit models.dev, dus dit is ingelost.
- **#16** Identiteit en opslag in `~/.Roan` met hoofdletter: **besloten
  2026-11-18 — hoofdletter wint, en geïmplementeerd.** `paths.ts` heet de map
  `.Roan` op elk platform en hernoemt een bestaand `~/.roan` één keer bij de
  start; Android doet hetzelfde in `RoanNode.kt` vóór `ROAN_HOME`. Zie het punt
  onder ronde 2.

