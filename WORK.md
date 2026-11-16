# Wat er nog moet

## Bewezen en af

- Keten synct tussen twee daemons: backfill bij join en live doorsturen.
- Webui op poort 6769, onboarding (create/join), invite-code.
- Memory en skills in de prompt; skills staan als echt bestand op elke machine.
- Env reist als inhoud (skill op A verscheen als bestand op B).
- Workspace reist als inhoud: bestand op A verscheen op B's schijf.
- Botsingsregel: beide machines hielden hun eigen versie en er staat op allebei
  een `leesmij.txt.conflict-<node>-<seq>` met de andere versie.
- `run_on_node`: A's agent liet B `hostname` draaien; beide ketens identiek.
- Sessies: elk gesprek zijn eigen geschiedenis, wisselen in de rail, New start
  zonder het oude te raken.
- Cron: job in `cron.json` reist mee, laatste-run-tijd blijft per device.
- Hooks: shell-commando op turn_start en turn_end.
- `delegate`: subagent met eigen context, alleen de samenvatting terug.
- Checkpoints en rewind: rewind opent een nieuw gesprek vanaf een eerder punt;
  niets wordt verwijderd.
- Vier release-assets uit CI onder tag `v0.0.1`: `Roan-0.0.1-x64.exe`,
  `Roan-0.0.1-arm64.dmg`, `Roan-0.0.1-x86_64.AppImage` en `Roan-0.0.1.apk`.
  De desktop-apps dragen de daemon als sidecar, dus zonder losse installatie
  starten ze een echte agent.
- Peers vinden zichzelf via Tailscale: `src/daemon/discovery.ts` leest
  `tailscale status --json` (ook uit de Docker-container op de server), probeert
  de peer-poort en koppelt wat antwoordt. De peer-server luistert standaard op
  alle interfaces. 487 tests groen.

## Nu

1. **Slankere APK.** De apk uit v0.0.1 is 455 MB: debug, alle vier de
   architecturen en symbolen. Naar `--release` met ABI-splitsing, mik op 40 tot
   60 MB, en hem daarna echt op de telefoon installeren en starten.
2. **Checkpoints in de UI.** Het kan al via de socket; er is nog geen knop en
   geen lijst met punten om naar terug te springen.
3. **Workspace zichtbaar in de app.** Bestanden reizen, maar je kunt ze niet
   bekijken of openen vanuit de UI.
4. **MCP-configuratie in de app.** De motor kan MCP; de keten vervoert nog geen
   `mcp/`-configuratie met een scherm erbij.
5. **Grote bestanden.** Boven 512 kB reist niets; dat moet een blob-kanaal
   krijgen of bewust geweigerd worden met een melding.
6. **Seq-conflicten met meer dan twee devices.** De keten is één rechte lijn;
   schrijven twee devices tegelijk, dan botsen ze op hetzelfde seq en gaat die
   link op `conflicted`. Bij twee devices merk je dat bijna nooit, bij vier die
   tegelijk werken wel. Takken naast elkaar zetten en later samenvoegen.
7. **Tests voor env, relay en workspace-sync tussen twee daemons** — nu met de
   hand bewezen, niet in de suite.
8. **Tweemachine-test van discovery.** Bewezen dat de server Tailscale leest en
   dat een lege tailnet netjes nul adressen geeft. Nog niet bewezen dat twee
   online machines elkaar echt koppelen, want de andere nodes stonden offline.

## Bekend, klein

- Discovery onthoudt gevonden peers niet over een herstart; hij vindt ze elke 20
  seconden opnieuw, dus dat kost alleen een ronde.
- De `.exe` en `.dmg` zijn niet ondertekend: SmartScreen en Gatekeeper
  waarschuwen.
- Invite-code zegt 127.0.0.1 als `ROAN_PEER_HOST` niet open staat.
- Oude foutregels blijven in het transcript staan.
- Een nieuw gesprek krijgt nog de titel "New conversation" tot je hem hernoemt.
