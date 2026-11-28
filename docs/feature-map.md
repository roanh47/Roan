# Feature map — waar woont wat in de code

Elke feature, elk basis-gat en elke ronde uit `TODO.md` en
`docs/feature-groups.md` met de plek waar hij leeft of zal landen.
Lanen: **[B]**asis = de lat (geen feature, wel verplicht) · **[F]**eature =
nieuwe capaciteit · ✔ = werkt vandaag op een echte machine.

```
Roan/
├── TODO.md                     rondes 1 · 1c · 2a · 2b + de basis-hygiëne-baan
├── PLAN.md                     startvolgorde + proofnormen
├── docs/
│   ├── feature-groups.md       114 concepten, 23 oppervlakken, twee lanen
│   ├── feature-parity.md      status per feature
│   ├── research/features/      1.024 gesourde rijen uit 23 harnesses
│   ├── protocol.md + chain.md  frames, keten, append-only, req-correlatie
│   ├── invite-flow.md         join v1/v2, hosts-lijst, handshake
│   └── webui.md               het doorgeefluik (webui.mjs)
│
├── src/                        DE AGENT
│   ├── agent.ts                beurtloop ✔, small-talk-guard ✔, stappenbudget-melding ✔
│   ├── config.ts               config-lagen (defaults/env/file) ✔
│   ├── context/
│   │   ├── prompt.ts           prompt-bouw ✔ — [B] schrijfstijl als regel → ronde 2a
│   │   ├── memory.ts           geheugen-distillatie — [F] auto-memory → SOON
│   │   └── skills.ts           skill-lezer — [F] skills meereizen → ronde 2a
│   ├── cron/jobs.ts            geplande taken ✔ — [F] naar foreground → 2b
│   └── providers/
│       ├── live.ts             304 presets live van models.dev ✔ [B]
│       └── openai-compat.ts    streaming + tool_calls ✔ [B]
│
├── src/chain/                  DE KETEN
│   ├── store.ts + schema.ts    append-only keten + WAL ✔
│   ├── sessions.ts             sessies + titels ✔ — [B] hernoemen → 1c · [B] zoeken → 2a
│   ├── search.ts               keten-doorzoek-bibliotheek ✔ (nog geen Ctrl-K)
│   ├── export.ts               export-bibliotheek ✔ — [B] de knop → 2b
│   ├── summary.ts              keten-samenvatting — [F] compaction → ronde 2a
│   ├── verify.ts + lockfile.ts+gc.ts   bewijs + slot + opruimen ✔
│   └── nodes.ts                node-registry ✔ [B] remote pairing
│
├── src/daemon/                 HET HUIS
│   ├── main.ts                 facade: control, invites v2 ✔, announce, join, migrate
│   ├── control.ts + control-protocol.ts   frames, req-correlatie ✔, join-code v1/v2 ✔
│   ├── peers.ts                peer-link + token/chain-handshake ✔ — [B] tailscale-bind → 1c
│   ├── advertise.ts            elke route in de invite, tailnet eerst ✔ (18 nov)
│   ├── discovery.ts            tailscale-scan: elkaar vinden zonder code ✔
│   ├── turn-runner.ts          turn_start/end, stap-registratie ✔ [B]
│   ├── paths.ts                ~/.Roan + migrate ✔ — [B] state/-scheiding → ronde 2a
│   ├── history.ts + settings.ts + singleton.ts + autostart.ts
│   └── (2b) shutdown-pad — de SIGABRT woont hier nog in
│
├── web/src/                    HET VLAK
│   ├── App.tsx                 header, dock ✔, stuck-rapport ✔, onboarding, join-veld
│   ├── components/Transcript.tsx   bubbels, internal-steps ✔, Copy ✔, Regenerate ✔
│   │                           — [B] eigen bericht bewerken → 1-nazorg
│   ├── components/Markdown.tsx + markdown.ts   markdown ✔
│   ├── components/ModelSheet.tsx + panels/ProvidersPanel.tsx   key/model-flow ✔
│   ├── chain.ts                turnPhase ✔, turnQuietMs ✔, req ✔
│   ├── styles.css              thema ✔ — [B] statusbalk alleen-Android → 1c
│   │                           — [B] icoongrootte overal gelijk → 1c
│   └── (SOON) afbeeldingen, zoekbalk Ctrl-K, export-knop
│
├── src-tauri/                  DE SCHILLEN
│   ├── src/lib.rs              desktop + sidecar ✔
│   └── android/
│       ├── RoanNode.kt         JNI + legacy-rename ✔ — [F] foreground → 2b
│       ├── start-node.cpp      de node-thread ✔ — [F] nette shutdown → 2b
│       └── MainActivity        statusbar-stijl — [B] app-klasse → 1c
│
├── scripts/                    HET GEREEDSCHAP
│   ├── android-daemon.sh       dual-ABI bundel ✔ (arm64+x86_64)
│   ├── webui.mjs               pagina + /ws-doorgeefluik ✔
│   ├── bundle-daemon.mjs       2,9 MB daemon ✔
│   └── build-local.sh + smoke.sh + check-artifacts.sh
│
└── tests/                      aparte suite (57) naast npm test (510)
    ├── paths-migration.test.ts ✔ · release-assets.test.ts ✔
    ├── invite.test.ts + turn.test.ts
    └── (per ronde nieuwe tests bij het gedrag, niet bij de bron)

Buiten de repo: ~/.config/systemd/user/roan-daemon.service (bind 100.64.0.1,
ROAN_HOME=~/.roan) + roan-webui.service (ROAN_CONTROL_URL) — de productieserver.
```

Nog niet gemaakte dingen (web search, MCP starten, browser, generatie) hebben
nog geen file: die komen als `src/tools/` + een plek in de beurtloop, per
SOON-item als het zover is.
