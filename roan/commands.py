"""Slash-command registry voor de Roan TUI."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Command:
    name: str
    description: str
    usage: str = ""


COMMANDS: dict[str, Command] = {
    "help": Command("help", "Toon alle commando's"),
    "clear": Command("clear", "Leeg het gesprek"),
    "theme": Command("theme", "Wissel thema", "/theme <mocha|macchiato|frappe|latte>"),
    "model": Command("model", "Zet of toon het actieve model", "/model <naam>"),
    "models": Command("models", "Lijst modellen van de provider (live)"),
    "free": Command("free", "Lijst 100% gratis modellen (models.dev)"),
    "provider": Command("provider", "Zet of toon de provider", "/provider <naam>"),
    "setup": Command("setup", "Toon de huidige configuratie"),
    "memory": Command("memory", "Toon wat Roan onthouden heeft"),
    "quit": Command("quit", "Afsluiten"),
}


def get(name: str) -> Command | None:
    return COMMANDS.get(name.lstrip("/"))


def names() -> list[str]:
    return sorted(COMMANDS)


def help_text() -> str:
    lines = ["**Commando's**", ""]
    for name in names():
        cmd = COMMANDS[name]
        usage = f" `{cmd.usage}`" if cmd.usage else ""
        lines.append(f"- **/{name}**{usage} — {cmd.description}")
    return "\n".join(lines)
