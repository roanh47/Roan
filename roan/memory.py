"""Geheugen: duurzame notities in ~/.Roan/memory.md."""

from __future__ import annotations

from . import config


def load_memory() -> str:
    """Inhoud van memory.md zonder commentaar-regels (leeg bestand -> '')."""
    from .home import read_profile

    return read_profile(config.MEMORY_PATH)


def remember(note: str) -> str:
    path = config.MEMORY_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(note.rstrip() + "\n")
    return "Onthouden."


def entries() -> list[str]:
    """Elke notitie van memory.md als losse regel, zoals het scherm ze toont.

    Een notitie is één regel: `read_profile` gooit lege regels en commentaar weg,
    dus wat overblijft is de lijst. De volgorde is die van het bestand, en die
    is ook de volgorde van het geheugen in de system-prompt.
    """
    return [line.strip() for line in load_memory().splitlines() if line.strip()]


def forget(note: str) -> bool:
    """Haal één notitie uit memory.md weg. True als er echt iets verdween.

    Het bestand wordt meteen opnieuw geschreven, want een verwijdering die alleen
    in dit proces bestaat is na een herstart weer terug. Alleen de eerste
    match gaat weg: twee keer dezelfde regel zijn twee notities, en wie er twee
    heeft wil ze allebei kunnen weghalen.

    `False` betekent: niets gevonden, of de notitie was leeg. Commentaarregels
    staan niet in `entries()` en kunnen dus niet worden verwijderd; de regel
    `read_profile` overslaat blijft gewoon staan.
    """
    target = note.strip()
    if not target:
        return False
    path = config.MEMORY_PATH
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return False
    kept: list[str] = []
    dropped = False
    for line in lines:
        if not dropped and line.strip() == target:
            dropped = True
            continue
        kept.append(line)
    if not dropped:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    # Overgebleven lege regels aan het begin wegdoen: de notitie die weg ging
    # kan de eerste regel geweest zijn.
    body = "".join(f"{line}\n" for line in kept).lstrip("\n")
    path.write_text(body, encoding="utf-8")
    return True


def load_profile() -> str:
    """Profiel van de gebruiker (~/.Roan/user.md)."""
    from .home import read_profile

    return read_profile(config.USER_PATH)
