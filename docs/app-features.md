# App-functies: Hermes naast Roan

Alleen wat je in de app zelf ziet en doet. Release-werk (MSIX, certificaten,
update-feeds, ABI-splitsing) hoort hier niet — dat staat in `TODO.md`.

Legenda: **ja** = werkt en is te bedienen · **deels** = de motor bestaat, het
scherm of de bediening niet · **nee** = ontbreekt.

## Gesprek

| Functie | Hermes | Roan |
|---|---|---|
| Streamend antwoord, markdown, codeblokken met kopieerknop | ja | ja |
| Kopiëren, opnieuw genereren, bericht bewerken → vertakken | ja | deels (regenerate + rewind; bewerken niet) |
| Bijlagen: foto's, bestanden, sleep-drop, plakken | ja | ja (foto's + workspace; > 8 MB niet) |
| Bericht in de wachtrij tijdens een beurt | ja | deels (queue bestaat, niet in de app) |
| Sturen tijdens een lopende beurt (steer) | ja | ja |
| Stoppen, hervatten, onderbroken beurt herstellen | ja | ja |
| Denkstatus ("Thinking…", fase, timer) | ja | ja |
| **Redenering uitklappen (Thought-blok)** | ja | **nee** |
| **Thinking level per gesprek (laag/normaal/hoog)** | ja | **deels** (mapping werkt, geen knop) |
| **Plan mode met goedkeuring** | ja | ja |
| Contextmeter / compacten | ja | deels (compacten werkt, geen meter) |

## Goedkeuring en veiligheid

| Functie | Hermes | Roan |
|---|---|---|
| Goedkeuringskaart met Approve/Deny per tool-call | ja | ja |
| Aangeleerde toestemming per tool (blijft gelden) | ja | ja |
| **Modus per gesprek: ask / auto-allow reads / plan only** | ja | **nee** |
| **Policy echt vóór de tool-call** | ja | **nee** (`run_shell` gaat eromheen) |
| Sandbox/container voor shell-werk | ja (docker, ssh, modal, daytona) | nee |
| Volledige schijftoegang als instelling | ja (trusted dirs) | ja (`access.fullDisk`) |
| Elevated/sudo via smalle allowlist | ja | ja (commando) |

## Gesprekken en geschiedenis

| Functie | Hermes | Roan |
|---|---|---|
| Lijst, zoeken, hernoemen | ja | ja |
| **Archief en verwijderen als knop** | ja | **deels** (keten + tombstones, geen knop) |
| **Semantisch zoeken over oude gesprekken** | ja | **nee** (substring) |
| Checkpoints en terugspringen | ja | ja |
| Exporteren (md/html/json) en delen | ja | deels (bestand ja, link nee) |
| Tijdelijke chat die niets bewaart | ja | nee |
| Hervatten op een ander device | — (uniek voor Roan) | ja |

## Modellen en kosten

| Functie | Hermes | Roan |
|---|---|---|
| Provider-accounts en API-keys beheren in de app | ja | ja |
| Modellenlijst live uit models.dev | ja | ja |
| **Model per gesprek** | ja | **nee** (per device) |
| **Fallback-model als de eerste faalt** | ja | **nee** |
| **Kosten en tokens per beurt én per sessie/maand** | ja | deels (per beurt) |
| Rollen: duur model voor de planner, goedkoop voor zijtaken | ja | ja |

## Gereedschap in de app

| Functie | Hermes | Roan |
|---|---|---|
| Tools-paneel met aan/uit per tool | ja | ja |
| MCP-servers toevoegen, testen, tools zien | ja | deels (config + runtime; geen discovery) |
| Skills: bladeren, installeren, zelf maken | ja | deels (index + voorstel; geen hub) |
| **Slash-commando's in de composer** | ja | **deels** (parser + menu, niet gemount) |
| **Command palette / sneltoetsen** | ja | **nee** |
| Hooks (commando's op gebeurtenissen) | ja | deels (turn_start/end) |
| **Policy-bestand per project** | ja | nee |

## Geheugen en kennis

| Functie | Hermes | Roan |
|---|---|---|
| Memory-paneel: bekijken, aanpassen, wissen | ja | deels (memory-events + MEMORY.md) |
| Automatisch feiten destilleren na een gesprek | ja | ja |
| **Curator: opruimen en verouderde feiten voorstellen** | ja | **nee** |
| Projecten met eigen instructies | ja | ja (AGENTS.md reist mee) |
| Schrijfstijl-skill als bestand | ja | nee |

## Automatisering

| Functie | Hermes | Roan |
|---|---|---|
| Cron/achtergrondtaken met schema en paneel | ja | deels (scheduler; paneel niet gemount) |
| Achtergrondprocessen met live output | ja | deels (proces-registry; geen paneel) |
| **Push-notificaties als een taak klaar is** | ja | **nee** |
| Goals en standing orders | ja | ja |
| Webhooks in/uit | ja | deels (module; geen listener) |

## Media en spraak

| Functie | Hermes | Roan |
|---|---|---|
| Beeldgeneratie met resultaat als bijlage | ja | deels (providers; geen tool) |
| Foto's analyseren (vision) | ja | ja |
| Browsen op een pagina (klikken, lezen, screenshot) | ja | ja (CDP) |
| Muis/toetsenbord op de desktop | ja | deels (grants; geen goedkeuringsscherm) |
| Voorlezen (TTS) | ja | nee (module) |
| Dicteren (STT in de composer) | ja | nee (module) |
| Spraakgesprek (luisteren ↔ antwoorden) | ja | nee (lus zonder mic/speaker) |

## Samenwerken en uitbreiden

| Functie | Hermes | Roan |
|---|---|---|
| Subagents met eigen context en samenvatting terug | ja | ja |
| **Live transcript van een subagent** | ja | **nee** |
| Kanban-bord voor taken | ja | nee |
| **Meerdere profielen (geïsoleerde omgevingen)** | ja | **nee** |
| Thema's/skins | ja | deels |
| Insights/gebruiksdashboard | ja | nee |

## De pagina's die Hermes' dashboard heeft (en Roan niet)

Dit is de echte maat: het Hermes-dashboard is ingedeeld als pagina's die je als
bestuurder van een agent nodig hebt. Links in de zijbalk, in deze volgorde:

| Pagina | Wat je er doet | Roan |
|---|---|---|
| Chat | het gesprek zelf | ja |
| Sessions | zoeken, hervatten, archiveren, per sessie de bron zien | deels (geen archief, geen semantisch zoeken) |
| Files | bestanden van de agent bekijken en openen | ja (file explorer) |
| **Analytics** | tokens, kosten, gebruik per model en per dag | **nee** (alleen per beurt) |
| Models | providers, keys, modellen, thinking levels per model | deels (keys + lijst; geen niveaus) |
| **Logs** | de daemon-/agentlog lezen en filteren | **alleen een /log-endpoint**, geen pagina |
| **Cron** | taken plannen, zien wanneer ze liepen, uitslag | **nee** (scheduler werkt, geen pagina) |
| **Skills** | bladeren, installeren, zelf maken, aan/uit | **nee** (index + voorstel) |
| **Plugins** | plugins zien, installeren, aan/uit | **nee** (loader, geen pagina) |
| **MCP** | servers toevoegen, testen, hun tools zien | **nee** (config + runtime, geen beheer) |
| Webhooks | in-/uitgaande hooks met signing | nee (module) |
| Pairing | devices koppelen en intrekken | deels (join/invite) |
| **Profiles** | meerdere geïsoleerde omgevingen naast elkaar | **nee** |
| Config | alles wat de agent mag en doet | deels (losse schermen) |
| Keys | sleutels per provider | ja |
| System | versie, schijf, gezondheid, herstart | deels (About + opslag) |

Wat daaruit volgt: Roan heeft de *chat* af, en mist de **acht pagina's waarmee je
de agent bestuurt**: Analytics, Logs, Cron, Skills, Plugins, MCP, Webhooks,
Profiles. Dat is precies het verschil tussen "een app die praat" en "een agent
waar je de baas over bent".

## Wat er dus echt mist, in volgorde van impact

1. **Redenering uitklappen** en **thinking level als knop** — het denkwerk is onzichtbaar.
2. **Approval modes per gesprek** en **policy écht vóór de tool-call** — veiligheid is nu een scherm, geen grens.
3. **Model per gesprek** en **fallback-model** — nu één model per device.
4. **Kosten per sessie/maand** — je ziet alleen per beurt.
5. **Archief/verwijderen als knop**, **semantisch zoeken**, **tijdelijke chats**.
6. **Slash-commando's en command palette** — de parser ligt er, het scherm niet.
7. **Memory-paneel** en **curator**.
8. **Cron- en processenpanelen**, **push-notificaties**.
9. **TTS/dicteren/spraakgesprek** — de motoren staan er, de audio niet.
10. **Subagent-transcript**, **kanban**, **profielen**, **skills-hub**.
