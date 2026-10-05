# Bundle update log

## 2026-10-05
* **Feature**: Sessions can be named. `/new` and `Ctrl+N` open `NewSessionScreen`, which asks for a name before anything starts, and `r` in the session picker opens `RenameScreen` for the highlighted session. The name is stored as `name` in the session file, wins over the first user message in a row, and survives `save()`.
* **Feature**: The writing style is the document in the repo. `roan/skills/roan-writing-style/SKILL.md` is the upstream, `style.sync()` seeds `~/.Roan/skills/` from it and fetches a newer version from GitHub once a day, the fetched version is recorded in `~/.Roan/writing-style.json`, and a copy that was not checked is visible in the TUI. The `always` caps moved up (20 000 / 32 000) so the full document fits, with a test that fails if they ever drop below it (eis 2, issue #15).
* **Fix**: `roan/memory.md` was not linked from any index, so the bundle carried an orphan page.
* **Fix**: the 46-column session row test asserted the date it was written on (`10-02`) instead of the shape of the right-hand column, so it went red the next day; it now matches `MM-DD`.
* **Open**: `AGENTS.md` still describes eis 2 as half finished. That file is protected — a write to it needs an explicit yes — so the pointer there waits for the next session.

## 2026-09-30
* **Restructure**: The bundle is no longer a `knowledge/` folder. The repository **is** the bundle: each concept lives in the directory it describes — the harness in `roan/`, the channels in `roan/channels/`, the suite in `tests/` — with `index.md` at every level as the table of contents.
* **Create**: `index.md` at the root as the bundle table of contents, declaring `okf_version: "0.2"`.
* **Create**: `ideas.md`, the backlog: what we might build, why, and what it would cost. Statuses live on the GitHub Project board, not here, so the two cannot drift.
* **Create**: `tests/project_board.py`, which creates that board with the columns To Do / Doing / Done and fills it from the backlog. Idempotent, and it reports the missing token scope instead of failing obscurely.
* **Update**: `README.md` gained frontmatter so it is a concept like every other file in the tree.
* **Update**: The validator and the file-map generator moved to `tests/` and now treat the git-tracked tree as the bundle, so `.venv` and `.git` stay out of it.
* **Rename**: `knowledge/` came from `okf/` earlier the same day; both were wrong for the same reason. The format does not name the bundle directory after itself — the spec names no directory at all, and every example names one after the subject it documents.
* **Creation**: Established the bundle with the overview, concepts, recipes, decisions and reference sections.
* **Creation**: Documented the design system, the Catppuccin theming rules, the free-versus-paid classification and the pitfalls list.
