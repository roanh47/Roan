# De lus: hoe ik zonder opdrachten doorwerk

Dit is de vaste werkwijze voor elke ronde. Geen vraag, geen verslag halverwege;
één ronde per keer, en pas rapporteren als er iets te melden is.

## Elke ronde

1. **Pak het eerste open item** uit `docs/QUEUE.md`. Niets anders.
2. **Lees de bron** die erbij staat: de Hermes-module in
   `/home/roan/.hermes/hermes-agent` en het Roan-bestand dat het raakt. Geen
   aanname over wat er in staat.
3. **Bouw het klein**: één gedrag, één test die dat gedrag bewijst. Geen
   refactor ernaast, geen extra scherm.
4. **Gate**: `npx tsc -p tsconfig.json --noEmit`, `npm run build`,
   `node --test $(find dist -name "*.test.js")`, `npx tsx --test tests/*.test.ts`,
   `cd web && npx tsc -p tsconfig.json --noEmit && npx vitest run`.
5. **Commit** met het item-id in de titel (`Q3: ...`). Geen push, geen tag.
6. **Vink af** in `docs/QUEUE.md` met één regel bewijs (bestand + testnaam).
7. **Faalt het drie keer**, zet het item op `blocked` met de exacte fout, schrijf
   in één zin wat je hebt geleerd, en ga door naar het volgende item.

## Regels die nooit veranderen

- **Niet pushen, niet taggen, geen emulator** tenzij het item het expliciet zegt.
- **Geen versienummer per fix.** Pas bumpen als de gebruiker om een build vraagt.
- **Bewijs of het bestaat niet.** Een claim zonder uitvoer erbij is een fout, ook
  als de code klopt.
- **Eén bron per bewering.** Verwijs naar bestand + regel of naar een testnaam.
- **Niets stilzwijgend goedkeuren.** Een overgeslagen test, een `skip`, een
  `catch {}` die een fout wegstopt: dat is een fout, geen detail.
- **Geen hoop werk in één commit.** Kleine stappen, zodat een terugdraai mogelijk is.

## Wat ik zelf mag beslissen

- De volgorde binnen een item, de namen van functies, welke test als eerste.
- Een item splitsen als het groter blijkt dan één ronde — de rest komt erachter
  in de queue, niet in dezelfde commit.
- Een item naar `blocked` zetten als de bron ontbreekt of tegenstrijdig is.

## Wat ik niet zelf mag beslissen

- Publiceren, taggen, de keten van de gebruiker aanraken.
- Een feature verzinnen die niet in de queue staat (die gaat onderaan de queue).
- Iets als "klaar" melden zonder de gate-output.

## Ritme

Per ronde: één item, één gate, één commit. Na drie rondes: één regel per ronde in
`docs/QUEUE.md` onder "Gedaan", zodat de voortgang zichtbaar is zonder dat iemand
hoeft te vragen.
