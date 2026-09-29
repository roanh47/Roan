"""Slash-command registry voor de Roan TUI.

De beschrijvingen zijn i18n-keys; help_text() vertaalt ze in de actieve taal.
"""

from __future__ import annotations

from dataclasses import dataclass

from .i18n import t


@dataclass
class Command:
    name: str
    description: str  # i18n-key
    usage: str = ""


COMMANDS: dict[str, Command] = {
    "help": Command("help", "cmd_help"),
    "clear": Command("clear", "cmd_clear"),
    "theme": Command("theme", "cmd_theme", "/theme <mocha|macchiato|frappe|latte>"),
    "model": Command("model", "cmd_model", "/model <naam>"),
    "models": Command("models", "cmd_models"),
    "free": Command("free", "cmd_free"),
    "provider": Command("provider", "cmd_provider", "/provider <naam>"),
    "setup": Command("setup", "cmd_setup"),
    "memory": Command("memory", "cmd_memory"),
    "new": Command("new", "cmd_new"),
    "sessions": Command("sessions", "cmd_sessions"),
    "compact": Command("compact", "cmd_compact"),
    "language": Command("language", "cmd_language", "/language <nl|en>"),
    "tui": Command("tui", "cmd_tui", "/tui <fullscreen|default>"),
    "quit": Command("quit", "cmd_quit"),
}


def get(name: str) -> Command | None:
    return COMMANDS.get(name.lstrip("/"))


def names() -> list[str]:
    return sorted(COMMANDS)


def help_text() -> str:
    lines = [f"**{t('help_title')}**", ""]
    for name in names():
        cmd = COMMANDS[name]
        usage = f" `{cmd.usage}`" if cmd.usage else ""
        lines.append(f"- **/{name}**{usage} — {t(cmd.description)}")
    lines += ["", f"_{t('help_languages')}_"]
    return "\n".join(lines)
