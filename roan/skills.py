"""Skills: herbruikbare instructie-bestanden in ~/.Roan/skills/*.md.

Een skill is markdown met optionele frontmatter:

    ---
    name: deploy
    description: Hoe je een release uitbrengt
    ---
    Stap 1 ...

De agent ziet alleen naam + beschrijving in de system-prompt en haalt de volledige
tekst op met de `read_skill`-tool.
"""

from __future__ import annotations

import re
from pathlib import Path

from . import config


def skills_dir() -> Path:
    """De skills-map (lazy, zodat tests hem kunnen isoleren)."""
    return config.SKILLS_DIR


def parse_skill(text: str) -> tuple[str, str, str]:
    """(name, description, body) uit de inhoud van een skill-bestand."""
    name = ""
    description = ""
    body = text
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", text, re.S)
    if match:
        front, body = match.group(1), match.group(2)
        for line in front.splitlines():
            if ":" in line:
                key, value = line.split(":", 1)
                key = key.strip().lower()
                value = value.strip().strip("\"'")
                if key == "name":
                    name = value
                elif key == "description":
                    description = value
    if not name:
        heading = re.search(r"^#\s+(.+)$", body, re.M)
        name = heading.group(1).strip() if heading else ""
    if not description:
        for line in body.splitlines():
            line = line.strip()
            if line and not line.startswith("#"):
                description = line[:160]
                break
    return name, description, body.strip()


def load_skills(directory: Path | None = None) -> list[dict]:
    """Alle skills als dicts met name/description/body/path."""
    target = directory or skills_dir()
    if not target.exists():
        return []
    out: list[dict] = []
    for path in sorted(target.glob("*.md")):
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        name, description, body = parse_skill(text)
        out.append(
            {"name": name or path.stem, "description": description, "body": body, "path": str(path)}
        )
    return out


def get_skill(name: str, directory: Path | None = None) -> dict | None:
    for skill in load_skills(directory):
        if skill["name"].lower() == (name or "").lower():
            return skill
    return None


def skills_prompt(directory: Path | None = None) -> str:
    """Korte skills-lijst voor in de system-prompt (leeg als er geen zijn)."""
    skills = load_skills(directory)
    if not skills:
        return ""
    lines = ["", "[Beschikbare skills — gebruik read_skill(name) voor de volledige inhoud]"]
    for skill in skills:
        lines.append(f"- {skill['name']}: {skill['description']}")
    return "\n".join(lines)


def skills_list_text(directory: Path | None = None) -> str:
    """Markdown-overzicht voor het /skills-commando."""
    skills = load_skills(directory)
    if not skills:
        return f"Nog geen skills. Zet .md-bestanden in `{skills_dir()}`."
    lines = [f"**Skills ({len(skills)})**", ""]
    for skill in skills:
        lines.append(f"- **{skill['name']}** — {skill['description']}")
    return "\n".join(lines)
