# References

Lookup material: the map of the codebase, the two command surfaces, every config
key and environment variable, the exact colours, and the mistakes already made.

* [File map](file-map.md) - every file in the repository with its line count.
* [CLI and slash commands](cli-and-commands.md) - both command surfaces.
* [Config keys](config-keys.md) - every key in config.json.
* [Environment variables](env-vars.md) - every env override and the precedence order.
* [Palette](palette.md) - the exact Catppuccin values per flavour.
* [Pitfalls](pitfalls.md) - bugs that already happened once, with cause and fix.

Two scripts live here rather than in the bundle body, because they are tooling
rather than knowledge:

* `validate_okf.py` - checks the three conformance rules of OKF v0.2 and reports
  broken cross-links. Run it after editing anything in `okf/`.
* `generate_file_map.py` - regenerates [the file map](file-map.md) from the real
  repository, so the line counts cannot drift.

Neither is a concept file; conformance only applies to `.md` files.
