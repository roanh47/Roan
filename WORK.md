# Wat er nog moet

## Bewezen en af (niet opnieuw doen)

- Keten synct tussen twee daemons: backfill bij join en live doorsturen.
- Webui op poort 6769, onboarding (create/join) in de app, invite-code overleeft reload.
- Memory (USER.md/MEMORY.md) in de prompt, skills op schijf met alleen de naam in de prompt.
- Env reist als inhoud: skill op A verscheen als bestand op B.
- `run_on_node`: A's agent liet B `hostname` draaien; beide ketens 9 events, identiek.

## Nu, in deze volgorde

1. **Workspace-map als kopie.** Nu reist alleen de agent, niet je projecten. Bestanden
   als keten-events (tekst) met een limiet; grote blobs via een apart kanaal.
2. **Botsingsregel voor bestanden.** Twee devices die hetzelfde bestand aanpassen:
   beide versies bewaren en zeggen dat het botste. Nooit stil één versie weggooien.
3. **Android-app.** Geen project, geen APK, build nooit gedraaid. `tauri android init`
   en een echte CI-job die een APK oplevert.
4. **Desktop-builds.** exe/dmg/AppImage. De sidecar-binary bouwt nu in CI (staat in
   .gitignore) en moet aan de bundel hangen, anders opent de app en doet hij niets.
5. **MCP-client.** Hermes' ecosysteem: servers uit `~/.roan/mcp.json`, tools registreren.
6. **Cron.** Ingeplande beurten in de daemon die een bericht in de keten zetten.
7. **Subagents.** Een kind met eigen context dat een samenvatting teruggeeft.
8. **Sessies.** De keten is nu één gesprek; gesprekken moeten apart kunnen.
9. **Modellenkiezer** in de UI op basis van de models.dev-catalogus.
10. **Tools aansluiten.** Twintig tool-modules staan geschreven, alleen read/write/list/shell
    plus memory en skill zijn gewired.
11. **Peers vinden via Tailscale** in plaats van alleen een invite-code plakken.

## Bekend, klein

- Invite-code bevat 127.0.0.1 als `ROAN_PEER_HOST` niet gezet is; op de server staat hij
  open, lokaal niet.
- Fout-events uit oude beurten blijven zichtbaar in het transcript.
- Env en relay zijn met de hand bewezen, niet met tests in de suite.
