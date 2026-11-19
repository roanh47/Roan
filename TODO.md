# To do

Deze lijst is de takenlijst van het project. `WORK.md` beschrijft wat bewezen is en
wat de volgende stap is in gewone taal; hier staan de punten als afvinkbare taken
met de plek waar het werk zit. De volledige feature-vergelijking met andere agents
staat in `docs/feature-parity.md` — dit zijn de rondes die daaruit volgen.

Een punt gaat pas op `[x]` als het werkt op een echte machine, niet als de code is
geschreven.

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
- [ ] **Sessies zoeken.** Ctrl-K door de eigen geschiedenis. (ronde 2a: state/ maakt het één query)
- [ ] **Export/backup-knop.** Al ontworpen, nog geen knop. (ronde 2b)
- [ ] **Notificatie als beurt klaar is.** (ronde 2b: foreground service)
- [ ] **Midden-beurt sturen.** Stop bestaat; antwoord bijsturen terwijl hij
      denkt nog niet. (SOON)
- [ ] **Bijlagen buiten de workspace.** Foto's/bestanden uitkiezen die niet
      in `.Roan` liggen. (na de Android storage-ronde)
- [ ] **Gebruik per beurt.** Tokens/kosten zichtbaar onder een antwoord. (SOON)
- [ ] **Tijdelijke chats** die niet in de historie blijven. (LATER)
- [ ] **Gesprek delen** als read-only link. (LATER)

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

- [ ] **`~/.Roan` met hoofdletter.** Code, migratie en docs zitten erin:
      `paths.ts` hernoemt een bestaand `~/.roan` één keer bij de start,
      `RoanNode.kt` doet hetzelfde vóór `ROAN_HOME` op Android. Bewijs rijdt
      mee in de 0.0.13-emulatorronde (verse install start in `.Roan`).
- [ ] **`state/` nieuw.** chain.db + cron-state verhuizen uit `workspace/`;
      `workspace/` wordt de lokale agent-home (exec-cwd-keuze: privé of synced).
      Rolverdeling wordt dan éénduidig: `workspace/` = wat de agent zelf
      schrijft en doet (privé per toestel, of als exec-cwd), `synced-workspace/`
      = de map waarvan de *inhoud* als events over de keten reist — bestanden
      die op elk toestel hetzelfde zijn. Nu is het grensje vaag omdat chain.db
      nog in `workspace/` woont; dat is precies wat hier verdwijnt.
- [ ] **`storage/`-venster op Android.** Achter de "All files access"-toggle:
      symlink-siblings (`shared/ downloads/ dcim/ documents/ pictures/ music/`)
      náást `.Roan` in `files/` — het Termux-patroon; `files/` is de user-home.
- [ ] **Schrijfstijl-skill upstream.** `skills/writing-style/` gecloned in de repo,
      remote `upstream` → `github.com/roanh47/Roans-Writing-Style-Skill`, als
      regel geladen in de turn-prompt — zie ook het schrijfstijl-punt boven.
- [ ] **Foreground service op Android.** Daemon overleeft een gesloten app;
      daarna pas: notificatie als beurt klaar is.

## Schrijfstijl

- [ ] **Mijn schrijfstijl, hardcore.** Roan antwoordt in mijn eigen stijl, niet in
      standaard AI-proza: kort, direct, geen managementtaal, geen "zeker, ik kan je
      helpen"-opening. De gids staat in `~/.Roan` (`SOUL.md` / `AGENTS.md`) en reist
      als env mee, zodat elke instance hetzelfde schrijft. Niet als suggestie in de
      prompt, maar als regel die je aan een antwoord kunt afmeten.

## Telefoon is een node

- [ ] **Daemon in de apk.** `libnode.so` in `jniLibs`, de JNI-brug
      (`src-tauri/android/`) en de gebundelde daemon in `assets`, gewired door
      `scripts/android-daemon.sh` (ook in `build-local.sh` en de Android-CI-job).
      De bundel is bewezen op gewone Node: lege `ROAN_HOME` geeft
      `onboarding:true`, `create_chain` maakt een echte keten. Nog niet op het
      toestel zelf.
- [ ] **Installeren en een keten beginnen op de telefoon.** Apk erop, app open,
      create a chain, en `roan-daemon.log` in de app-data laten zien dat de
      daemon daar draait.
- [ ] **Foreground service** zodat de daemon blijft draaien als de app weg is.
- [ ] **Sync tussen telefoon en server bewijzen** met beide online.
- [ ] **Share-sheet** en de notificatiechannel zoals in `docs/mobile.md`.

## v0.0.2

Alles hieronder is lokaal gebouwd en getest, niet gepusht. Een versie gaat pas
naar GitHub als Roan hem zelf op zijn machines heeft gehad.

- [x] **Updater in de app.** `tauri-plugin-updater` plus een tegel in de
      instellingen: versie tonen, controleren, downloaden, installeren en
      herstarten. Kruist de feed op GitHub, dus werkt op Windows, macOS, Linux en
      Android.
- [x] **Signeersleutel.** Keypair gegenereerd, publieke sleutel in
      `tauri.conf.json`, privésleutel en wachtwoord in de CI-secrets
      (`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`).
- [x] **Update-feed als aparte release** met vaste tag `update-feed`, zodat
      `latest.json` altijd dezelfde URL houdt en de versie-release precies vier
      bestanden blijft houden.
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

- [ ] **Updater voor alle vier de installaties.** De app haalt de laatste versie
      op uit de GitHub-releases en kan zichzelf bijwerken op Windows, macOS,
      Linux en Android.
- [ ] **Signeersleutel voor de updater.** Privésleutel in de CI-secrets, publieke
      sleutel in `tauri.conf.json`, zodat een update alleen van jou kan komen.
- [ ] **Update-feed.** De `latest.json` en de updatebundels worden per versie
      gepubliceerd, los van de vier installatiebestanden in de release.
- [ ] **Knop in de app.** Instellingen toont de versie, kan controleren en kan
      installeren zonder de terminal.
- [ ] **Android-update.** De apk downloaden en de installatie starten, met de
      vraag om onbekende bronnen.

## Releases

- [ ] **Slankere apk.** Nu 455 MB door debug en vier architecturen. Doel: 40 tot
      60 MB met een release-build en ABI-splitsing per toestel.
- [ ] **Apk echt installeren** op de telefoon en laten starten.
- [ ] **Ondertekenen van de desktop-apps.** Zonder certificaat waarschuwen
      SmartScreen en Gatekeeper bij elke nieuwe gebruiker.

## Keten en sync

- [ ] **Seq-conflicten bij meer dan twee devices.** Twee devices die tegelijk
      schrijven pakken hetzelfde seq; die link gaat op `conflicted`. Takken apart
      zetten en later samenvoegen in plaats van de link laten stoppen.
- [ ] **Discovery op twee online machines bewijzen.** Een machine vindt en koppelt
      de andere zonder invite-code, heen en terug.
- [ ] **Bestanden boven 512 kB.** Een blob-kanaal, of een duidelijke weigering in
      de UI in plaats van stilte.
- [ ] **Tests voor env, relay en workspace-sync tussen twee daemons** in de suite,
      nu alleen met de hand bewezen.

## App

- [ ] **Checkpoints in de UI.** Lijst met punten en een knop om terug te springen.
- [ ] **Workspace bekijken en openen** vanuit de app, niet alleen syncen.
- [ ] **MCP-configuratie in de app**, met een scherm en de config die over de keten
      meereist.
- [ ] **Titel van een nieuw gesprek** meteen goed zetten in plaats van "New
      conversation" tot je hem hernoemt.
- [ ] **Oude foutregels** uit het transcript halen zodra een beurt opnieuw lukt.

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
      elkaar kunnen lopen.
- [ ] **#17 Zonder API-sleutels dingen bereiken.** Alleen lezen, alleen anonieme
      webaanroepen: GitHub nu, OneDrive en een publieke URL later. Geen
      credentials in de keten.
- [ ] **#11 Sessie exporteren** als markdown of JSON, zodat een gesprek deelbaar is.
- [ ] **#10 MCP-servers automatisch vinden** in de gebruikelijke configmappen in
      plaats van ze met de hand aanwijzen.

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
  2026-11-18 — hoofdletter wint.** De map heet `~/.Roan` op elk platform
  (Linux/macOS/Windows: `~/.Roan`; Android: binnen de app-privé map). Eerste
  start hernoemt een bestaand `~/.roan` één keer naar `~/.Roan`, zodat geen
  device zijn keten kwijtraakt. Nog niet geïmplementeerd; hoort bij de
  workspace-ronde.

