"""De ~/.Roan map: vergelijkbare inhoud als Hermes' ~/.hermes.

    ~/.Roan/
      config.json      instellingen
      instructions.md  system-prompt (overschrijft de default)
      memory.md        duurzame notities (tool `remember`)
      user.md          profiel van de gebruiker (gaat in de system-prompt)
      skills/          *.md skills (naam + beschrijving in de prompt)
      cron/            jobs.json — geplande prompts
      plugins/         eigen python-plugins
      sessions/        één json per gesprek
      logs/            roan.log
      cache/           tijdelijke bestanden
      plans/           plannen (markdown)
      knowledge/       opgehaalde bronnen, één .md per bron
"""

from __future__ import annotations

from pathlib import Path

from . import config

def _dirs() -> dict[str, Path]:
    return {
        "sessions": config.ROAN_DIR / "sessions",
        "skills": config.SKILLS_DIR,
        "plugins": config.PLUGINS_DIR,
        "cron": config.CRON_DIR,
        "logs": config.LOGS_DIR,
        "cache": config.CACHE_DIR,
        "plans": config.PLANS_DIR,
        "knowledge": config.KNOWLEDGE_DIR,
    }


def _files() -> dict[Path, str]:
    return {
        config.MEMORY_PATH: (
            "# Memory\n"
            "#\n"
            "# Duurzame notities die Roan onthoudt (via de remember-tool).\n"
            "# Regels die met # beginnen worden genegeerd.\n"
        ),
        config.USER_PATH: (
            "# User\n"
            "#\n"
            "# Wie de gebruiker is. Dit gaat mee in de system-prompt.\n"
            "# Voorbeeld: naam, rol, voorkeuren, waar je aan werkt.\n"
        ),
    }


def ensure_home() -> list[str]:
    """Maak de ~/.Roan-structuur aan. Geeft terug wat er nieuw gemaakt is."""
    created: list[str] = []
    root = config.ROAN_DIR
    if not root.exists():
        root.mkdir(parents=True, exist_ok=True)
        created.append(str(root))
    for path in _dirs().values():
        if not path.exists():
            path.mkdir(parents=True, exist_ok=True)
            created.append(str(path))
    for path, content in _files().items():
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
            created.append(str(path))
    return created


def read_profile(path: Path | None = None) -> str:
    """Inhoud van een profiel/memory-bestand, zonder commentaar-regels.

    Bestanden die alleen een kopcommentaar bevatten gelden als leeg.
    """
    target = path or config.USER_PATH
    if not target.exists():
        return ""
    try:
        raw = target.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    lines = [ln for ln in raw.splitlines() if ln.strip() and not ln.lstrip().startswith("#")]
    return "\n".join(lines).strip()


def layout() -> dict[str, list[str]]:
    """Overzicht van de map voor `Roan home`."""
    out: dict[str, list[str]] = {}
    for name, path in _dirs().items():
        if not path.exists():
            out[name] = []
            continue
        out[name] = sorted(p.name for p in path.iterdir())[:50]
    return out
