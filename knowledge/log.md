# Bundle update log

## 2026-09-30
* **Rename**: Moved the bundle from `okf/` to `knowledge/`. The format does not name the directory after itself: every example in the OKF spec names a bundle after the subject it documents, and the spec's own guide recommends a `knowledge/` or `docs/catalog/` directory inside a repository.
* **Update**: The validator, the file-map generator and the README now point at `knowledge/`; the generator no longer hardcodes the directory name.
* **Creation**: Established the bundle with the overview, concepts, guides, decisions and references sections.
* **Creation**: Documented the design system, the Catppuccin theming rules, the free-versus-paid classification and the pitfalls list.
