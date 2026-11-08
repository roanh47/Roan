"""Genereer knowledge/references/file-map.md opnieuw uit de echte repo.

Los script zodat de bestandslijst en de regelnummers altijd kloppen met de code.
"""

import pathlib

TS = "2026-09-30T08:12:52Z"
GEN = "{ by: hermes-agent/deepseek-v4.1-flash, at: " + TS + " }"

here = pathlib.Path(__file__).resolve().parent          # tests/
root_dir = here.parent                                   # de repo = de bundel

pkg = [(str(p.relative_to(root_dir)), sum(1 for _ in p.open()))
       for p in sorted((root_dir / "roan").rglob("*.py"))]
root = [(n, sum(1 for _ in (root_dir / n).open()))
        for n in ("pyproject.toml", "README.md", "AGENTS.md")
        if (root_dir / n).exists()]
tst = [(str(p.relative_to(root_dir)), sum(1 for _ in p.open()))
       for p in sorted((root_dir / "tests").glob("*.py"))]
total = sum(c for _, c in pkg)

FRONT = (
    "---\n"
    "type: Reference\n"
    "title: File map\n"
    "description: Every file in the repository with its line count, so an agent knows where to look first.\n"
    "tags: [roan, reference, files]\n"
    "status: stable\n"
    "generated: " + GEN + "\n"
    "verified: { by: process:generate_file_map, at: " + TS + " }\n"
    "sources:\n"
    "  - id: repo\n"
    "    resource: ../../\n"
    "    title: repository root\n"
    "---\n\n"
)

LOOKUP = """
# Where to look for what

| Question | File |
|---|---|
| How does the app render / which key does what | `roan/tui.py` |
| Which strings exist, in which language | `roan/i18n.py` |
| Which colours, which theme | `roan/themes.py` |
| Which providers, which is free, models.dev | `roan/models.py` |
| Where is any path or config key | `roan/config.py` |
| What the model can call | `roan/agent.py` + `roan/tools.py` |
| The ~/.Roan layout | `roan/home.py` |
| Skills, memory, cron | `roan/skills.py`, `roan/memory.py`, `roan/cron.py` |
| Telegram | `roan/channels/telegram.py` |
| MCP | `roan/mcp.py` |
| Entry points and subcommands | `roan/cli.py` |

"""


def table(rows):
    return "\n".join("| `" + n + "` | " + str(c) + " |" for n, c in rows)


closing = (
    "The package is " + str(total) + " lines of Python in total. `roan/tui.py` is\n"
    "the biggest file by far and holds every screen; that is deliberate - see\n"
    "[one shared popup style](roan/shared-popup-style.md) - but it is the file to\n"
    "split first if it gets unwieldy.\n\n"
    "Regenerate this page with `python3 tests/generate_file_map.py` after a\n"
    "structural change, so the counts do not drift.\n"
)

body = (
    "# Package: roan/\n\n| File | Lines |\n|---|---|\n"
    + table(pkg)
    + "\n\n# Root and tests\n\n| File | Lines |\n|---|---|\n"
    + table(root + tst)
    + "\n"
    + LOOKUP
    + closing
)

target = root_dir / "file-map.md"
target.write_text(FRONT + body, encoding="utf-8")
print("file-map.md opnieuw gegenereerd:", len(pkg), "package-bestanden,", total, "regels")
