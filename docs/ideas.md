# Ideeën die alleen Roan kan maken

Deze lijst gaat niet over wat Hermes heeft. Hij gaat over wat *deze* architectuur
mogelijk maakt en niemand anders heeft: een eigen daemon per device, een keten die
van nature alles vastlegt, en apparaten die elkaars rechten en bestanden kunnen
gebruiken. Bij elke functie staat waarom hij alleen hier kan bestaan.

## De drie die ik als eerste zou bouwen

### 1. Bewijs-klikbare antwoorden
Elke bewering in een antwoord hangt aan het event dat hem opleverde: de tool-call,
de uitvoer, de bestandshash. Klik op de zin "je server luistert op 6769" en je ziet
de `ss`-uitvoer, het moment, en welk device het draaide.
**Waarom alleen hier:** chat-apps hebben geen keten; hun antwoord is proza. Roan
heeft per bewering een onveranderlijk record. Dit maakt hallucinatie *zichtbaar*
in plaats van onvermijdelijk.
**Scope:** een `citation`-veld op assistant-delen, een klikbare chip in het
transcript, en een sprong naar het event. Geen nieuwe machinerie.

### 2. Device-aware routing
De agent kiest het device dat het werk kán doen: "open dat bestand" gaat naar de
laptop die het heeft, "start de daemon" naar de server, "maak een foto" naar de
telefoon. In het transcript staat welke node het deed, en waarom.
**Waarom alleen hier:** Hermes draait op één machine; de tools zien alleen daar.
Roan heeft per device een daemon met eigen rechten, bestanden en hardware.
**Scope:** een router boven `run_on_node` die per tool kijkt naar pad-bezit,
`access.fullDisk`, en hardware (camera, microfoon), met een eerlijke weigering als
geen enkele node kan.

### 3. Terugspoelen van de machine, niet alleen het gesprek
Een checkpoint is nu een gesprekspunt. Maak er een *systeempunt* van: de keten, de
workspace en de tool-uitkomsten op dat moment. "Zet mijn computer terug naar 14:02"
is dan een echte dry-run met een diff die je eerst ziet.
**Waarom alleen hier:** git bewaart code, geen agent-acties; chat-apps bewaren
alleen tekst. Roan heeft de volgorde van álles.
**Scope:** checkpoint markeert seq + workspace-hash; rewind toont eerst een diff
van bestanden en events, en past pas toe na goedkeuring.

## De rest, in volgorde van hoe graag ik ze zou zien

### 4. Vraag het je eigen verleden
"Wanneer heb ik die service voor het laatst herstart, en wat zei de log?" — een
vraag over je eigen keten, beantwoord met events en tijdstippen als bron. Geen
embeddings-truc: de keten is al gestructureerd, dus dit is een query met een
taalmodel ervoor.
**Waarom alleen hier:** niemand anders heeft jouw handelingen als database.

### 5. Een beurt overgeven tussen devices
Begin een taak op de telefoon, loop naar je pc, en pak hem daar over — dezelfde
beurt, dezelfde context, dezelfde rechten, zonder iets te herhalen. Het eigendom
van de lopende beurt verschuift in de keten.
**Waarom alleen hier:** de beurt is een event, niet een websocket-verbinding.

### 6. Een sleutel uitlenen zonder hem te geven
Een taak die op de server loopt heeft jouw provider-key nodig? Laat de server de
*aanroep* doen via de telefoon, die de sleutel heeft. De sleutel reist niet; alleen
het antwoord komt terug.
**Waarom alleen hier:** de daemon op het andere device is een echte uitvoerder met
zijn eigen secrets. Dit is een secrets-broker zonder kluis.

### 7. Budget per taak, hard
"Deze taak mag €0,50 en 10 minuten kosten." De agent stopt zelf, ook als de taak
over drie devices loopt, en toont waar het budget heen ging.
**Waarom alleen hier:** kosten worden nu per beurt gemeten; de keten kan ze per
taak optellen, over nodes heen.

### 8. Een sessie als tijdlijn afspelen
Als een debugger door een gesprek: stap voor stap, met per stap de tool, de
uitvoer, de diff en de duur. Handig om te zien waaróm iets misging, en om een
geslaagde run als recept te bewaren.
**Waarom alleen hier:** de keten is al een log met volgorde en hashes.

### 9. Regels met een audittrail
Een policy is nu een instelling. Maak hem een *event*: wie heeft wat toegestaan,
wanneer, en welke tool gebruikte dat mandaat. Elk device kan terugkijken en
intrekken.
**Waarom alleen hier:** toestemming is nu lokaal; in een keten is het deelbaar en
herleidbaar.

### 10. De nachtploeg
Een geplande ronde die 's nachts je dag samenvat, verouderde herinneringen
voorstelt te wissen, openstaande beloftes uit gesprekken haalt, en 's ochtends één
briefing klaarzet — uitgevoerd op de node die dan wakker is.
**Waarom alleen hier:** cron bestaat overal, maar een agent die zijn eigen
geheugen onderhoudt op de machine die aan staat, is nieuw.

### 11. Telefoon als zintuig
De camera, microfoon en locatie van je telefoon als tools voor de agent die op je
server werkt: "kijk wat er op dit formulier staat" of "neem op wat er gezegd
wordt" — het device doet de meting, de agent doet het denkwerk.
**Waarom alleen hier:** de daemon staat al op de telefoon met toestemming per
actie.

### 12. Werk samen in dezelfde beurt
Twee devices kijken live mee met dezelfde beurt: jij typt op de pc, je ziet het
op de telefoon, en de ander kan bijsturen zonder een tweede gesprek te starten.
**Waarom alleen hier:** de beurt is gedeelde staat, geen privé-stream.

## Wat ik hiervan vind

1, 2 en 3 zijn geen "features erbij" maar de reden om Roan te gebruiken in plaats
van een chat-app: **je kunt zien waar een antwoord vandaan komt, het juiste device
laat het werk doen, en je kunt terug.** De rest is goud, maar volgt.
