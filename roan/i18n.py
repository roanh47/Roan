"""Taal van het programma en van de agent (NL / EN).

Eén tabel met alle zichtbare strings. `t("key")` geeft de string in de actieve
taal; ontbreekt een vertaling dan valt hij terug op Engels.
"""

from __future__ import annotations

LANGUAGES = ("nl", "en")
DEFAULT_LANGUAGE = "nl"

_current = DEFAULT_LANGUAGE

STRINGS: dict[str, dict[str, str]] = {
    "nl": {
        # app
        "app_subtitle": "je agent harness",
        "input_placeholder": "Bericht aan Roan…  (/help)",
        "status_session": "sessie",
        "status_key_set": "key ingesteld",
        "status_no_key": "geen key",
        "onboarding": "**Nog geen model geconfigureerd.**\n\nStel het hieronder in, of draai `Roan init` in een terminal.",
        # setup
        "setup_title": "Setup",
        "setup_provider": "Provider",
        "setup_api_key": "API key (leeg = bestaande behouden)",
        "setup_model": "Model",
        "setup_base_url": "Base URL (alleen bij provider = custom)",
        "setup_save": "Opslaan",
        "setup_cancel": "Annuleren",
        "setup_saved": "Opgeslagen — model: {model}  ·  provider: {provider}",
        # models
        "models_title": "Modellen",
        "models_free": "Gratis",
        "models_paid": "Betaald",
        "models_custom": "Deze provider",
        "models_all_providers": "alle providers",
        "models_more": "… en nog {n} modellen (filter op provider)",
        "models_fetching": "Modellen ophalen (models.dev + provider) ...",
        "models_unknown_provider": (
            "Model → {model}. Provider '{provider}' is niet bekend — "
            "stel base_url + api_key in via /setup."
        ),
        # commands
        "cmd_help": "Toon alle commando's",
        "cmd_clear": "Leeg het gesprek",
        "cmd_theme": "Wissel thema",
        "cmd_model": "Zet of toon het actieve model",
        "cmd_models": "Model-browser: gratis / betaald / deze provider",
        "cmd_free": "Lijst 100% gratis modellen",
        "cmd_provider": "Zet of toon de provider",
        "cmd_setup": "Open het setup-scherm",
        "cmd_memory": "Toon wat Roan onthouden heeft",
        "cmd_new": "Begin een nieuw gesprek",
        "cmd_sessions": "Toon opgeslagen sessies",
        "cmd_compact": "Vat het gesprek samen om context vrij te maken",
        "cmd_language": "Wissel de taal (nl / en)",
        "cmd_quit": "Afsluiten",
        "help_title": "Commando's",
        "help_languages": "Talen: nl, en",
        # messages
        "msg_unknown_cmd": "Onbekend commando: /{name}  (probeer /help)",
        "msg_theme_set": "Thema → {name}",
        "msg_themes": "Thema's: {names}",
        "msg_model_current": "Huidig model: {model}",
        "msg_model_set": "Model → {model}",
        "msg_provider_current": "Huidige provider: {provider}",
        "msg_provider_set": "Provider → {name}",
        "msg_providers": "Providers: {names}",
        "msg_new_session": "Nieuwe sessie: {id}",
        "msg_restored": "(gesprek hersteld — {n} berichten)",
        "msg_no_sessions": "Nog geen sessies.",
        "msg_sessions_title": "Sessies",
        "msg_memory_empty": "_(nog niets onthouden)_",
        "msg_summarizing": "Gesprek samenvatten ...",
        "msg_compacted": "Gesprek samengevat.",
        "msg_nothing_to_compact": "Niets om samen te vatten.",
        "msg_language_set": "Taal → {lang}",
        "msg_languages": "Talen: {langs}",
        "tg_help": (
            "Roan — agent harness\n\n"
            "Stuur gewoon een bericht om te praten.\n\n"
            "Commando's:\n"
            "/help — deze tekst\n"
            "/new — nieuw gesprek\n"
            "/clear — zelfde als /new\n"
            "/model <naam> — model kiezen\n"
            "/models — modellen van de provider\n"
            "/free — 100% gratis modellen\n"
            "/provider <naam> — provider kiezen\n"
            "/language <nl|en> — taal wisselen\n"
            "/memory — wat Roan onthouden heeft\n"
            "/status — huidige configuratie"
        ),
        # tools
        "tool_devmagic": "",
        "cli_help": (
            "Roan — agent harness\n\n"
            "Gebruik: Roan [commando]\n\n"
            "Commando's:\n"
            "  (geen)      Start de TUI\n"
            "  init        Setup: provider, api_key, model, telegram-token\n"
            "  telegram    Draai de agent als Telegram-bot\n"
            "  chat        Plain-text chat (telefoon / smalle terminal)\n"
            "  update      Update naar de nieuwste versie van dit kanaal\n"
            "  version     Toon de versie\n"
            "  help        Deze tekst\n\n"
            "`roan` (kleine letter) werkt ook."
        ),
        "repl_banner": "Roan — agent harness.  /help voor commando's, /quit om te stoppen.",
        "repl_onboard": (
            "Nog geen model geconfigureerd.\n"
            "Draai `Roan init` om een provider + api_key + model in te stellen,\n"
            "of zet ROAN_API_KEY / ROAN_MODEL in je omgeving.\n"
            "Gratis opties: groq, openrouter (models met ':free')."
        ),
        "repl_model_line": "model: {model}  ·  provider: {provider}",
        "repl_conn_error": "Kan geen verbinding maken met {url}.",
        "repl_conn_hint": "Draai `Roan init` of /provider + /model om dit te wijzigen.",
        "msg_error": "Fout: {error}",
        "msg_aborted": "(afgebroken)",
    },
    "en": {
        "app_subtitle": "your agent harness",
        "input_placeholder": "Message Roan…  (/help)",
        "status_session": "session",
        "status_key_set": "key set",
        "status_no_key": "no key",
        "onboarding": "**No model configured yet.**\n\nSet it up below, or run `Roan init` in a terminal.",
        "setup_title": "Setup",
        "setup_provider": "Provider",
        "setup_api_key": "API key (empty = keep current)",
        "setup_model": "Model",
        "setup_base_url": "Base URL (only when provider = custom)",
        "setup_save": "Save",
        "setup_cancel": "Cancel",
        "setup_saved": "Saved — model: {model}  ·  provider: {provider}",
        "models_title": "Models",
        "models_free": "Free",
        "models_paid": "Paid",
        "models_custom": "This provider",
        "models_all_providers": "all providers",
        "models_more": "… and {n} more models (filter by provider)",
        "models_fetching": "Fetching models (models.dev + provider) ...",
        "models_unknown_provider": (
            "Model → {model}. Provider '{provider}' is unknown — "
            "set base_url + api_key via /setup."
        ),
        "cmd_help": "List every command",
        "cmd_clear": "Clear the conversation",
        "cmd_theme": "Switch theme",
        "cmd_model": "Set or show the active model",
        "cmd_models": "Model browser: free / paid / this provider",
        "cmd_free": "List 100% free models",
        "cmd_provider": "Set or show the provider",
        "cmd_setup": "Open the setup screen",
        "cmd_memory": "Show what Roan remembered",
        "cmd_new": "Start a fresh conversation",
        "cmd_sessions": "List saved sessions",
        "cmd_compact": "Summarise the conversation to free up context",
        "cmd_language": "Switch language (nl / en)",
        "cmd_quit": "Exit",
        "help_title": "Commands",
        "help_languages": "Languages: nl, en",
        "msg_unknown_cmd": "Unknown command: /{name}  (try /help)",
        "msg_theme_set": "Theme → {name}",
        "msg_themes": "Themes: {names}",
        "msg_model_current": "Current model: {model}",
        "msg_model_set": "Model → {model}",
        "msg_provider_current": "Current provider: {provider}",
        "msg_provider_set": "Provider → {name}",
        "msg_providers": "Providers: {names}",
        "msg_new_session": "New session: {id}",
        "msg_restored": "(conversation restored — {n} messages)",
        "msg_no_sessions": "No sessions yet.",
        "msg_sessions_title": "Sessions",
        "msg_memory_empty": "_(nothing remembered yet)_",
        "msg_summarizing": "Summarising the conversation ...",
        "msg_compacted": "Conversation summarised.",
        "msg_nothing_to_compact": "Nothing to summarise.",
        "msg_language_set": "Language → {lang}",
        "msg_languages": "Languages: {langs}",
        "tg_help": (
            "Roan — agent harness\n\n"
            "Just send a message to chat.\n\n"
            "Commands:\n"
            "/help — this text\n"
            "/new — new conversation\n"
            "/clear — same as /new\n"
            "/model <name> — pick a model\n"
            "/models — models from the provider\n"
            "/free — 100% free models\n"
            "/provider <name> — pick a provider\n"
            "/language <nl|en> — switch language\n"
            "/memory — what Roan remembered\n"
            "/status — current configuration"
        ),
        "tool_devmagic": "",
        "cli_help": (
            "Roan — agent harness\n\n"
            "Usage: Roan [command]\n\n"
            "Commands:\n"
            "  (none)      Start the TUI\n"
            "  init        Setup: provider, api_key, model, telegram token\n"
            "  telegram    Run the agent as a Telegram bot\n"
            "  chat        Plain-text chat (phone / narrow terminal)\n"
            "  update      Update to the latest version for this channel\n"
            "  version     Show the version\n"
            "  help        This message\n\n"
            "`roan` (lowercase) works too."
        ),
        "repl_banner": "Roan — agent harness.  /help for commands, /quit to exit.",
        "repl_onboard": (
            "No model configured yet.\n"
            "Run `Roan init` to set a provider + api_key + model,\n"
            "or set ROAN_API_KEY / ROAN_MODEL in your environment.\n"
            "Free options: groq, openrouter (models with ':free')."
        ),
        "repl_model_line": "model: {model}  ·  provider: {provider}",
        "repl_conn_error": "Cannot connect to {url}.",
        "repl_conn_hint": "Run `Roan init` or /provider + /model to change this.",
        "msg_error": "Error: {error}",
        "msg_aborted": "(aborted)",
    },
}

# Default system prompt per taal.
DEFAULT_INSTRUCTIONS = {
    "nl": (
        "Je naam is Roan. Je bent een persoonlijke agent harness, gemaakt om Roan Heemstra "
        "te assisteren en te spiegelen. Je helpt met taken in de terminal, schrijft code, "
        "zoekt dingen op en voert opdrachten uit. Wees direct, technisch en behulpzaam. "
        "Antwoord altijd in het Nederlands."
    ),
    "en": (
        "Your name is Roan. You are a personal agent harness, built to assist and mirror "
        "Roan Heemstra. You help with tasks in the terminal, write code, look things up and "
        "run commands. Be direct, technical and helpful. Always answer in English."
    ),
}


def set_language(lang: str | None) -> str:
    global _current
    if lang and lang.lower() in LANGUAGES:
        _current = lang.lower()
    return _current


def current_language() -> str:
    return _current


def t(key: str, **kwargs) -> str:
    """Vertaalde string voor de actieve taal, met Engels als terugval."""
    value = STRINGS.get(_current, {}).get(key)
    if value is None:
        value = STRINGS["en"].get(key, key)
    if kwargs:
        try:
            return value.format(**kwargs)
        except (KeyError, IndexError):
            return value
    return value


def init_from_config() -> str:
    """Zet de taal op basis van de config (en de env-var)."""
    from .config import load_config

    try:
        return set_language(load_config().get("language"))
    except Exception:
        return set_language(DEFAULT_LANGUAGE)
