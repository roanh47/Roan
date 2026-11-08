"""`roan init` — snelle setup-wizard voor de CLI (werkt ook over SSH)."""

from __future__ import annotations

from .config import PROVIDER_PRESETS, load_config, save_config


def run_init() -> None:
    cfg = load_config()
    print("Roan setup\n")

    providers = ", ".join(sorted(PROVIDER_PRESETS))
    current = cfg.get("provider", "lmstudio")
    provider = input(f"Provider [{current}]\n  ({providers})\n> ").strip() or current

    if provider not in PROVIDER_PRESETS:
        print(f"Onbekende provider '{provider}', ik gebruik 'custom'.")
        provider = "custom"

    updates: dict = {"provider": provider}

    if provider == "custom":
        base = input(f"base_url [{cfg.get('base_url') or ''}]: ").strip()
        if base:
            updates["base_url"] = base

    if provider not in ("lmstudio", "ollama"):
        key = input("api_key (leeg laten = bestaande behouden): ").strip()
        if key:
            updates["api_key"] = key

    model = input(f"model [{cfg.get('model')}]: ").strip()
    if model:
        updates["model"] = model

    token = input("Telegram bot-token (optioneel, leeg = overslaan): ").strip()
    if token:
        updates["telegram_token"] = token

    new_cfg = save_config(updates)
    print("\nOpgeslagen:")
    print(f"  provider : {new_cfg['provider']}")
    print(f"  base_url : {new_cfg['base_url']}")
    print(f"  model    : {new_cfg['model']}")
    print(f"  api_key  : {'set' if new_cfg.get('api_key') else 'empty'}")
    print("\nStart met: roan")
