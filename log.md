# Bundle update log

## 2026-09-30
* **Restructure**: The bundle is no longer a `knowledge/` folder. The repository **is** the bundle: each concept lives in the directory it describes — the harness in `roan/`, the channels in `roan/channels/`, the suite in `tests/` — with `index.md` at every level as the table of contents.
* **Create**: `index.md` at the root as the bundle table of contents, declaring `okf_version: "0.2"`.
* **Create**: `ideas.md`, the backlog: what we might build, why, and what it would cost. Statuses live on the GitHub Project board, not here, so the two cannot drift.
* **Update**: `README.md` gained frontmatter so it is a concept like every other file in the tree.
* **Update**: The validator and the file-map generator moved to `tests/` and now treat the git-tracked tree as the bundle, so `.venv` and `.git` stay out of it.
* **Rename**: `knowledge/` came from `okf/` earlier the same day; both were wrong for the same reason. The format does not name the bundle directory after itself — the spec names no directory at all, and every example names one after the subject it documents.
* **Creation**: Established the bundle with the overview, concepts, recipes, decisions and reference sections.
* **Creation**: Documented the design system, the Catppuccin theming rules, the free-versus-paid classification and the pitfalls list.
