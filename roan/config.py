import json
import os
from pathlib import Path

ROAN_DIR = Path.home() / ".Roan"
CONFIG_PATH = ROAN_DIR / "config.json"
INSTRUCTIONS_PATH = ROAN_DIR / "instructions.md"
MEMORY_PATH = ROAN_DIR / "memory.md"

# Bekende OpenAI-compatibele providers. Alleen base_url + placeholder-key; je
# vult de api_key en model in via config.json.
PROVIDER_PRESETS = {
    "lmstudio": {"base_url": "http://localhost:1234/v1", "api_key": "lm-studio"},
    "ollama": {"base_url": "http://localhost:11434/v1", "api_key": "ollama"},
    "groq": {"base_url": "https://api.groq.com/openai/v1", "api_key": ""},
    "openrouter": {"base_url": "https://openrouter.ai/api/v1", "api_key": ""},
    "gemini": {"base_url": "https://generativelanguage.googleapis.com/v1beta/openai", "api_key": ""},
    "deepseek": {"base_url": "https://api.deepseek.com/v1", "api_key": ""},
    "cerebras": {"base_url": "https://api.cerebras.ai/v1", "api_key": ""},
    "together": {"base_url": "https://api.together.xyz/v1", "api_key": ""},
    "mistral": {"base_url": "https://api.mistral.ai/v1", "api_key": ""},
    "custom": {"base_url": "", "api_key": ""},
}

DEFAULT_CONFIG = {
    "provider": "lmstudio",  # zie PROVIDER_PRESETS, of "custom" + base_url
    "base_url": None,         # alleen bij provider == "custom"
    "api_key": None,          # overschrijft de preset-key indien ingesteld
    "model": "local-model",
    "language": "nl",         # "nl" of "en"
    "tui": None,              # "fullscreen" | "default" | None (nog niet gekozen)
    "tui_prompts": 0,         # hoe vaak de fullscreen-dialoog is getoond
    "tui_declined": False,    # "niet nu" gekozen -> nooit meer vragen
    "tui_fails": 0,           # mislukte fullscreen-starts
    "scroll_speed": 1,        # muiswiel-vermenigvuldiger
    "auto_follow": True,      # automatisch naar beneden scrollen
}

RENDERERS = ("fullscreen", "default")

# De standaard-instructies staan per taal in roan/i18n.py (DEFAULT_INSTRUCTIONS).


def load_config() -> dict:
    cfg = DEFAULT_CONFIG.copy()
    if CONFIG_PATH.exists():
        try:
            cfg.update(json.loads(CONFIG_PATH.read_text()))
        except (json.JSONDecodeError, OSError):
            pass

    # Env-vars overschrijven het bestand (handig op servers/CI).
    for key, env in (
        ("provider", "ROAN_PROVIDER"),
        ("base_url", "ROAN_BASE_URL"),
        ("api_key", "ROAN_API_KEY"),
        ("model", "ROAN_MODEL"),
        ("language", "ROAN_LANGUAGE"),
        ("tui", "ROAN_TUI"),
        ("telegram_token", "ROAN_TELEGRAM_TOKEN"),
    ):
        if os.environ.get(env):
            cfg[key] = os.environ[env]

    provider = cfg["provider"]
    if provider in PROVIDER_PRESETS:
        preset = PROVIDER_PRESETS[provider]
        if not cfg.get("base_url") or provider != "custom":
            if provider != "custom":
                cfg["base_url"] = preset["base_url"]
        if cfg["api_key"] is None:
            cfg["api_key"] = preset["api_key"]

    return cfg


def migrate_legacy_dir() -> bool:
    """Verhuis een oude ~/.roan map naar ~/.Roan (eenmalig)."""
    legacy = Path.home() / ".roan"
    if ROAN_DIR.exists() or not legacy.exists():
        return False
    try:
        legacy.rename(ROAN_DIR)
        return True
    except OSError:
        return False


def has_config() -> bool:
    """True als de gebruiker ooit iets geconfigureerd heeft."""
    return CONFIG_PATH.exists() or bool(os.environ.get("ROAN_API_KEY"))


def resolve_renderer() -> str:
    """Welke TUI-renderer we starten: 'fullscreen' of 'default'.

    Env-vars winnen (net als CLAUDE_CODE_NO_FLICKER / ..._DISABLE_ALTERNATE_SCREEN).
    """
    if os.environ.get("ROAN_DISABLE_ALTERNATE_SCREEN"):
        return "default"
    if os.environ.get("ROAN_NO_FLICKER") == "1":
        return "fullscreen"
    tui = load_config().get("tui")
    return tui if tui in RENDERERS else "default"


def should_offer_fullscreen() -> bool:
    """True als we de fullscreen-dialoog mogen tonen (max 3x, niet na 'niet nu')."""
    if os.environ.get("ROAN_DISABLE_ALTERNATE_SCREEN") or os.environ.get("ROAN_NO_FLICKER"):
        return False
    cfg = load_config()
    if cfg.get("tui") in RENDERERS or cfg.get("tui_declined"):
        return False
    return int(cfg.get("tui_prompts") or 0) < 3


def note_fullscreen_failure() -> str:
    """Registreer een mislukte fullscreen-start; val na 2x terug op classic."""
    cfg = load_config()
    fails = int(cfg.get("tui_fails") or 0) + 1
    updates: dict = {"tui_fails": fails}
    if fails >= 2:
        updates["tui"] = "default"
    return save_config(updates).get("tui") or "default"


def note_fullscreen_success() -> None:
    """Een geslaagde start reset de teller (zoals Claude Code)."""
    if load_config().get("tui_fails"):
        save_config({"tui_fails": 0})


def load_instructions() -> str:
    if INSTRUCTIONS_PATH.exists():
        return INSTRUCTIONS_PATH.read_text()
    from . import i18n

    return i18n.DEFAULT_INSTRUCTIONS.get(i18n.current_language(), i18n.DEFAULT_INSTRUCTIONS["en"])


def save_config(updates: dict) -> dict:
    """Merge updates in ~/.Roan/config.json en geef de nieuwe config terug."""
    raw: dict = {}
    if CONFIG_PATH.exists():
        try:
            raw = json.loads(CONFIG_PATH.read_text())
        except (json.JSONDecodeError, OSError):
            raw = {}
    raw.update(updates)
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(raw, indent=2))
    return load_config()