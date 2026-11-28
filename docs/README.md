# docs/

Eén plek per onderwerp. `docs/README.md` (dit bestand) is de index; een bestand
dat hier niet in staat, hoort er niet te zijn.

## Wat Roan is en hoe het werkt

| Bestand | Waar het over gaat |
|---|---|
| `architecture.md` | het geheel: daemon per device, keten, app als frontend |
| `chain.md` | de keten: events, volgorde, tombstones, sync |
| `protocol.md` | de frames tussen app en daemon |
| `daemon.md` | de daemon: poort, env-variabelen, levensloop |
| `storage.md` | waar state staat (`~/.Roan`, workspace, chain.db) |
| `security.md` | rechten, goedkeuringen, secrets, sudo |
| `providers.md` | modellen, providers, sleutels |
| `api.md` | het HTTP/WS-oppervlak |
| `a2a.md` | device-naar-device (peer-link) |

## De app

| Bestand | Waar het over gaat |
|---|---|
| `app/app-features.md` | wat je in de app kunt doen, naast Hermes |
| `app/gui.md` | opbouw van de UI |
| `app/webui.md` | de webversie |
| `app/mobile.md` | Android-specifiek |
| `app/mobile-app-patterns.md` | ontwerpkeuzes die van mobiel komen |
| `app/turn-lifecycle.md` | wat er gebeurt tijdens één beurt |

## Bouwen en uitbrengen

| Bestand | Waar het over gaat |
|---|---|
| `ops/install.md` | installeren op een schone machine |
| `ops/run-it-locally.md` | lokaal draaien zonder release |
| `ops/packaging.md` | wat er in een pakket zit |
| `ops/release.md` | de release-flow |
| `ops/updates.md` | de updater |
| `ops/testing.md` | hoe de tests draaien |
| `ops/invite-flow.md` | een tweede device aan de keten hangen |

## Onderzoek en vergelijking

| Bestand | Waar het over gaat |
|---|---|
| `research/how-agents-are-built.md` | de literatuur: hoe een agent hoort te werken, met bronnen |
| `research/hermes-findings.md` | wat Hermes' broncode doet en Roan niet |
| `research/ideas.md` | functies die alleen deze architectuur kan hebben |
| `research/reference-apps-apk-analysis.md` | hoe andere apps hun apk opbouwen |
| `feature-parity.md` | de vergelijking met mainstream agents (66 rijen) |

## Geschiedenis

`history/` bevat afgesloten plannen en oude feature-overzichten. Ze zijn niet
actueel; ze staan er omdat ze beslissingen uitleggen. `TODO.md` in de root is de
enige levende takenlijst.
