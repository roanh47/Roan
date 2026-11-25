# Het aggregator-commando (één paste voor de hele dag)

Plak dit als één /goal. De specs staan in `docs/goals-0.0.23.md`; dit commando
laat een aggregator die 34 goals als subagents uitvoeren, golf voor golf, en
elke oplevering zelf verifiëren voordat hij hem als klaar boekt.

```
Roan 0.0.23 in één run: een aggregator die alle 34 features laat bouwen en niets als klaar aanneemt voordat het bewijs groen is. Repo /home/roan/Roan. Geen push, geen tag.

Je bent de aggregator. Je implementeert zelf niets, behalve integratiefixes die geen enkel kind kan doen (noteer die als zodanig). De specs staan in docs/goals-0.0.23.md: 34 goals, en de "Bewijs:"-regel van elke goal ís de acceptatiecriteria.

Werkwijze:
1. Lees docs/goals-0.0.23.md en maak docs/goals-progress.md aan: per goal één regel met status (pending / in-progress / done / blocked), bewijs (nieuwe tests + output-samenvatting), aantal pogingen en de reden bij blocked.
2. Werk in golven van maximaal 5 subagents met niet-overlappende bestandsgebieden; dezelfde module nooit twee kinderen tegelijk. Golfvolgorde: goals 1-4, dan 5-10, 11-15, 16-18, 19-23, 24-27, 28-31, 32.
3. Elke subagent krijgt de letterlijke spec van zijn goal, zijn bestandsgebied, en dit contract:
   - "Je bent pas klaar als je de Bewijs-regel van je goal aantoont: nieuwe tests die bewijzen dat het werkt, plus `npx tsc -p tsconfig.json --noEmit`, `npm run build`, `node --test $(find dist -name "*.test.js")`, `npx tsx --test tests/*.test.ts`, en `cd web && npx tsc -p tsconfig.json --noEmit && npx vitest run` — alles groen, met echte output in je rapport."
   - "Blijf binnen je bestandsgebied; raak geen bestanden van andere goals aan. Geen push, geen tag, geen emulator, geen apk."
   - "Rapporteer pas DONE als die output groen is. Anders rapporteer je NOT DONE met de exacte fout en wat er al ligt."
4. Na elke golf verifieer je zelf, nooit op hun woord: draai de suites, bekijk `git diff --stat` en de nieuwe tests, en herhaal de Bewijs-regel per goal. Faalt er iets, spawn dan een fix-subagent met de exacte fout, maximaal 3 pogingen per goal; daarna status blocked met reden en door naar de volgende golf — nooit stilzwijgend goedkeuren.
5. Houd de ledger na elke golf actueel en commit lokaal per golf (`git add -A && git commit`). Nooit pushen.
6. Als de 32 bouwgoals done of blocked zijn: goal 33 (de bewijsronde: emulator + mocks, zeven screenshots, blob-bestand >512 kB via adb, apk 0.0.23 arm64 met md5) en goal 34 (het eindrapport). Die mogen als subagent, maar jij controleert de artefacten zelf: bestanden bestaan, md5 klopt, screenshots staan op schijf.
7. Eindlevering: docs/goals-progress.md met de definitieve stand, het eindrapport in docs/, 3 regels status (wat werkt / wat niet / wat ik moet weten), plus eerlijk hoeveel goals blocked zijn en waarom.

Je werkt zelfstandig, zonder mij iets te vragen; meld alleen echte blokkades. Geen push, geen tag. AAN HET EINDE VAN DEZE RUN: 3 regels status. Geen volgend /goal — deze run is de dag.
```

## Waarom het zo verdeeld is

- **Golven, geen 34 tegelijk**: 34 kinderen die dezelfde repo bewerken vechten om
  `main.ts`, `tools.ts` en de web-UI. Vijf tegelijk met eigen gebieden houdt de
  diffs schoon en de suites draaibaar.
- **De Bewijs-regel is de meetlat**: een kind dat "klaar" zegt zonder groene
  output wordt door de aggregator teruggestuurd, niet geloofd.
- **Blocked bestaat**: na drie pogingen gaat een goal als blocked in de ledger en
  gaat de golf door. Aan het eind zie je precies wat er niet af is.
- **Herstartbaar**: de ledger is de staat. Loopt de run tegen een limiet, dan pakt
  een nieuwe paste de pending/blocked-regels op waar ze staan.
