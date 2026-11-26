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
| 8 | Effort levels | in-progress | module + 11 tests ready; provider plumbing (providerId, ChatOptions.extra) not wired | 2 |
| 9 | Kosten en tokens | in-progress | usage.ts + 16 tests ready; ChatResponse.usage not surfaced in turn_end yet | 2 |
| 10 | Achtergrondtaken | in-progress | schedule.ts + scheduler + panel ready; old cron loop still runs only `every` | 2 |
| 11 | Spraak invoer | pending | — | 0 |
| 12 | Import | pending | — | 0 |
| 13 | Steer mid-turn | pending | — | 0 |
| 14 | Deep research | pending | — | 0 |
| 15 | Device control | pending | — | 0 |
| 16 | Zijvragen en queueing | pending | — | 0 |
| 17 | Delen en exporteren | pending | — | 0 |
| 18 | Archief en tijdelijke chats | pending | — | 0 |
| 19 | Veiligheid | pending | — | 0 |
| 20 | Kennis | pending | — | 0 |
| 21 | Commando's en hooks | pending | — | 0 |
| 22 | Server en SDK | pending | — | 0 |
| 23 | Leren en rollen | pending | — | 0 |
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
