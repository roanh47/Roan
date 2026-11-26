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
| 15 | Device control | blocked | module + 16 tests ready; protocol wiring (device_req frame, transport handlers, device_grant/device_result event types) deferred | 1 |
| 16 | Zijvragen en queueing | done | queue + side-session ids + QueueBar component; daemon queueing not wired (open) | 1 |
| 17 | Delen en exporteren | done | self-contained escaped HTML export + markdown header; export frame still writes markdown only (open) | 1 |
| 18 | Archief en tijdelijke chats | done | append-only tombstones, `.all` lookups, archive/delete frames, SessionRow component | 1 |
| 19 | Veiligheid | in-progress | — | 1 |
| 20 | Kennis | in-progress | — | 1 |
| 21 | Commando's en hooks | in-progress | — | 1 |
| 22 | Server en SDK | in-progress | — | 1 |
| 23 | Leren en rollen | in-progress | — | 1 |
| 24 | Browser | pending | — | 0 |
| 25 | Computer use | pending | — | 0 |
| 26 | Generatie | pending | — | 0 |
| 27 | Spraakgesprek | pending | — | 0 |
| 28 | Werkplek | pending | — | 0 |
| 29 | Code en git | pending | — | 0 |
| 30 | Surfaces | pending | — | 0 |
| 31 | Koppelingen | pending | — | 0 |
| 32 | Opruimen en docs | pending | — | 0 |
| 33 | Bewijsronde | pending | — | 0 |
| 34 | Eindrapport | pending | — | 0 |

## Wave log

- Wave 1 (1-4): DONE. Verified by the orchestrator: tsc, build, 621/621, 59/59, 46/46, proof PASS, AppImage launch.
  Integration fix by the orchestrator: web/src/chain.ts + App.tsx now use `nodes[].live` from the daemon.
  Shared contract frozen (orchestrator): event types `goal`, `goal_update`, `memory`, `plan_mode`, `cron_job` added to store.ts, protocol/types.ts and validate.ts — children may not edit those lists.
- Wave 2 (5-10): 5, 6, 7 DONE and wired by the orchestrator (plan frame, memory at turn end, goals in the system prompt, GoalsPanel). Verified: 724/724, 63/63, 67/67.
- Wave 2b: fix child for 8+9+10 wiring (providers, turn_end usage, cron schedule in the existing loop) starts next to wave 3.
