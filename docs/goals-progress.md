# 0.0.23 — orchestrator-ledger

Status per feature. Updated after every wave; a stopped run resumes here.
Owner of this file: the orchestrator (not the children).

| # | Feature | Status | Evidence | Attempts |
|---|---|---|---|---|
| 1 | Sync-terugstroom + presence | done | proof-three-branches PASS (backflow + 3 nodes, mirror order); presence self-live tests | 1 |
| 2 | Seq-hergroepering | done | src/sync/order.ts (ts,node,id) + 3/4-writer tests | 1 |
| 3 | Updater met feed | done | update-feed/bundle-download/update-flow + 45 new tests; UI "unreachable" distinct | 1 |
| 4 | Installers en signing | done | AppImage launched (window + daemon, 141.79 MiB, 1m31s); keystore script; docs/release.md | 1 |
| 5 | Plan mode | done | plan.ts/plan-tools + turn gating tests + frame + composer toggle, wired by orchestrator | 1 |
| 6 | Auto-memory | done | distil + MEMORY.md fold + turn-end wiring (fails silently) | 1 |
| 7 | Goals en standing orders | done | fold + context in system prompt + goal frames + GoalsPanel mounted | 1 |
| 8 | Effort levels | done | providerId + ChatOptions.effort, per-family body mapping incl. google merge, `effort` frame writes settings | 2 |
| 9 | Kosten en tokens | done | usage in turn_end (summed per turn) + line under the answer; session total needs App.tsx (open) | 2 |
| 10 | Achtergrondtaken | done | `schedule` (daily HH:MM / every 30m) in the existing cron loop, bad schedules logged once; BackgroundPanel not mounted | 2 |
| 11 | Spraak invoer | done | SttProvider + registry + local openai-compat plugin, 30+ tests; mic button honest-disabled (capture unwired) | 1 |
| 12 | Import | done | discover/parse/plan/apply + `imported/` env root + import_discover/plan frames; ImportPanel unwired | 1 |
| 11 | Spraak invoer | pending | — | 0 |
| 12 | Import | pending | — | 0 |
| 13 | Steer mid-turn | done | inbox + alternation guard + turn-runner hook; frame, client.steer and composer Steer button wired | 1 |
| 14 | Deep research | done | bounded plan→search→extract→report with citation guard, 39 tests; tool not registered yet (open) | 1 |
| 15 | Device control | done | module + 16 tests, `device_req` frame + validation + codec, `device_grant`/`device_result` in all five registries, grant-gated receiver in both transports (35 tests), daemon passes `device: {store}` on both links | 2 |
| 16 | Zijvragen en queueing | done | queue + side-session ids + QueueBar component; daemon queueing not wired (open) | 1 |
| 17 | Delen en exporteren | done | self-contained escaped HTML export + markdown header; export frame still writes markdown only (open) | 1 |
| 18 | Archief en tijdelijke chats | done | append-only tombstones, `.all` lookups, archive/delete frames, SessionRow component | 1 |
| 19 | Veiligheid | done | sandbox detect/wrap (bwrap/landlock/sandbox-exec), one-time elevation, untrusted blocks; 41 tests; exec.ts hook open | 1 |
| 20 | Kennis | done | memory/session search with sources (1053-suite) + projects store; tool/prompt wiring open | 1 |
| 21 | Commando's en hooks | done | command parse/fold/expand + isolated hooks + SlashMenu; `command` event type added; turn wiring open | 1 |
| 22 | Server en SDK | done | docs/api.md from code, typed ws client (12 tests), deferred tools; sdk has its own tsconfig | 1 |
| 23 | Leren en rollen | done | proposals inert until approval, env-carried; roleModel() planner/executor/side; 30 tests | 1 |
| 24 | Browser | done | CDP client + page actions + fake-CDP tests (39); registered as a core tool (needs BROWSER_CDP_URL) | 1 |
| 25 | Computer use | done | grant store + gated actions + Linux driver plans, 67 tests; approval UI + daemon grant frames open | 1 |
| 26 | Generatie | done | provider plugins (OpenAI images, ComfyUI) + registry/runtime, 27 tests; tool + config source wiring open | 1 |
| 27 | Spraakgesprek | done | TTS provider + listen→think→speak loop, 36 tests; needs mic capture + speaker from the shell (open) | 1 |
| 28 | Werkplek | done | safe file library + CSV/TSV/JSON + chart spec, 34 tests; workspace_list/read wiring open | 1 |
| 29 | Code en git | done | LSP probe/client interface, porcelain+numstat parsers, GitPanel, 40 tests; panel routing + commit path open | 1 |
| 30 | Surfaces | done | `roan` CLI over the control socket (36 tests, own tsconfig) + deep links (42 tests) | 1 |
| 31 | Koppelingen | done | signed webhooks in/out with replay guard, read-only GitHub connector, honest A2A note; HTTP route + tool wiring open | 1 |
| 32 | Opruimen en docs | in-progress | — | 1 |
| 33 | Bewijsronde | partial | apk arm64 71ccce96…; x86_64 op de emulator met draaiende RoanService; **telefoon-sync beide richtingen bewezen** (node-e16fb890: 20 events in /home/roan/.roan/state/chain.db, en seq 94 — een hernoeming van de server — kwam live op de telefoon aan); 2 screenshots op schijf; de 7 feature-shots en de blob-via-adb-check nog open | 1 |
| 34 | Eindrapport | done | docs/FINAL-0.0.23.md; niets gepusht | 1 |

## Wave log

- Wave 1 (1-4): DONE. Verified by the orchestrator: tsc, build, 621/621, 59/59, 46/46, proof PASS, AppImage launch.
  Integration fix by the orchestrator: web/src/chain.ts + App.tsx now use `nodes[].live` from the daemon.
  Shared contract frozen (orchestrator): event types `goal`, `goal_update`, `memory`, `plan_mode`, `cron_job` added to store.ts, protocol/types.ts and validate.ts — children may not edit those lists.
- Wave 2 (5-10): 5, 6, 7 DONE and wired by the orchestrator (plan frame, memory at turn end, goals in the system prompt, GoalsPanel). Verified: 724/724, 63/63, 67/67.
- Wave 2b–7: done (8/9/10 wired, 11–14, 16–31 modules + tests, 24 registered as a core tool).
- Wave 8 (docs, feature 32): done — the sweep found a real leak (apiKey inside config.json rode the env snapshot into every chain.db); packaging now redacts it, with src/env/pack.test.ts pinning it.
- Final gate: 1382 root / 115 tests/ / 126 web, root+web+cli+sdk typechecks clean. Committed as eb81f56.
