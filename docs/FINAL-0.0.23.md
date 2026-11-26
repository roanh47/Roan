# 0.0.23 — eindrapport van de orchestrator-run

Datum: 2026-11-26. Repo `/home/roan/Roan`, branch `main`. **Niets gepusht, geen tag.**

## Stand per feature

| # | Feature | Stand | Bewijs |
|---|---|---|---|
| 1 | Sync-terugstroom + presence | done | `scripts/proof-three-branches.cjs` PASS: backflow bereikt beide joiners, drie nodes houden beide takken, mirror-order per node; presence-tests (self blijft live) |
| 2 | Seq-hergroepering | done | `src/sync/order.ts` (ts, node, id) + tests met 3 en 4 gelijktijdige schrijvers |
| 3 | Updater met feed | done | `src/packaging/update-feed.ts`, `bundle-download.ts`, `update-flow.ts` (sha256), UI onderscheidt "unreachable" van "newest" |
| 4 | Installers en signing | done | AppImage gebouwd én gestart (window + daemon, 148 MB, 1m31s); `scripts/android-keystore.sh`; checklists in `docs/release.md` |
| 5 | Plan mode | done | tool-gating + `plan_mode`-frame + composer-toggle; tests bewijzen blokkeren en herstellen |
| 6 | Auto-memory | done | distillatie na de beurt (max 3, dedupe) + MEMORY.md-vouw, wired in `main.ts` |
| 7 | Goals | done | fold + context in de system prompt + `goal`/`goal_update`-frames + GoalsPanel naast Schedules |
| 8 | Effort levels | done | `providerId` + `ChatOptions.effort`, per familie (OpenAI/Anthropic/Google deep-merge), `effort`-frame |
| 9 | Kosten en tokens | done | usage per beurt in `turn_end` + regel onder het antwoord; sessietotaal open (App.tsx) |
| 10 | Achtergrondtaken | done | `schedule` (daily HH:MM / every 30m) in de bestaande cron-lus; BackgroundPanel niet gemount |
| 11 | Spraak invoer | done | `src/stt/**` (ABC + registry + lokale openai-compat plugin, 30+ tests); mic eerlijk uitgeschakeld |
| 12 | Import | done | discover/parse/plan/apply + `imported/`-env-root + `import_discover`/`import_plan`-frames |
| 13 | Steer mid-turn | done | inbox + alternation-guard + `steer`-frame + Steer-knop in de composer |
| 14 | Deep research | done | bounded plan→search→extract→report met citation-guard (39 tests); tool niet geregistreerd (open) |
| 15 | Device control | **blocked** | module + 16 tests; protocol-wiring (`device_req`, transport, `device_grant`) niet gedaan |
| 16 | Zijvragen en queueing | done | queue + side-sessie-ids + QueueBar; daemon-queueing open |
| 17 | Delen en exporteren | done | zelfstandige, volledig ge-escaped HTML-export + markdown-kop; HTML wordt nu ook geschreven bij export |
| 18 | Archief en tijdelijke chats | done | tombstones in de fold, `.all`-lookups, archive/delete-frames, SessionRow-component |
| 19 | Veiligheid | done | sandbox-detectie/wrap, éénmalige elevatie, untrusted-blokken (41 tests); `exec.ts`-hook open |
| 20 | Kennis | done | memory/session-zoek met bron + projecten-store; tool/prompt-wiring open |
| 21 | Commando's en hooks | done | parse/fold/expand + geïsoleerde hooks + SlashMenu; `command`-eventtype toegevoegd |
| 22 | Server en SDK | done | `docs/api.md` uit de code, typed ws-client (12 tests), deferred tools |
| 23 | Leren en rollen | done | voorstellen inactief tot goedkeuring (env-gedragen), `roleModel()` per rol |
| 24 | Browser | done | CDP-client + page-actions + fake-CDP-tests; geregistreerd als core-tool (BROWSER_CDP_URL) |
| 25 | Computer use | done | grant-store + gated actions + Linux-driverplannen (67 tests); approval-UI open |
| 26 | Generatie | done | provider-plugins (OpenAI images, ComfyUI) + registry/runtime (27 tests); tool-wiring open |
| 27 | Spraakgesprek | done | TTS-provider + listen→think→speak-lus (36 tests); mic/speaker uit de shell nodig |
| 28 | Werkplek | done | veilige file-library + CSV/TSV/JSON + chart-spec; `workspace_list`/`workspace_read` gewired |
| 29 | Code en git | done | LSP-probe/client-interface, porcelain+numstat-parsers, GitPanel; routing/commit open |
| 30 | Surfaces | done | `roan`-CLI over de control-socket (36 tests) + deep links (42 tests) |
| 31 | Koppelingen | done | signed webhooks in/uit met replay-guard, GitHub read-only connector, `docs/a2a.md` |
| 32 | Opruimen en docs | done | TODO/feature-groups/parity/daemon/security bijgewerkt tegen de code |
| 33 | Bewijsronde | **partial** | apk arm64 gebouwd, x86_64 op de emulator geïnstalleerd, app + `RoanService` draaien (screenshot `local/proof/round-0.0.23/app-running.png`); de zeven nieuwe-feature-screenshots en de blob-via-adb-check zijn niet meer gehaald |
| 34 | Eindrapport | done | dit bestand |

## Poort (laatste volledige run)

- `npx tsc -p tsconfig.json --noEmit` schoon
- `npm run build` schoon
- root: **1381/1381**
- `tests/`: **115/115**
- web: **126/126**
- `cli`- en `sdk`-typecheck schoon

## Wat bewust open bleef

1. **Device control (15)**: protocol-wiring. Exacte lijst staat in de ledger.
2. **UI-mounts**: ImportPanel, SessionRow in de rail, BackgroundPanel, GitPanel, QueueBar, computer-grant-scherm. De componenten bestaan en zijn getest; de app toont ze nog niet.
3. **Mic/speaker-capture** voor spraak (STT/TTS/lus staan; de shell moet audio leveren).
4. **Deep-research- en generate_image-tools** zijn modules, nog geen model-tools.
5. **memory_search-tool** idem; de zoekfunctie is er, de tool niet.
6. **Sessietotaal kosten** in de UI (per-beurt staat er).
7. **Bewijsronde**: app draait op de emulator, maar de zeven feature-screenshots en de blob-check via adb zijn niet gehaald binnen deze run.

## Wat je moet weten

- Alles is lokaal gecommit op `main`; **niets gepusht, geen tag**. De laatste gepubliceerde release blijft 0.0.22.
- De server-daemon draait nog de oude build (gestart 19 nov); herstart hem om deze code te laden.
- De apk arm64 staat in `local/builds`; md5 staat in de ledger-commit.
