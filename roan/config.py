import json
import os
from pathlib import Path

ROAN_DIR = Path.home() / ".Roan"
CONFIG_PATH = ROAN_DIR / "config.json"
INSTRUCTIONS_PATH = ROAN_DIR / "instructions.md"
MEMORY_PATH = ROAN_DIR / "memory.md"
USER_PATH = ROAN_DIR / "user.md"
SKILLS_DIR = ROAN_DIR / "skills"
CRON_DIR = ROAN_DIR / "cron"
PLUGINS_DIR = ROAN_DIR / "plugins"
LOGS_DIR = ROAN_DIR / "logs"
CACHE_DIR = ROAN_DIR / "cache"
PLANS_DIR = ROAN_DIR / "plans"

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
    "theme": "mocha",         # zie roan/themes.py (THEME_NAMES)
    "endpoints": [],          # eigen OpenAI-compatibele endpoints (Custom)
    "tui": None,              # "fullscreen" | "default" | None (nog niet gekozen)
    "tui_prompts": 0,         # hoe vaak de fullscreen-dialoog is getoond
    "tui_declined": False,    # "niet nu" gekozen -> nooit meer vragen
    "tui_fails": 0,           # mislukte fullscreen-starts
    "scroll_speed": 1,        # muiswiel-vermenigvuldiger
    "auto_follow": True,      # automatisch naar beneden scrollen
    "mode": "chat",           # "chat" | "plan" | "build" (zie MODES)
    "permissions": "auto",    # "auto" (automatisch goedkeuren) | "user"
    "thinking": "off",        # "off" | "low" | "medium" | "high"
    "headers": {},            # extra HTTP-headers voor elke aanvraag
}

# De drie werkmodi, zoals opencode: chat praat, plan denkt eerst na, build
# wijzigt meteen. Kort genoeg voor de statusbalk.
MODES = ("chat", "plan", "build")

# Toestemming voor toolgebruik: "auto" keurt automatisch goed, "user" vraagt
# het eerst. De statusbalk toont "auto" of "user".
PERMISSIONS = ("auto", "user")

# Denkniveau, doorgegeven als reasoning-effort als de provider het kan.
THINKING_LEVELS = ("off", "low", "medium", "high")

# Providers die een sessie-header eisen. OpenCode Go en Zen routen op een
# stabiele sessie-id; zonder die header geeft een deel van de modellen een
# 400 "Model is unavailable". models.dev kent geen headers-veld, dus dit is
# kennis die hier hoort en niet daar.
SESSION_HEADER_PROVIDERS = {
    "opencode": "x-opencode-session",
    "opencode-go": "x-opencode-session",
    "opencode-zen": "x-opencode-session",
}


def request_headers(provider: str, session_id: str = "", config: dict | None = None) -> dict:
    """Headers voor een aanvraag: sessie-header plus wat de gebruiker zette.

    De sessie-header gaat er eerst in, daarna overschrijft de configuratie hem
    — wie het expliciet instelt, wint.
    """
    cfg = config if config is not None else load_config()
    headers: dict[str, str] = {}
    field = SESSION_HEADER_PROVIDERS.get(str(provider or "").lower())
    if field and session_id:
        headers[field] = str(session_id)
        headers["x-opencode-client"] = "roan"
    for key, value in (cfg.get("headers") or {}).items():
        if value is None:
            headers.pop(str(key), None)
        else:
            headers[str(key)] = str(value)
    return headers

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
    """True als er een config-bestand is (of een key in de omgeving)."""
    return CONFIG_PATH.exists() or bool(os.environ.get("ROAN_API_KEY"))


def is_configured() -> bool:
    """Genoeg om mee te kunnen chatten: een echt model plus een key of lokale server.

    Let op: het config-bestand bestaat ook als je alleen een thema of taal hebt
    gezet — dat is nog geen werkende setup.
    """
    cfg = load_config()
    model = (cfg.get("model") or "").strip()
    if not model or model == DEFAULT_CONFIG["model"]:
        return False
    base = str(cfg.get("base_url") or "")
    if base.startswith(("http://localhost", "http://127.0.0.1", "http://0.0.0.0")):
        return True  # lokale server, geen key nodig
    return bool(cfg.get("api_key") or os.environ.get("ROAN_API_KEY"))


def resolve_renderer() -> str:
    """Welke TUI-renderer we starten: 'fullscreen' of 'default'.

    Fullscreen is de standaard (net als de nieuwe Claude Code-TUI): de app neemt
    het hele scherm over via de alternate screen. Env-vars winnen.
    """
    if os.environ.get("ROAN_DISABLE_ALTERNATE_SCREEN"):
        return "default"
    if os.environ.get("ROAN_NO_FLICKER") == "1":
        return "fullscreen"
    tui = load_config().get("tui")
    return tui if tui in RENDERERS else "fullscreen"


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


# ---------- eigen endpoints (Custom) ----------
def get_endpoints() -> list[dict]:
    """Opgeslagen eigen OpenAI-compatibele endpoints."""
    return list(load_config().get("endpoints") or [])


def get_endpoint(name: str) -> dict | None:
    for endpoint in get_endpoints():
        if endpoint.get("name") == name:
            return endpoint
    return None


def add_endpoint(name: str, base_url: str, api_key: str = "") -> dict:
    """Voeg een endpoint toe (of vervang er een met dezelfde naam)."""
    endpoints = [e for e in get_endpoints() if e.get("name") != name]
    endpoint = {"name": name, "base_url": base_url, "api_key": api_key}
    endpoints.append(endpoint)
    save_config({"endpoints": endpoints})
    return endpoint


def remove_endpoint(name: str) -> bool:
    endpoints = get_endpoints()
    remaining = [e for e in endpoints if e.get("name") != name]
    if len(remaining) == len(endpoints):
        return False
    save_config({"endpoints": remaining})
    return True


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