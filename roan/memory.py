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


def load_profile() -> str:
    """Profiel van de gebruiker (~/.Roan/user.md)."""
    from .home import read_profile

    return read_profile(config.USER_PATH)
