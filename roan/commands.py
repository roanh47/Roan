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
    "commands": Command("commands", "cmd_commands"),
    "clear": Command("clear", "cmd_clear"),
    "theme": Command("theme", "cmd_theme", "/theme <naam>"),
    "model": Command("model", "cmd_model", "/model <naam>"),
    "models": Command("models", "cmd_models"),
    "provider": Command("provider", "cmd_provider", "/provider <naam>"),
    "setup": Command("setup", "cmd_setup"),
    "memory": Command("memory", "cmd_memory"),
    "skills": Command("skills", "cmd_skills"),
    "new": Command("new", "cmd_new"),
    "sessions": Command("sessions", "cmd_sessions"),
    "compact": Command("compact", "cmd_compact"),
    "language": Command("language", "cmd_language", "/language <nl|en>"),
    "mode": Command("mode", "cmd_mode", "/mode <chat|plan|build>"),
    "permissions": Command("permissions", "cmd_permissions", "/permissions <auto|user>"),
    "thinking": Command("thinking", "cmd_thinking", "/thinking <off|low|medium|high>"),
    "tui": Command("tui", "cmd_tui", "/tui <fullscreen|default>"),
    "quit": Command("quit", "cmd_quit"),
}


def get(name: str) -> Command | None:
    return COMMANDS.get(name.lstrip("/"))


def names() -> list[str]:
    return sorted(COMMANDS)


def arg_hint(name: str) -> str:
    """Het argument-deel van de usage, zonder de leidende slash.

    De usage-literalen bevatten al het commando zelf ("/theme <naam>"), dus wie
    "/theme" al heeft geschreven plakt hier alleen de argumenten achter.
    Geeft "" terug voor commando's zonder argumenten.
    """
    cmd = COMMANDS.get(name.lstrip("/"))
    if cmd is None or not cmd.usage:
        return ""
    _, _, rest = cmd.usage.partition(" ")
    return rest.strip()


def help_text() -> str:
    # De providernaam meesturen, zodat een beschrijving als "{provider}" de
    # echte naam laat zien in plaats van een vaag "deze provider".
    from .config import load_config

    provider = str(load_config().get("provider") or "")
    lines = [f"**{t('help_title')}**", ""]
    for name in names():
        cmd = COMMANDS[name]
        hint = arg_hint(name)
        usage = f" `{hint}`" if hint else ""
        lines.append(f"- **/{name}**{usage} — {t(cmd.description, provider=provider)}")
    lines += ["", f"_{t('help_languages')}_"]
    return "\n".join(lines)
