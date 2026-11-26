# To do

Eén lijst, per versie. Een vinkje betekent: het werkt en het is bewezen — op een
echte machine of met een test die de hele route aflegt. Wat een versie niet haalt,
schuift naar de volgende versie; er is geen tweede lijst.

De volledige vergelijking met Hermes — 66 features, 49 af, 16 open, 1 bewust niet —
staat met vinkjes in `docs/feature-parity.md` (§ Samenvatting). Wat daar open staat,
komt hier per versie terug.

## 0.0.25 — nu

- [x] **Alles op één poort (6769).** De daemon serveert de UI, `/ws` (control) en
      `/peer` (sync) vanaf één listener; 7411, 7412, 7413 en het losse
      `webui.mjs`-proces zijn weg. `/peer` eist het chain-token, `/ws` weigert
      niet-loopback tenzij `ROAN_ALLOW_REMOTE_CONTROL=1`, en de invite draagt
      alleen host + poort. `src/daemon/control-http.ts`, `control-port.test.ts`;
      1478 root-tests groen, live smoke op `/healthz`, `/`, `/assets`, `/log`.
- [x] **Ook de app dialt die ene poort.** `web/src/socket.ts` en `App.tsx`
      gebruiken 6769 en halen de log same-origin (`/log`); `RoanNode.kt` zet
      `ROAN_CONTROL_PORT=6769` en de eigen 7413-logserver is verwijderd.
- [x] **MSI in plaats van EXE.** CI bouwt `--bundles msi` en publiceert alleen
      `Roan-<versie>-x64.msi`; de updater matcht `*.msi` en het plan zegt
      `msiexec /i /qn`. Workflow, `pickAsset` en de plan-notities zijn
      bijgewerkt; 1478 root · 116 `tests/` · 126 web groen.
- [x] **Vast Android-certificaat.** Elke apk wordt opnieuw ondertekend met
      `d3bc8758…` en CI faalt bij een andere vingerafdruk
      (`signing/android-cert-sha256.txt`). Bewezen op de gepubliceerde 0.0.24.
- [ ] **Eén poort live bewijzen.** App op de emulator en op de telefoon laten
      starten, een gesprek voeren en syncen over 6769. Serverkant is bewezen,
      de clients nog niet.
- [ ] **Windows- en macOS-certificaat.** Een MSI en een dmg zijn ongesigned, dus
      het OS kan niet zien dat twee releases van dezelfde maker zijn. Vraagt een
      code-signing-certificaat (Windows) en een Apple Developer ID (macOS).

## 0.0.29

- [ ] **Gedachten zichtbaar en uitklapbaar.** De dock zegt nu alleen dát hij
      denkt. De redenering zelf moet opgevangen worden (de reasoning-delta's van
      de provider, niet de zichtbare tekst), als apart `reasoning`-deel in de
      beurt bewaard worden en in het transcript als inklapbaar "Thought"-blok
      verschijnen — dichtgeklapt by default, open te klikken, en nooit
      meegestuurd als gewoon antwoord. Ook voor providers die het níet leveren:
      dan is er geen blok, geen leeg blok.
- [ ] **Libnode niet twee keer initialiseren.** De log van de telefoon toont
      `Assertion failed: !init_called.exchange(true)` en
      `pthread_mutex_lock called on a destroyed mutex`: de Node-runtime start
      twee keer in hetzelfde proces en de app stort dan af. De service moet of
      één keer starten, of het hele proces herstarten — nooit een tweede
      runtime in hetzelfde proces.

## 0.0.28 (doorgeschoven)

- [ ] **Libnode per ABI meebundelen** (of per-ABI splitsen): de universele apk heeft
      alleen arm64-libnode, dus op een x86_64-emulator start geen daemon
      (`no libnode in this apk`).
- [ ] **Wrapper start en herstart zijn daemon** en toont bij falen de log — de
      banner meldt het nu, maar de herstart is nog handwerk.
- [ ] **Echte responsiviteit** voor pc/tablet/telefoon als geheel (de rail heeft
      nu een breakpoint; de rest van de layout nog niet).
- [ ] **Admin-instelling in de app** bovenop `src/sudo/install.ts` (het commando
      bestaat; het scherm nog niet).

## 0.0.26

- [ ] **Eigen bericht bewerken** — de handler bestaat; het emulator-bewijs
      (tik bubbel → composer vult → aangepast verstuurd) ontbreekt nog.
- [ ] **Tijdelijke chats** die niets publiceren en niet in de historie blijven.
- [ ] **Gesprek delen** als read-only link; de export bestaat, de link niet.
- [ ] **API-sleutel buiten de keten.** `settings_save` schrijft `apiKey` in
      `config.json`, dat in de env-snapshot zit. Het inpakken redigeert hem nu,
      maar de sleutel hoort in `secrets/` en niet in een bestand dat reist.
- [ ] **Bewijsronde afmaken:** de zeven feature-screenshots en een blob boven
      512 kB die via adb terugkomt.
- [ ] **Slankere apk.** Nu 162 MB universeel debug; release + ABI-splitsing,
      mik op 40–60 MB.
- [ ] **Discovery en sync met twee online machines bewijzen**, inclusief tests
      voor env, relay en workspace-sync tussen twee daemons.
- [ ] **Oude foutregels** uit het transcript halen zodra een beurt opnieuw lukt.
- [ ] **Schrijfstijl-skill upstream** — de skill staat niet als bestand in de
      repo terwijl de rest dat wel doet.

## 0.0.27

- [x] **Composer-tekst precies in het midden.** De regel in het invoerveld staat
      nu te laag; tekst en placeholder moeten verticaal gecentreerd zijn, ook met
      een meerregelig bericht.
- [x] **Ruimte voor de statusbalk komt van Android, niet uit de HTML.** De HTML is
      op elke build identiek; de shell levert de insets (of de webview staat niet
      edge-to-edge) en de CSS gebruikt ze alleen. Geen eigen `padding-top` meer.
- [x] **Zijbalk op grote schermen uitgeklapt kunnen blijven**, zoals andere
      AI-apps: een vaste, ingeklapte rail op smal, een open zijbalk op breed, met
      een knop om te wisselen.
- [x] **"Connecting to daemon" verdwijnt.** De wrapper start zijn daemon en houdt
      hem in de lucht; als hij toch wegvalt, komt er een popup bovenin met de
      reden en een herstart-knop — geen wachttekst in de chat.
- [x] **New chat werkt.** Eerste beurt, lege staat en de rail moeten alle drie
      het nieuwe gesprek meteen als actief tonen.
- [x] **Elk device kan andere devices uit de keten verwijderen.** Een
      `node_remove`-event met tombstone; het verwijderde device verdwijnt uit de
      lijst en komt terug zodra het opnieuw verbindt (en de keten weer ziet).
- [x] **Werkplek als echte file explorer.** `workspace/` én `workspace/synced/`
      zichtbaar, per node zijn eigen mappen, met sync-status per bestand
      (gesynct / lokaal / conflict / in afwachting).
- [x] **Roan komt overal bij op elke machine.** geen kunstmatige grens op paden
      buiten de workspace voor de eigenaar; wat de agent leest, leest hij met de
      rechten van de daemon.
- [x] **Admin/sudo per node als instelling**, bij voorkeur via een commando dat de
      regels zet (`/etc/sudoers.d` of polkit) in plaats van een wachtwoord in de
      app te vragen. Zonder die instelling weigert de daemon elevated werk met een
      eerlijke melding.
- [ ] **De UI responsief maken** — één layout die klopt op pc, tablet en telefoon.
      Vandaag is er één breedte-aanname: smal geeft een bovenbalk die er niet
      hoort, breed laat dezelfde balk staan. Klaar als pc, tablet en telefoon
      elk hun eigen maat krijgen zonder dat een element buiten beeld valt.
- [ ] **Geen eigen statusbar-ruimte.** De app mag de statusbalk van Android niet
      zelf nadoen met padding: de systeem-insets bepalen die ruimte
      (`WindowInsets` / safe-area). Nu reserveert de UI zelf een strook, en
      daardoor ziet de desktop er ook uit als een telefoon met een balk erboven.
- [ ] **MCP-servers automatisch vinden** in de gebruikelijke configmappen (#10).
- [ ] **Basiskennis vanaf één plek** bijwerken (#18).
- [ ] **Zonder API-sleutels lezen** — alleen anonieme bronnen (#17).
- [ ] **Relay** voor een keten waarin niet elk device elk device ziet.
- [ ] **App-icoon** echt van de profielfoto in plaats van de gegenereerde set.
- [ ] **Update-feed als losse release** — nu leest de updater de GitHub-API;
      bekijken of een `latest.json` nog iets toevoegt.

## Later

- [ ] Android als volwaardige node, voor zover het besturingssysteem dat toelaat.
- [ ] MSIX/Store-kanaal naast de MSI, met de in-app updater uit in die build.

## Afgerond

- **0.0.24** — eerste release met één vaste Android-sleutel; updater leest
  GitHub-releases en downloadt per platform het juiste bestand met
  sha256-controle.
- **0.0.23** — 34 features gebouwd (plan mode, memory, goals, effort, usage,
  cron, spraak, import, steer, research, archief, veiligheid, kennis, hooks,
  SDK, rollen, browser, computer use, generatie, werkplek, git, CLI, webhooks,
  device control), new chat opent zichzelf.
- **0.0.22** — foto's door de keten, checkpoints in de UI, share-sheet,
  Wikipedia-fallback.
- **0.0.21** — echte MCP-client, approval-banner, export met bijlagen.
- **0.0.20** — web-tools via plugins, env/skills/workspace reizen als inhoud.
- **0.0.1** — vier release-assets uit CI onder één tag.
