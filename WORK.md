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

## Nu

1. **Android-app.** Nog steeds geen project, geen APK. `tauri android init` en
   een CI-job die echt een APK oplevert.
2. **Desktop-builds.** exe/dmg/AppImage met de daemon in de bundel; zonder
   sidecar opent de app en doet hij niets.
3. **Checkpoints in de UI.** Het kan al via de socket; er is nog geen knop en
   geen lijst met punten om naar terug te springen.
4. **Workspace zichtbaar in de app.** Bestanden reizen, maar je kunt ze niet
   bekijken of openen vanuit de UI.
5. **MCP-configuratie in de app.** De motor kan MCP; de keten vervoert nog geen
   `mcp/`-configuratie met een scherm erbij.
6. **Peers vinden via Tailscale** in plaats van een invite-code plakken.
7. **Grote bestanden.** Boven 512 kB reist niets; dat moet een blob-kanaal
   krijgen of bewust geweigerd worden met een melding.
8. **Tests voor env, relay en workspace-sync tussen twee daemons** — nu met de
   hand bewezen, niet in de suite.

## Bekend, klein

- Invite-code zegt 127.0.0.1 als `ROAN_PEER_HOST` niet open staat.
- Oude foutregels blijven in het transcript staan.
- Een nieuw gesprek krijgt nog de titel "New conversation" tot je hem hernoemt.
