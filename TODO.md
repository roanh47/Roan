# To do

One list, per version. A tick means it works and it is proven: on a real
machine, or by a test that walks the whole route. What a version does not
reach moves to the next one; there is no second list.

The feature-by-feature status is in `docs/feature-parity.md`. What is open
there comes back here, per version.

## 0.1.0

- [ ] **Two workspaces, used the way they are meant.** `workspace/` is local:
      Roan builds there. `synced-workspace/` is for a file that should be on
      every device. The home itself (`SOUL.md` and the rest) is not a place
      to put work. Built, not proven: Roan is told all of this in every
      conversation, with the real paths, and to ask when it is unclear
      (`src/context/places.ts`). Still to do:
      - Turns, commands, hooks and Mini Roans still start in
        `synced-workspace/`, so a path without a folder lands there. Decide
        whether they should start in `workspace/`; the file explorer and the
        file picker in the composer show the synced folder and have to keep
        working.
      - The home is protected by instruction only. Make the file tools and
        the shell guard refuse to write the home's own files.
      - On Windows the leading dot does not hide `.Roan`; set the hidden flag
        when the folder is created.

- [ ] **`secrets/` holds one thing, and then goes away.** Everything is
      synced. The only per-device fact is the id that tells devices apart.
      Check what else `src/daemon/identity.ts` and the connectors still write
      into `secrets/`, move anything that is a key or a token to where the
      chain carries it, and move the id into `state/` so there is one folder
      of plumbing and no folder called secrets.
- [ ] **The APK is a release build: prove it on a phone.** Both workflows now
      build a release APK and sign it with the release key
      (`tauri android build --apk`, no `--debug`). A release build shrinks and
      renames code, and the daemon is started by native code that finds
      `RoanNode` by name, so a keep rule for `dev.roan.**` and for native
      methods is written to `roan-keep.pro` before the build. Not proven: the
      app has to be installed and opened on a phone. If it crashes at start,
      the keep rule is the first place to look.

- [ ] **Built on 2026-11-28, none of it proven.** Written without being run;
      each needs CI green and a check on a device before it counts.
      - The loop: old tool output cleared past a budget
        (`src/context/tool-clearing.ts`); a busy provider retried with a
        growing wait (`src/agent.ts`); the older part of a long conversation
        summarised in steps of twenty with a plain fallback
        (`src/context/condense.ts`); the system prompt of a conversation held
        still; tools that cannot work on a device not offered.
      - Pages: Skills with use counts (`src/skills/usage.ts`), Memory, Usage,
        Logs, Mini Roans, Connections, Computer use, Model roles, Commands,
        Background jobs.
      - Mini Roans in the background, up to four at once, visible and
        stoppable (`src/daemon/mini-registry.ts`).
      - Memory edits and forgetting as chain events (`src/memory/distil.ts`).
      Still open from the same list: browser sign-in for connections,
      reasoning sent back to providers that expect it, a model and an
      approval mode per conversation, temporary chats, a Plugins page, an
      archive view, the agent's task list as chain state, computer use on
      another device of the chain.

- [ ] **Remove all Dutch: code and comments first, then docs.** Everything in
      this repository is English. Not one Dutch identifier, comment, test
      name, string, log line or prompt stays. The one exception is the
      writing-style skill: it has an upstream and is not touched.
      Dutch found in code on 2026-11-28, about a hundred places in 32 files:
      - `src/agent.ts`: the variables `stappen`, `antwoord`, `laatsteTekst`.
      - `src/mobile/backup-policy.ts` and `web/src/i18n.ts`: check whether the
        Dutch there is data the feature needs or leftover text.
      - Test names and fixtures in `src/chain/` (`compaction`, `export-html`,
        `export-markdown`, `gates`, `sessions`, `summary`), `src/stt/registry`,
        `src/tools/` (`web`, `todo`, `glob`, `search`, `secrets-scan`),
        `src/mcp/client`, `src/mobile/queue`, `src/sync/`, `src/workspace/`,
        `src/voice/tts`, `src/charts/spec`, `src/memory/distil`,
        `src/daemon/control`, `src/daemon/discovery`, `src/testing/temp-dir`
        and `tests/integration/sync-two-nodes`.
      - `scripts/build-local.sh` and `scripts/dmg/build-dmg.sh`.
      Dutch in docs: the old sections of this `TODO.md`, `docs/README.md`,
      `docs/app/app-features.md`, everything in `docs/research/` and
      `docs/history/`, `docs/feature-map.md`, and the summary in
      `docs/feature-parity.md`.
- [ ] **Prove the 0.1.0 work on a device.** Built and CI-checked only, never
      run on a real machine: the tool guard (risky shell lines ask), slash
      commands, the Thought block and effort picker, skill proposals,
      `memory_search` / `todo`, and the "Access outside the app" switch.
- [ ] **Tell the app from a browser on the same device.** The access switch
      closes the tailnet, but the app's own window and a local browser are
      both loopback. Closing the local browser too needs a per-device token
      the Tauri and Android shells hand to the UI.
- [ ] **Skill curator.** Count how often each skill is used, show unused and
      recently changed ones, and give an approved proposal an undo.
- [ ] **The UI gets better.** Same style, better app: it has to feel
      finished on a phone, a tablet and a desktop. Go screen by screen (chat,
      composer, drawer, settings pages, sheets, approval and skill cards) and
      fix spacing, alignment, touch targets, empty and loading states, and
      anything that jumps or overlaps. The new 0.1.0 pieces (slash menu,
      Thought block, skill proposals, access card, effort picker) were written
      without ever being seen on a screen and need this first.
- [ ] **Roan is its own harness.** Built, not proven: every turn runs on
      Roan's own loop (`src/agent.ts`) and nothing else. Still to do: prove a
      full turn on each device.
- [ ] **Everything has a screen.** The rule: a feature is set and seen in the
      app; the slash menu is only a shortcut to a screen or to your own
      commands. Built, not proven: Settings → Model roles (effort, fallback,
      helper models), Settings → Commands, Settings → Background jobs,
      Settings → Sync → Access outside the app, and the skill card above the
      composer. Still without a screen: the task list the agent keeps
      (`todo`), a running Mini Roan, hooks, the fallback and helper models
      inside the model sheet itself, and full-disk access.
- [ ] **Auxiliary models.** Built, not proven: three helper slots on Settings
      → Model roles (`src/daemon/auxiliary.ts`). Vision looks at an attached
      image and describes it for a main model that cannot see; Background
      does the memory distilling; Mini Roan is the model a delegated task
      runs on. Each may sit on another saved provider, and an empty slot means
      the main model does the job. Still to do: slots for compaction, titles
      and web extraction once those use a model; a model picker instead of a
      typed id; and picking the vision model automatically when the catalog
      says the main one is text-only.
- [ ] **Background processes.** Built, not proven: the `process` tool starts
      a job, lists jobs, reads output and stops one, the next turn is told
      which jobs ended (`src/tools/processes.ts`), and Settings → Background
      jobs shows and stops them. Still to do: a notification when a job ends,
      and a PTY shell.
- [ ] **Fallback model.** Built, not proven: a second model of the same
      provider, set on Settings → Model roles; a failed request is retried on
      it once (`src/agent.ts`). Still to do: a fallback on another provider.
- [ ] **`AGENTS.md` in `~/.Roan` gets another name.** `AGENTS.md` is a file
      for a project, like the one in this repo. The one in the home holds how
      Roan writes (`SOUL.md` holds who it is) and is the `rules` block of the
      prompt. Rename it (for example `RULES.md`) in `src/daemon/bootstrap.ts`,
      `src/env/types.ts` and the prompt builder, and move an existing file
      over once, the way the lowercase home was migrated.
- [ ] **Connections.** Top priority. Built, not proven: Settings →
      Connections adds a service by its MCP address, signs in with a token
      that travels with the config so every device is signed in
      (`mcp/tokens/`, `src/daemon/connection-tokens.ts`), shows whether it is connected and
      how many tools it brought, and signs out or removes it. Four services
      are offered by name. Still to do: sign-in in the browser (OAuth), which
      most services need (mail, calendar, notes); checking the four suggested
      addresses against the real services; and turning a connection off
      without removing it from this page.
- [ ] **Computer use.** Top priority. Built, not proven: the `computer` tool
      looks at the screen (a model that can see describes it with pixel
      positions), then moves, clicks, types and presses keys
      (`src/computer/tool.ts`), and Settings → Computer use allows it for one
      chat for 5, 10 or 30 minutes with a Stop button. Drivers for Linux
      (`ydotool` / `xdotool`), Windows (PowerShell, nothing to install) and
      macOS (`screencapture` and `osascript`, needs Screen Recording and
      Accessibility permission). The Windows and macOS drivers have never
      touched a real screen. Still to do: prove each on its platform; the
      primary screen only, so more monitors; controlling another device of
      the chain from this one; a
      visible "Roan is controlling this device" bar with Stop in the chat;
      scroll, drag and double-click; and sending the screenshot itself to a
      main model that can see, instead of a description.
- [ ] **Reasoning for Google, and live.** The Thought block covers
      OpenAI-compatible providers and Anthropic and appears when the turn
      ends. Add Google's thought parts and stream it while the model thinks.
- [ ] **Tool guard on relayed calls.** Built, not proven: a risky shell line
      sent with `run_on_node` asks on the device where the turn runs. Still to
      do: the executing device trusts the chain and checks nothing itself.
- [ ] **Policy file.** An owner-editable file that says which tool may do
      what; `decide()` in `src/tools/policy.ts` still has no caller.
- [ ] **Per-conversation model.** `model_set` writes one model for the whole
      device; the model belongs to the conversation.
- [ ] **Finish the small screens.** Edit a sent message (branch from a
      checkpoint), an archived-conversations view, a session cost total, and
      the doctor behind a settings button (`src/daemon/health.ts`,
      `diagnostics.ts`).
- [ ] **Everything is synced: check all of it.** The rule is rule 9 in
      `AGENTS.md`: everything in `~/.Roan` is synced except `workspace/`.
      Built, not proven: settings, keys, helper and fallback models,
      connection sign-ins, the access switch and computer use permissions all
      travel, and a device reloads its settings when a change arrives. Still
      to do: the task list the agent keeps is in memory only and has to
      become chain state; go through every module and move anything that
      still writes outside the synced part of the home; and rewrite
      `docs/security.md` and `PLAN.md`, which still say keys do not travel.
- [ ] **Auth on the control socket.** `/ws` is guarded by address only. The
      same per-device token that tells the app from a local browser fixes it.
- [ ] **Docs match the code.** About a dozen files in `docs/` contradict the
      code or each other (`architecture.md`, `gui.md`, `install.md`,
      `mobile.md`, `packaging.md`, `release.md`, `run-it-locally.md`,
      `testing.md`, `chain.md`, `protocol.md`, `storage.md`, `updates.md`),
      and `WORK-PARALLEL.md` lists finished work as open.
- [ ] **Subagents are Mini Roans.** Built, not proven: `delegate` starts a
      Mini Roan on Roan's own loop with the same prompt, memory, skills and
      guarded tools, in its own context, and only its summary comes back
      (`src/daemon/mini.ts`). Still to do: show a running Mini Roan in the
      app, and let several run side by side.
- [ ] **Fix the update button.** About → Check for updates does not do its
      job. First find out what fails (the check, the download or the install,
      and on which platform), then fix it and prove it on a real device.
      Route: `UpdateCard`, `update_check` / `update_download`,
      `src/packaging/update-flow.ts`.

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
      Gebouwd (`src/daemon/thought.ts`, `reasoning`-event, "Thought"-blok in
      `Transcript.tsx`) voor OpenAI-compatibele providers en Anthropic; nog
      niet voor Google en nog niet op een apparaat bewezen, dus geen vinkje.
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
