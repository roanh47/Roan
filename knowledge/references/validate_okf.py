"""Controleer de OKF-bundle in deze map tegen de spec (v0.2).

Drie harde eisen uit §11:

    1. Elk niet-gereserveerd .md-bestand heeft parseerbare YAML-frontmatter.
    2. Elk frontmatter-blok heeft een niet-lege `type`.
    3. index.md en log.md volgen hun eigen vorm (§8, §9).

Daarnaast (zachte controle, alleen rapportage): of relatieve links binnen de
bundle naar een bestaand bestand wijzen.

Gebruik:

    python3 knowledge/references/validate_okf.py [bundelmap]

Zonder argument wordt de map gebruikt waarin dit script staat, één niveau omhoog.
Exitcode 0 = conform, 1 = er is iets mis.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

RESERVED = {"index.md", "log.md"}
DATE_HEADING = re.compile(r"^##\s+(\d{4}-\d{2}-\d{2})\s*$")
LINK = re.compile(r"\]\(([^)#\s]+)(?:#[^)\s]*)?\)")
SECTION_HEADING = re.compile(r"^#\s+\S")
LIST_ENTRY = re.compile(r"^\*\s+\[")


def split_frontmatter(text: str) -> tuple[str | None, str]:
    """(frontmatter, body). frontmatter is None als er geen blok is."""
    if not text.startswith("---"):
        return None, text
    lines = text.splitlines()
    if lines[0].strip() != "---":
        return None, text
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            return "\n".join(lines[1:i]), "\n".join(lines[i + 1 :])
    return None, text


def parse_yaml(raw: str) -> dict:
    """Klein genoeg om zonder PyYAML te kunnen; gebruikt PyYAML als het er is."""
    try:
        import yaml  # type: ignore
    except ImportError:
        result: dict = {}
        for line in raw.splitlines():
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            if ":" in line and not line.startswith((" ", "\t", "-")):
                key, _, value = line.partition(":")
                result[key.strip()] = value.strip()
        return result
    loaded = yaml.safe_load(raw)
    return loaded if isinstance(loaded, dict) else {}


def check(bundle: Path) -> list[str]:
    problems: list[str] = []
    files = sorted(bundle.rglob("*.md"))
    if not files:
        return [f"geen .md-bestanden gevonden in {bundle}"]

    for path in files:
        rel = path.relative_to(bundle)
        text = path.read_text(encoding="utf-8")
        front, body = split_frontmatter(text)

        if path.name in RESERVED:
            # Alleen een bundle-root index.md mag frontmatter hebben (§12).
            if front is not None:
                if path.name != "index.md" or path.parent != bundle:
                    problems.append(f"{rel}: gereserveerd bestand mag geen frontmatter hebben")
                else:
                    meta = parse_yaml(front)
                    extra = set(meta) - {"okf_version"}
                    if extra:
                        problems.append(
                            f"{rel}: root-index mag alleen okf_version hebben, ook: {sorted(extra)}"
                        )
            if path.name == "index.md":
                if not any(SECTION_HEADING.match(ln) for ln in body.splitlines()):
                    problems.append(f"{rel}: index.md heeft geen sectiekop (# ...)")
                if not any(LIST_ENTRY.match(ln) for ln in body.splitlines()):
                    problems.append(f"{rel}: index.md heeft geen lijst met entries")
            else:
                for ln in body.splitlines():
                    if ln.startswith("##") and not DATE_HEADING.match(ln):
                        problems.append(f"{rel}: log-kop moet '## YYYY-MM-DD' zijn, niet {ln!r}")
                        break
            continue

        if front is None:
            problems.append(f"{rel}: geen YAML-frontmatter")
            continue
        try:
            meta = parse_yaml(front)
        except Exception as exc:  # noqa: BLE001
            problems.append(f"{rel}: frontmatter niet te parsen ({exc})")
            continue
        if not str(meta.get("type") or "").strip():
            problems.append(f"{rel}: 'type' ontbreekt of is leeg")

    # zachte controle: relatieve links
    for path in files:
        rel = path.relative_to(bundle)
        for target in LINK.findall(path.read_text(encoding="utf-8")):
            if target.startswith(("http://", "https://", "mailto:")):
                continue
            if target.endswith("/"):
                resolved = (path.parent / target).resolve()
            else:
                resolved = (path.parent / target).resolve()
            if not resolved.exists():
                problems.append(f"{rel}: link naar ontbrekend doel: {target}")
    return problems


def main() -> int:
    here = Path(__file__).resolve().parent
    bundle = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else here.parent
    problems = check(bundle)
    count = len(list(bundle.rglob("*.md")))
    if problems:
        print(f"NIET CONFORM - {len(problems)} probleem(en) in {count} bestanden:")
        for p in problems:
            print("  -", p)
        return 1
    print(f"OK - {count} markdown-bestanden, alle drie de regels gehaald.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
