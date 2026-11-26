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
