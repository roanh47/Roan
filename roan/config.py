import json
from pathlib import Path

ROAN_DIR = Path.home() / ".roan"
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
}

DEFAULT_CONFIG = {
    "provider": "lmstudio",  # of: ollama/groq/openrouter, of "custom" + eigen base_url
    "base_url": None,         # alleen bij provider == "custom"
    "api_key": None,          # overschrijft de preset-key indien ingesteld
    "model": "local-model",
}

DEFAULT_INSTRUCTIONS = (
    "Je naam is Roan. Je bent een persoonlijke agent harness, gemaakt om Roan Heemstra "
    "te assisteren en te spiegelen. Je helpt met taken in de terminal, schrijft code, "
    "zoekt dingen op en voert opdrachten uit. Wees direct, technisch en behulpzaam. "
    "Antwoord in het Nederlands tenzij anders gevraagd."
)


def load_config() -> dict:
    cfg = DEFAULT_CONFIG.copy()
    if CONFIG_PATH.exists():
        try:
            cfg.update(json.loads(CONFIG_PATH.read_text()))
        except (json.JSONDecodeError, OSError):
            pass

    provider = cfg["provider"]
    if provider in PROVIDER_PRESETS:
        preset = PROVIDER_PRESETS[provider]
        cfg["base_url"] = preset["base_url"]
        if cfg["api_key"] is None:
            cfg["api_key"] = preset["api_key"]

    return cfg


def load_instructions() -> str:
    if INSTRUCTIONS_PATH.exists():
        return INSTRUCTIONS_PATH.read_text()
    return DEFAULT_INSTRUCTIONS