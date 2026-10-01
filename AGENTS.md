---
type: Overview
title: AGENTS
description: Werkafspraken voor elke agent of mens die aan Roan werkt — het bord, de suite, de ontwerpregels en de valkuilen die al een keer hebben gebeten.
tags: [roan, agents, workflow, reference]
status: stable
---

# AGENTS

Dit bestand is voor jou, niet voor de gebruiker van Roan. Het bevat wat je niet
uit de code kunt aflezen: waar het werk heen gaat, hoe je het bord bijhoudt, en
welke fouten hier al één keer gemaakt zijn.

Lees daarnaast [`index.md`](index.md) (de inhoudsopgave van de kennisbundel),
[`architecture.md`](architecture.md) en [`pitfalls.md`](pitfalls.md). De
**code is de waarheid**; waar een claim door de suite wordt afgedwongen, zegt het
concept dat ernaast staat.

Verderop in dit bestand staat **Eisen van de gebruiker**: richting die nog niet
gebouwd is. Controleer daar of iets wat je bouwt al bedoeld was.

---

# Het projectbord is verplicht werk, geen administratie

Board: <https://github.com/users/roanh47/projects/4> — project-id
`PVT_kwHOBpzE0s4BlMGr`, owner `roanh47`, repo `roanh47/Roan`.

Drie kolommen: **Todo**, **In Progress**, **Done**.

De regels, kort:

1. **Elke feature request wordt een issue op het bord.** Vraagt iemand om iets
   nieuws — ook "klein" en ook midden in een gesprek — dan maak je een issue en
   zet je het op Todo. Niet in je hoofd bewaren, niet in een TODO-comment in de
   code. Een request dat alleen in een chat bestaat bestaat niet.
2. **Verplaats items als je eraan werkt.** Begin je aan iets dat op Todo staat,
   zet het op In Progress. Maak je het af, zet het op Done. Laat je iets liggen,
   zet het terug op Todo en zeg in het issue waarom het stil ligt.
3. **Een issue is klaar als de suite groen is én er een comment op staat** met wat
   er werkelijk gedaan is, inclusief commit-hashes. "Klaar" zonder toelichting is
   een lege issue.
4. **Een issue sluit niet omdat het bord zegt dat het klaar is.** Sluit het als
   het werk af is en de commit gepusht is.
5. **Controleer het bord bij het begin van een sessie**, niet alleen aan het eind.
   Anders bouw je opnieuw op wat er al ligt.

Commando's:

```bash
gh issue list --state open
gh project item-list 4 --owner roanh47 --format json
gh project view 4 --owner roanh47
```

Een item op een kolom zetten gaat via GraphQL, want `gh` heeft geen `--status`:

```python
# single_select wil singleSelectOptionId, NIET {text: ...}
mutation($proj:ID!,$item:ID!,$field:ID!,$opt:String!) {
  updateProjectV2ItemFieldValue(input:{projectId:$proj,itemId:$item,
    fieldId:$field,value:{singleSelectOptionId:$opt}}){projectV2Item{id}}
}
```

Velden: project `PVT_kwHOBpzE0s4BlMGr`, Status-veld
`PVTSSF_lAHOBpzE0s4BlMGrzhj56hc`, en de opties Todo `f75ad846`,
In Progress `47fc9ee4`, Done `98236657`.

`tests/project_board.py` zet het bord op vanaf de backlog in
[`ideas.md`](ideas.md). **Let op:** dat script noemt kolommen `To Do`, `Doing`,
`Done`, terwijl het bord `Todo`, `In Progress`, `Done` heet. Dat is een
bekende mismatch; het script is nog niet bijgewerkt. Gebruik de IDs hierboven.

---

# Pushen

De branch is `pre-release`. Er is een echte `origin`, en werk dat niet gepusht
is, bestaat niet.

```bash
git add -A && git commit && git push origin pre-release
```

Kijk **voor** het committen naar `git status --porcelain` en
`git diff --stat`. Twee dingen die hier misgingen:

- Een `git add -A` na een gerichte fix sloopte drie andere gedane reparaties mee
  onder een commit-message die ze niet beschreef. Controleer wat er werkelijk in
  de commit zit: `git show --stat HEAD`.
- Er lagen zeven commits ongepusht terwijl er verder werd gewerkt. Push tussentijds,
  niet alleen aan het eind van een lange sessie.

Commit-stijl is Nederlands, `type: omschrijving`, met de commit-hash erin
genoemd in de issue-comment. Types die hier gebruikt worden: `fix`, `feat`,
`docs`, `style`, `chore`, `revert`.

---

# Bouwen en testen

Python 3.10+, Textual 8.x. **Gebruik de virtualenv van de repo**, niet de
systeempython:

```bash
/home/roan/Roan/.venv/bin/python -m pytest tests/ -q          # de suite
/home/roan/Roan/.venv/bin/python tests/validate_okf.py        # kennisbundel-validatie
/home/roan/Roan/.venv/bin/python tests/generate_file_map.py   # file-map.md bijwerken
/home/roan/Roan/.venv/bin/python -c "import roan.tui"         # roept het hele thema op
```

De suite draait op `asyncio_mode = auto`; een test hoeft geen
`@pytest.mark.asyncio` als hij async is, maar de meeste hebben hem wel.
De installatie is **editable**, dus een wijziging in de bron werkt meteen bij de
volgende `roan`.

Na elke wijziging in `roan/tui.py` of `roan/photo.py`:
`generate_file_map.py` draaien, anders faalt `test_okf_bundle.py`.

---

# Kennisbundel: ieder .md-bestand moet valid zijn

De repository **is** de kennisbundel (OKF v0.2). Elk `.md` behalve `index.md` en
`log.md` heeft YAML-frontmatter met een **niet-lege `type`**. Dat geldt dus ook
voor een nieuw bestand zoals dit.

```yaml
---
type: Overview        # of Concept, Reference, Architecture, ...
title: ...
description: ...
tags: [roan, ...]
status: stable
---
```

De map `roan/` bevat een `.md` naast elk `.py`: `tui.md`, `themes.md`,
`providers.md`, … Dat is de conventie. Wie een module toevoegt, voegt zijn
conceptbestand mee; wie een gedrag verandert, werkt het bestand bij.

---

# Ontwerpregels die niet onderhandelbaar zijn

Deze zijn door de gebruiker expliciet vastgelegd. Ze staan in
[`roan/design-system.md`](roan/design-system.md) en
[`roan/themes.md`](roan/themes.md); hier staat waarom ze hard zijn.

**Vier Catppuccin-smaken, pink als het enige accent.** `latte`, `frappe`,
`macchiato`, `mocha`, met `mocha` als default. Ze worden gekloond uit
`BUILTIN_THEMES["catppuccin-<smak>"]`, dus elke kleur die Roan niet aanraakt komt
uit de officiële palet. Er is geen `roan`-thema en er komt geen thema bij: die
vervanging is een keer gedaan en teruggedraaid.

| smaak | achtergrond | panel | pink |
|---|---|---|---|
| latte | `#EFF1F5` | `#CCD0DA` | `#EA76CB` |
| frappe | `#303446` | `#51576D` | `#F4B8E4` |
| macchiato | `#24273A` | `#494D64` | `#F5BDE6` |
| **mocha** | `#181825` | `#45475a` | `#F5C2E7` |

**Layout zoals opencode.** Eénregelig inputkader `╭ ╮ ╰ ╯`, een statusbalk eronder
met `◆ model · provider` links en `Think: … · Mode: … · Approvals: … · ctrl+p
commands` rechts, en de avatar zwevend in de rechterbovenhoek. De chat loopt
onder de avatar door.

**Werkt het, dan het zo.** Er zijn gevallen waarin "best practice" botste met wat
de gebruiker wilde en diezelfde opdracht had: pixels van een border, een breedte
van 5, twee kolomen ertussen, geen lucht in een kader. Vraag niet om toestemming
voor de standaardoplossing als de opdracht ertegenin gaat — bouw wat er gevraagd
is, en meld het als je denkt dat het beter kan.

---

# Eisen van de gebruiker — richting, nog niet gebouwd

Deze eisen komen van de gebruiker en zijn **langetermijnrichting**, geen werk voor
de volgende sprint. De code blijft de waarheid; deze lijst zegt waar het heen
moet. Er staat nog veel niet gebouwd, dus schrijf er nooit "dit werkt" bij.

Per eis: wat de eis is, hoe het er nu staat, en waar hij in de bundel hoort. Het
conceptbestand is de plek waar een eis blijft staan; hier staat de richting. Is
een eis af en doorgevoerd, dan verwijs je hem door en haal je hem hier weg — anders
gaat een volgende agent hem opnieuw bouwen.

## 1. Tien jaar werken zonder update

Letterlijk van de gebruiker: **Roan moet tien jaar blijven werken zonder update.**
Dat is een ontwerpregel, net zo hard als het pink-accent. Alles wat buiten de repo
kan veranderen wordt daarom **live opgehaald op het moment van gebruik**, nooit
ingebakken:

- providers en modellen komen van **models.dev** op het moment van gebruik, niet
  uit een lijst in de repo;
- prijzen, mogelijkheden en beschikbaarheid idem;
- elk skill- of stijldocument komt van zijn canonieke externe bron op het moment
  van gebruik.

Wat er nu staat: [`roan/models.md`](roan/models.md) doet dit voor de modellen —
`_dev_data()` haalt `https://models.dev/api.json` op met een cache van 300 s en
valt terug op de `/models` van de provider zelf. Wat **niet** klopt is de
consequentie: `_dev_data()` vangt elke exception en geeft de laatste cache of `{}`
terug. Een schemaverandering van models.dev is daarmee onzichtbaar; het scherm
zegt "geen modellen gevonden" en Roan doet alsof er niets aan de hand is. Dat is
precies wat deze eis verbiedt.

Het gevolg moet twee delen hebben:

1. **Een vastgezette, gevalideerde responsvorm.** Het models.dev-schema wordt
   gepind, zodat een verdwenen veld of een ander type één leesbare fout geeft in
   plaats van honderd `KeyError`s op de achtergrond.
2. **Hard falen.** Bij een kapotte of onbekende respons stopt het met een duidelijke
   melding. Verouderde cache stilletjes serveren is uitgesloten.

Bewust **niet** live: het palet en het accent. Die zijn door de gebruiker
vastgezet; dat is een beslissing, geen veroudering — zie
[`roan/palette.md`](roan/palette.md) en [`roan/pink-accent.md`](roan/pink-accent.md).
Maak er geen runtime-fetch van; dat haalt de vastgezette keuze op.

Thuis in de bundel: het bronschema en de foutmelding in
[`roan/models.md`](roan/models.md); de vastgezette versie als instelling in
[`roan/config-keys.md`](roan/config-keys.md), met een override in
[`roan/env-vars.md`](roan/env-vars.md) zodat een server naar een eigen kopie kan
wijzen zonder de code te raken.

## 2. De Writing Style skill is altijd aanwezig en altijd de laatste

De schrijfstijl van Roan geldt voor **alles wat Roan schrijft**, en het document
komt van GitHub. Doel: een nieuwere stijl werkt **zonder een nieuwe
Roan-release**. Zeg het ongeveer zo, want dit is de formulering die telt: als Roan
2.0 is en de schrijfstijl 3.0 is, dan gebruikt Roan 3.0. Een release is geen
reden om de stijl te pinnen.

Drie dingen die erbij horen:

- **Het stijldocument heeft een versie.** Die wordt uitgelezen, niet geraden uit de
  inhoud.
- **De opgehaalde versie wordt ergens in `~/.Roan` vastgelegd** voor diagnose. Vraag
  het je af na een storing: welke stijl draaide deze installatie?
- **Geen netwerk is geen stilzwijgende terugval.** Je krijgt de gecachte kopij,
  mét een zichtbare aanduiding dat die verouderd is. Anders denkt de gebruiker
  dat de nieuwe stijl draait, en dat klopt niet.

Wat er nu staat: niets. Skills zijn lokale bestanden in `~/.Roan/skills/` en de
prompt krijgt alleen naam en beschrijving, het lichaam op verzoek via `read_skill`
— zie [`roan/skills-memory-profile.md`](roan/skills-memory-profile.md). Er wordt
niets van GitHub gehaald.

Thuis in de bundel: de stijl als skill in
[`roan/skills-memory-profile.md`](roan/skills-memory-profile.md), de bron-URL en de
vastgelegde versie in [`roan/config-keys.md`](roan/config-keys.md), een
netwerk-uitschakelaar in [`roan/env-vars.md`](roan/env-vars.md). Het cachepad
hoort bij de paden in `roan/config.py`, en `ensure_home()` in `roan/home.py` maakt
de map aan — zie [`roan/configuration.md`](roan/configuration.md).

## 3. Identiteit en opslag, zoals hermes / opencode / claude

Hermes weet dat hij Hermes heet, opencode weet dat het openCode heet, Claude weet
dat het Claude heet. **Roan moet weten dat het Roan is, en dat ook zeggen.** In de
system-prompt, niet in een persona die het model verzint.

Daarnaast één **gecentraliseerde plek voor identiteit en voor wat de gebruiker
heeft meegegeven**. Alles onder `~/.Roan`: config, sessions, cache, logs, plans,
skills. Nergens anders toestand — niet in de werkmap, niet in de repo, niet in
een losse dotfile elders.

Wat er nu staat: de opslag is grotendeels gecentraliseerd. `roan/config.py`
definieert de paden (`ROAN_DIR` en de rest) en `ensure_home()` in `roan/home.py`
maakt de structuur aan. Twee wankelkheden: `agent.py` maakt zijn **eigen**
`SESSIONS_DIR` aan in plaats van de paden uit `config.py` te gebruiken, en de
identiteit staat **verspreid** — de naam in `DEFAULT_INSTRUCTIONS` in
`roan/i18n.py`, de feiten over de gebruiker in `~/.Roan/user.md`. Dat is precies
wat deze eis afschaft.

Het gecentraliseerde record hoort naast die twee plekken: wie Roan is (naam,
versie, eigen toestand) plus wat de gebruiker meegaf (profiel, instructies,
skills, memory) in **één** record, in plaats van vier bestanden die elk één stuk
bevatten. Open vraag, en blijf hem als vraag staan: één bestand in `~/.Roan`, of
een blok in `config.json`? Kies één, en houd ze niet allebei.

Thuis in de bundel: [`roan/configuration.md`](roan/configuration.md) voor de
layout van `~/.Roan`, [`roan/capital-r-home.md`](roan/capital-r-home.md) voor de
naam en de map, en de volgorde waarin het in de system-prompt komt in
[`roan/agent.md`](roan/agent.md).

## 4. Dingen bereiken zonder API-sleutels

Roan moet dingen kunnen **zien** — de GitHub-repositories van de gebruiker en
vergelijkbare dingen — via gewone webaanroepen waarvoor **geen API-sleutel**
nodig is. Later komt OneDrive erbij. Zo wordt alles wat de gebruiker ooit maakte
en publiceerde bereikbaar vanaf één plek, uiteindelijk ook op een publieke URL.

De gevolgen staan vast en zijn niet onderhandelbaar:

- **alleen ongeauthenticeerd lezen** — geen token, geen OAuth, geen account;
- **read-only als uitgangspunt** — schrijven komt niet zonder nieuw besluit;
- **geen credentials in `config.json`**, ook niet voor iets "dat toch publiek is";
- **rate limits en voorwaarden respecteren** — identificeer je, houd je rate in, en
  pak een `Retry-After` op;
- **verzin nooit data die je niet kon ophalen** — mislukt de fetch, dan zeg je dat.

Wat er nu staat: `roan/tools.py` heeft `fetch_url` en `web_search`. Dat is de
naad. Er is geen repositorylijst, geen OneDrive, geen galerij.

Thuis in de bundel: [`roan/tools.md`](roan/tools.md) voor wat het model mag
aanroepen, [`local-first.md`](local-first.md) voor het principe "geen sleutels,
geen account" waar dit precies bij past, en
[`roan/config-keys.md`](roan/config-keys.md) voor de regel dat er geen
credentials in de config komen. Let op: dit is wel uitgaand verkeer, maar dan
naar publiek materiaal en alleen lezend. Zet het in
[`local-first.md`](local-first.md) als het gebouwd wordt, want die beslissing gaat
er nu over.

## 5. Berichten in de wachtrij

Terwijl Roan nog antwoordt, typ je de volgende opdracht gewoon door. Die gaat in
de wacht en wordt verstuurd **daarna**. Dit wordt nu gebouwd; hier staat de
bedoeling, zodat hij daarna afgedwongen blijft.

Het bedoelde gedrag, concre genoeg om een test op te schrijven:

- een getipt bericht gaat **nooit verloren** en komt **nooit midden in een
  antwoord** binnen;
- de volgorde is de volgorde van typen — twee berichten gaan in die volgorde de
  deur uit;
- het is **zichtbaar** dat er iets wacht, anders lijkt het of de input de tekst
  opat;
- na het lopende antwoord gaat het vanzelf, zonder tweede Enter.

Een wachtrij die een latere refactor stilzwijgend verliest is geen functionaliteit
maar een regressie. Wat hier staat moet terug in de suite.

Thuis in de bundel: [`roan/tui.md`](roan/tui.md) voor het invoer- en verzendpad,
[`request-lifecycle.md`](request-lifecycle.md) voor wat er per beurt gebeurt.

## 6. De basiskennis bijwerken

De gebruiker wil een **voor de hand liggende, gecentraliseerde manier om Roan
nieuwe informatie te geven of te veranderen wat hij weet**, en wil die kennis
bovendien vanaf een externe bron actueel kunnen houden.

Wat er nu staat: de kennis zit verspreid over vier bestanden — `instructions.md`,
`user.md`, `memory.md` en `skills/` (zie
[`roan/skills-memory-profile.md`](roan/skills-memory-profile.md)). Er is geen plek
waar je zegt "dit is wat ik weet", en niets ervan komt van buiten de machine.

**Open vraag, en blijf hem als vraag staan:** waar staat de canonieke kopie? In
deze repo, of in een externe bron die Roan ophaalt? Twee eisen uit dit document
verkleinen de keuze al: die canonieke kopie kan niet in `~/.Roan` staan, want daar
hoort alleen toestand te staan en twee canonieke kopijen zijn erger dan één; en
wat Roan op het moment van gebruik leest is een cache onder `~/.Roan/cache`. Voor
het ophalen zelf geldt dezelfde discipline als eis 1 en 2 — één mechanisme, niet
drie.

Thuis in de bundel: [`roan/skills-memory-profile.md`](roan/skills-memory-profile.md)
voor de kennisbestanden zelf, [`roan/config-keys.md`](roan/config-keys.md) voor
de externe bron, [`roan/env-vars.md`](roan/env-vars.md) voor de
netwerk-uitschakelaar.

## Wat hier nog niet staat

- [ ] models.dev-schema vastgezet, en hard falen bij een afwijking — eis 1
- [ ] Writing Style als live skill, met versie, cache en een staleness-aanduiding
      — eis 2
- [ ] één identiteits- en kennisrecord, in plaats van i18n plus `user.md` — eis 3
- [ ] repositories, en later OneDrive, zonder sleutels — eis 4
- [ ] wachtrij: in uitvoering, nog zonder test — eis 5
- [ ] centrale basiskennis, en de beslissing over de canonieke kopie — eis 6

Raakt een van deze punten je werk, maak dan een issue op het bord en verwijs hier
vandaan naar het conceptbestand. Niet stilletjes omzeilen, en niet "voorlopig" in
de code zetten zonder dat hier te staan.

---

# Valkuilen uit deze sessie

Deze zijn nieuw en staan nog niet in [`pitfalls.md`](pitfalls.md). Zet ze er
eventueel bij als ze bevestigd blijken.

**Een rand op een widget met een hoogte van 1 maakt de content-hoogte 0.**
`#input` had `border: round` en de generieke `Input { height: 1 }`. De rand at
beide cellen op, de content-hoogte werd 0 en getypte tekst werd **nooit getekend** —
ondanks een correcte `color`. Dit zag eruit als een kleurprobleem en was het
niet. Altijd `content_size` meten, niet naar de CSS kijken.

**Padding op een widget met een vaste breedte breekt lange regels af.**
`#avatar` had `padding: 0 2` terwijl de breedte op het aantal kolommen van de
tekening werd gezet. De bruikbare breedte was vier cellen kleiner dan de tekst en
Rich wrapte elke regel in 12 + 4, met losse streepjes ertussen. Fix: geen
horizontale padding, en altijd controleren of elke rij even lang is.

**`styles.width` is de buitenste maat (border-box).** Een rand is al meegerekend.
Zet je breedte op de inhoud, dan wordt de inhoud kleiner dan gevraagd.

**Een tekencel is twee keer zo hoog als breed.** Dus een vierkante afbeelding is
`N` kolommen bij `N/2` rijen, en een kader van 26×14 cellen **oogt** al vierkant.
Een kader met 4 extra kolommen erbij is wél exact vierkant maar heeft dan lege
kolommen ernaast. Kies wat eruitziet zoals gevraagd, niet wat rekenkundig klopt.

**`str(None)` op een lege themakleur geeft de string `"None"`.** `textual-dark`
heeft geen `background` en `textual-light` geen `foreground`, omdat ze de
terminalkleur overnemen. `Color.parse("None")` gooit een `ColorParseError` en
dan start het programma **niet**. Elk kleurveld wordt gecontroleerd op `None`
vóór het in een `Theme` terechtkomt.

**`$panel` mag niet `$surface` zijn.** Dat maakt invoervelden onzichtbaar tegen
het popupvlak. Ze hebben drie verschillende vlakniveaus nodig.

**`App.CSS` geldt voor álle schermen in de app**, ook voor popups. Een `.close`
of `.titlebar` regel die in de app-CSS stond, stylede daarmee elk popupkruisje.
Die regel weghalen brak zeven tests tegelijk. Verwijder geen app-CSS zonder te
controleren wie er nog van afhangt.

**CSS-specificiteit in de weg.** `.popup Button { min-width: 6 }` (0,2,0) won van
`.close { width: 5 }` (0,1,0), dus het kruisje werd 6 breed en niet gecentreerd.
`.popup Button.close` wint wel.

**Rich-markup in een `Static` wint van de CSS.** `update("[b #f5c2e7]Think[/]")`
overtroefde `color:` uit de stijl, waardoor `:hover` niets deed. Kleuren die de
hover moet kunnen aanpassen horen in de CSS, niet in de tekst.

**`[dim]` is relatief aan de huidige kleur**, dus de `·` tussen de chips werd
meerroze bij hover. Een absolute kleur in de markup maakt hem hover-proof.

**`justify="right"` op een rich `Text` wordt weggegooid.** `Content.from_rich_text()`
laat hem vallen; uitlijnen kan alleen met handmatige padding, en dan moet de lijst
opnieuwbouwen bij een resize.

**`App._on_resize` zet de nieuwe grootte ná het dispatchen.** `self.size` in
`on_resize` is nog de oude maat. Een zwevend element dat zijn `offset` uit
`self.size` rekende, liep daardoor één resize achter. Doe het werk in
`call_after_refresh`.

**`layer: overlay` doet niets zonder `layers` op het Screen.** Anders valt het
terug op laag 0 en tekent een later samengestelde widget erover.

**Zonder `COLORTERM` denkt Textual dat 256 kleuren genoeg zijn.** Dan
kwantiseert het de Catppuccin-kleuren: `#181825` werd `#000000` en `#313244`
werd `#5F5F5F` — precies wat de gebruiker meldde. `roan/cli.py` zet daarom
`COLORTERM` en `TEXTUAL_COLOR_SYSTEM` vóór de eerste `import textual`.

**De halfcell-renderable van `textual_image` negeert het alfakanaal** en tekent
doorzichtige pixels **wit**. Dat gaf een witte vlak achter de avatar. Bij geen
echt beeldprotocol tekenen we de avatar dus zelf, op de thema-achtergrond.
`textual_image` kiest Sixel → TGP → Halfcell op basis van een probe naar de
terminal; terminals die het protocol niet *aankondigen* vallen terug, dus er is
`ROAN_IMAGE=sixel|tgp|halfcell` als overstemming.

**Geen `justify`, geen `Content`, en `[dim]`** — zie hierboven. Dit zijn drie
verschillende manieren waarop een vanouds werkende `.hover` stilzwijgend doodging.

**Bij een bulksgewijze bewerking: `git diff --stat` en de lijst van verdwenen
`def`s.** Eén verkeerd anker haalde 374 regels uit `tui.py` in plaats van 56.

---

# Werken met subagents

De gebruiker wil subagents, zodat hij kan onderbreken. Geef elke agent:

- **één eigenaarschap**: welke bestanden hij mag aanraken, en welke uitdrukkelijk
  niet (met de reden). Twee agents in hetzelfde bestand is een conflict dat wacht.
- **gemeten waarheid, geen aannames**: geef de regels uit de pty/scratch-output mee
  die het gedrag bepalen, zodat hij niet hoeft te raden.
- **de exacte eis erbij**, ook als die raakt aan wat "best practice" zegt.

Laat een agent rapporteren met de metingen voor en na, en verifieer de metingen
daarna zelf. Een agent die zegt "klaar" met een verplichting naast zich, is een
agent die iets niet deed — dat is twee keer zo gebeurd.

Verifieer altijd zelf, ook als het rapport overtuigend is:

```bash
.venv/bin/python -m pytest tests/ -q
.venv/bin/python -c "import roan.tui"     # vangt een themacrash meteen
```

---
