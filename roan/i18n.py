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
        "setup_required": "Nog niets ingesteld — kies provider + model en vul je key in.",
        "setup_required_nudge": "Eerst instellen — sluit pas na opslaan.",
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
        # providers
        "provider_title": "Provider",
        "provider_category": "Categorie",
        "provider_cat_free": "Gratis",
        "provider_cat_paid": "Betaald",
        "provider_cat_local": "Lokaal",
        "provider_cat_custom": "Custom",
        "provider_name": "Naam",
        "provider_key": "API key",
        "provider_add": "＋ Endpoint toevoegen",
        "provider_delete": "Verwijderen",
        "provider_local_hint": "Draait op je eigen machine — standaard localhost-poorten.",
        "provider_desc_plan": "abonnement · {n} modellen",
        "provider_desc_models": "{n} modellen",
        "provider_id": "id",
        "provider_add_hint": "Vul minimaal een naam en een base URL in.",
        "provider_no_endpoints": "Nog geen eigen endpoints. Voeg er hieronder een toe.",
        "msg_endpoint_added": "Endpoint toegevoegd: {name}",
        "msg_endpoint_removed": "Endpoint verwijderd: {name}",
        "provider_label": "Provider",
        "provider_base_url": "Base URL",
        "provider_env": "Env-var",
        "provider_doc": "Docs",
        "provider_choose": "Kies",
        "provider_back": "Terug",
        "provider_plan": "abonnement",
        "provider_plan_note": (
            "{provider} is een abonnement (vast bedrag per maand), geen gratis provider. "
            "Je api_key uit dat plan werkt hier wel gewoon."
        ),
        "setup_choose_provider": "Kies provider…",
        "setup_choose_model": "Kies model…",
        "setup_none": "(nog niet gekozen)",
        "models_for": "Modellen van {provider}",
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
        "cmd_skills": "Toon beschikbare skills",
        "cmd_new": "Begin een nieuw gesprek",
        "cmd_sessions": "Toon opgeslagen sessies",
        "cmd_compact": "Vat het gesprek samen om context vrij te maken",
        "cmd_language": "Wissel de taal (nl / en)",
        "cmd_tui": "Wissel de renderer (fullscreen / default)",
        "cmd_quit": "Afsluiten",
        "help_title": "Commando's",
        "help_languages": "Talen: nl, en",
        # messages
        "msg_unknown_cmd": "Onbekend commando: /{name}  (probeer /help)",
        "theme_title": "Thema",
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
        # tui
        "tui_names": "fullscreen, default",
        "tui_current": "Huidige renderer: {mode}",
        "tui_set": "Renderer → {mode}",
        "tui_fullscreen": "fullscreen (alternate screen, geen flicker, muis)",
        "tui_default": "default (klassiek, in je terminal-scrollback)",
        "tui_prompt_title": "Nieuwe TUI",
        "tui_prompt_body": (
            "Roan kan de nieuwe fullscreen-TUI gebruiken.\n\n"
            "Die tekent op het alternate screen (zoals vim), heeft geen flicker, "
            "houdt geheugen vlak in lange gesprekken en ondersteunt de muis.\n\n"
            "Later te wisselen met /tui."
        ),
        "tui_yes": "Ja, gebruik fullscreen",
        "tui_notnow": "Niet nu",
        "transcript_title": "Transcript",
        "transcript_hint": "/ zoeken · n/N volgende · g/G top/einde · q of Esc terug",
        "transcript_search": "Zoek: ",
        "transcript_no_match": "Geen match",
        "transcript_matches": "{n} matches",
        "jump_bottom": "↓ naar beneden",
        "new_messages": "{n} nieuwe berichten",
        "focus_on": "Focus-modus aan",
        "focus_off": "Focus-modus uit",
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
            "  cron        Draai geplande prompts uit ~/.Roan/cron\n"
            "  home        Toon de ~/.Roan-map\n"
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
        "setup_required": "Nothing set up yet — pick a provider + model and enter your key.",
        "setup_required_nudge": "Set it up first — closes only after saving.",
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
        "cmd_skills": "List available skills",
        "cmd_new": "Start a fresh conversation",
        "cmd_sessions": "List saved sessions",
        "cmd_compact": "Summarise the conversation to free up context",
        "cmd_language": "Switch language (nl / en)",
        "cmd_tui": "Switch the renderer (fullscreen / default)",
        "cmd_quit": "Exit",
        "help_title": "Commands",
        "help_languages": "Languages: nl, en",
        "msg_unknown_cmd": "Unknown command: /{name}  (try /help)",
        "theme_title": "Theme",
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
        # providers
        "provider_title": "Provider",
        "provider_category": "Category",
        "provider_cat_free": "Free",
        "provider_cat_paid": "Paid",
        "provider_cat_local": "Local",
        "provider_cat_custom": "Custom",
        "provider_name": "Name",
        "provider_key": "API key",
        "provider_add": "＋ Add endpoint",
        "provider_delete": "Delete",
        "provider_local_hint": "Runs on your own machine — default localhost ports.",
        "provider_desc_plan": "subscription · {n} models",
        "provider_desc_models": "{n} models",
        "provider_id": "id",
        "provider_add_hint": "Fill in at least a name and a base URL.",
        "provider_no_endpoints": "No custom endpoints yet. Add one below.",
        "msg_endpoint_added": "Endpoint added: {name}",
        "msg_endpoint_removed": "Endpoint removed: {name}",
        "provider_label": "Provider",
        "provider_base_url": "Base URL",
        "provider_env": "Env var",
        "provider_doc": "Docs",
        "provider_choose": "Choose",
        "provider_back": "Back",
        "provider_plan": "subscription",
        "provider_plan_note": (
            "{provider} is a subscription (flat monthly fee), not a free provider. "
            "Your api_key from that plan still works here."
        ),
        "setup_choose_provider": "Choose provider…",
        "setup_choose_model": "Choose model…",
        "setup_none": "(not chosen yet)",
        "models_for": "Models from {provider}",
        # tui
        "tui_names": "fullscreen, default",
        "tui_current": "Current renderer: {mode}",
        "tui_set": "Renderer → {mode}",
        "tui_fullscreen": "fullscreen (alternate screen, no flicker, mouse)",
        "tui_default": "default (classic, in your terminal scrollback)",
        "tui_prompt_title": "New TUI",
        "tui_prompt_body": (
            "Roan can use the new fullscreen TUI.\n\n"
            "It draws on the alternate screen (like vim), eliminates flicker, keeps "
            "memory flat in long conversations and adds mouse support.\n\n"
            "Switch later with /tui."
        ),
        "tui_yes": "Yes, use fullscreen",
        "tui_notnow": "Not now",
        "transcript_title": "Transcript",
        "transcript_hint": "/ search · n/N next · g/G top/bottom · q or Esc back",
        "transcript_search": "Search: ",
        "transcript_no_match": "No match",
        "transcript_matches": "{n} matches",
        "jump_bottom": "↓ jump to bottom",
        "new_messages": "{n} new messages",
        "focus_on": "Focus mode on",
        "focus_off": "Focus mode off",
        "cli_help": (
            "Roan — agent harness\n\n"
            "Usage: Roan [command]\n\n"
            "Commands:\n"
            "  (none)      Start the TUI\n"
            "  init        Setup: provider, api_key, model, telegram token\n"
            "  telegram    Run the agent as a Telegram bot\n"
            "  chat        Plain-text chat (phone / narrow terminal)\n"
            "  cron        Run scheduled prompts from ~/.Roan/cron\n"
            "  home        Show the ~/.Roan directory\n"
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
# Korte beschrijving per provider, voor in de provider-lijst. Onbekende providers
# krijgen een beschrijving op basis van hun aantal modellen.
PROVIDER_DESCRIPTIONS: dict[str, dict[str, str]] = {
    "nl": {
        # gratis
        "cerebras": "Snel, gratis tier",
        "chutes": "Gratis tier",
        "cloudflare-workers-ai": "Gratis dag-quotum",
        "google": "AI Studio, gratis tier",
        "groq": "Snel, gratis tier",
        "huggingface": "Gratis maandtegoed",
        "mistral": "Gratis Experiment-plan",
        "modelscope": "Gratis quotum",
        "nvidia": "NIM, gratis tegoed",
        "opencode": "Sommige modellen gratis",
        "opencode-go": "Sommige modellen gratis",
        "openrouter": "Sommige modellen gratis",
        "zai": "Gratis flash-modellen",
        # lokaal
        "lmstudio": "Lokaal",
        "ollama": "Lokaal",
        "llamacpp": "Lokaal",
        "vllm": "Lokaal",
        "localai": "Lokaal",
        "jan": "Lokaal",
        "koboldcpp": "Lokaal",
        "text-generation-webui": "Lokaal",
        "gpt4all": "Lokaal",
        # betaald
        "openai": "GPT- en o-modellen",
        "anthropic": "Claude-modellen",
        "google-vertex": "Gemini via Google Cloud",
        "google-vertex-anthropic": "Claude via Google Cloud",
        "deepseek": "DeepSeek-modellen, goedkoop",
        "xai": "Grok-modellen",
        "together": "Open modellen",
        "fireworks-ai": "Open modellen, snel",
        "deepinfra": "Open modellen, goedkoop",
        "novita": "Open modellen",
        "baseten": "Open modellen",
        "hyperbolic": "Open modellen",
        "lambda": "GPU-cloud met open modellen",
        "sambanova": "Snel, open modellen",
        "nebius": "Open modellen",
        "scaleway": "EU-cloud met open modellen",
        "perplexity": "Zoeken + LLM",
        "cohere": "Cohere-modellen",
        "moonshotai": "Kimi-modellen",
        "minimax": "MiniMax-modellen",
        "alibaba": "Qwen-modellen",
        "ai21": "Jamba-modellen",
        "upstage": "Solar-modellen",
        "voyage": "Embeddings",
        "jina": "Embeddings",
        "elevenlabs": "Spraak",
        "replicate": "Duizenden modellen",
        "vercel": "AI Gateway",
        "github-copilot": "Met je Copilot-abonnement",
        "github-models": "Gratis met een GitHub-account",
        "alibaba-coding-plan": "Abonnement ~€20/mnd",
        "zai-coding-plan": "Abonnement",
        "kimi-code-plan-global": "Abonnement",
        "kimi-code-plan-cn": "Abonnement",
        "minimax-coding-plan": "Abonnement",
        "minimax-cn-coding-plan": "Abonnement",
        "alibaba-token-plan": "Abonnement",
        "xiaomi-token-plan-ams": "Abonnement",
        "tencent-coding-plan": "Abonnement",
        "volcengine-coding-plan": "Abonnement",
    },
    "en": {
        "cerebras": "Fast, free tier",
        "chutes": "Free tier",
        "cloudflare-workers-ai": "Free daily allowance",
        "google": "AI Studio, free tier",
        "groq": "Fast, free tier",
        "huggingface": "Free monthly credit",
        "mistral": "Free Experiment plan",
        "modelscope": "Free quota",
        "nvidia": "NIM, free credit",
        "opencode": "Some models free",
        "opencode-go": "Some models free",
        "openrouter": "Some models free",
        "zai": "Free flash models",
        "lmstudio": "Local",
        "ollama": "Local",
        "llamacpp": "Local",
        "vllm": "Local",
        "localai": "Local",
        "jan": "Local",
        "koboldcpp": "Local",
        "text-generation-webui": "Local",
        "gpt4all": "Local",
        "openai": "GPT and o models",
        "anthropic": "Claude models",
        "google-vertex": "Gemini via Google Cloud",
        "google-vertex-anthropic": "Claude via Google Cloud",
        "deepseek": "DeepSeek models, cheap",
        "xai": "Grok models",
        "together": "Open models",
        "fireworks-ai": "Open models, fast",
        "deepinfra": "Open models, cheap",
        "novita": "Open models",
        "baseten": "Open models",
        "hyperbolic": "Open models",
        "lambda": "GPU cloud with open models",
        "sambanova": "Fast, open models",
        "nebius": "Open models",
        "scaleway": "EU cloud with open models",
        "perplexity": "Search + LLM",
        "cohere": "Cohere models",
        "moonshotai": "Kimi models",
        "minimax": "MiniMax models",
        "alibaba": "Qwen models",
        "ai21": "Jamba models",
        "upstage": "Solar models",
        "voyage": "Embeddings",
        "jina": "Embeddings",
        "elevenlabs": "Speech",
        "replicate": "Thousands of models",
        "vercel": "AI Gateway",
        "github-copilot": "With your Copilot plan",
        "github-models": "Free with a GitHub account",
        "alibaba-coding-plan": "Subscription ~€20/mo",
        "zai-coding-plan": "Subscription",
        "kimi-code-plan-global": "Subscription",
        "kimi-code-plan-cn": "Subscription",
        "minimax-coding-plan": "Subscription",
        "minimax-cn-coding-plan": "Subscription",
        "alibaba-token-plan": "Subscription",
        "xiaomi-token-plan-ams": "Subscription",
        "tencent-coding-plan": "Subscription",
        "volcengine-coding-plan": "Subscription",
    },
}


def provider_desc(provider: str) -> str:
    """Korte beschrijving van een provider; leeg als we hem niet kennen."""
    table = PROVIDER_DESCRIPTIONS.get(current_language()) or PROVIDER_DESCRIPTIONS["en"]
    return table.get((provider or "").lower(), "")


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
