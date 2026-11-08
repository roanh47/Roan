# @roanh47/roan

Naamhouder en launcher voor **Roan**, een terminal AI-agent harness.

De harness zelf is Python. Dit pakket bevat alleen `bin/roan.js`: dat zoekt
`roan` of `Roan` op je systeem, en anders `python3 -m roan`, en start hem met
de argumenten die je meegaf. Is de harness niet geïnstalleerd, dan zegt hij dat
en verwijst hij naar de installatie-instructies.

## Installeren

```bash
# de harness zelf
git clone https://github.com/roanh47/Roan.git
cd Roan
pip install -e .

# en dan
npx @roanh47/roan
```

Of, als je hem liever vastzet:

```bash
npm install -g @roanh47/roan
roan
```

## Waarom een npm-pakket voor een Python-programma

Twee redenen, geen van beide is distributie:

1. De naam `roan` op npm is bezet door een project dat sinds 2023 stil ligt,
   dus de scope `@roanh47` houdt de naam in eigen hand.
2. Wie toch in een node-omgeving werkt, kan `npx` gebruiken zonder eerst te
   weten dat hij Python moet aanroepen.

De echte code staat in <https://github.com/roanh47/Roan>.
