"""Live model-lijsten: provider /models en models.dev."""

from __future__ import annotations

import json
import urllib.request

MODELS_DEV_URL = "https://models.dev/api.json"
_TIMEOUT = 8


_HEADERS = {
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (Roan agent harness)",
}


def _get(url: str, api_key: str | None = None) -> dict:
    req = urllib.request.Request(url, headers=dict(_HEADERS))
    if api_key:
        req.add_header("Authorization", f"Bearer {api_key}")
    with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
        return json.loads(resp.read().decode())


def fetch_provider_models(base_url: str, api_key: str | None = None) -> list[str]:
    """Live /models van een OpenAI-compatibele provider."""
    if not base_url:
        return []
    url = base_url.rstrip("/") + "/models"
    try:
        data = _get(url, api_key)
    except Exception:
        return []
    items = data.get("data") or data.get("models") or []
    out = []
    for it in items:
        if isinstance(it, dict):
            name = it.get("id") or it.get("name")
            if name:
                out.append(str(name))
        elif isinstance(it, str):
            out.append(it)
    return sorted(set(out))


def is_free(model: dict) -> bool:
    """Een model is gratis als de kosten expliciet 0 zijn."""
    cost = model.get("cost") or {}
    if not cost:
        return False
    return not cost.get("input") and not cost.get("output")


def list_dev(category: str = "free") -> list[tuple[str, str]]:
    """(provider, model) van models.dev; category is 'free' of 'paid'."""
    try:
        data = _get(MODELS_DEV_URL)
    except Exception:
        return []
    out: list[tuple[str, str]] = []
    for provider, pdata in data.items():
        models = (pdata or {}).get("models") or {}
        for mid, mdata in models.items():
            free = is_free(mdata or {})
            if (category == "free" and free) or (category == "paid" and not free):
                out.append((provider, mid))
    return out


def _dev_data() -> dict:
    try:
        return _get(MODELS_DEV_URL)
    except Exception:
        return {}


def provider_has_free(pdata: dict) -> bool:
    models = (pdata or {}).get("models") or {}
    return any(is_free(m or {}) for m in models.values())


def list_providers(category: str = "all") -> list[tuple[str, str]]:
    """(id, naam) van providers uit models.dev, live.

    category: 'free' = heeft 100% gratis modellen, 'paid' = de rest, 'all' = alles.
    """
    data = _dev_data()
    out: list[tuple[str, str]] = []
    for pid, pdata in data.items():
        pdata = pdata or {}
        free = provider_has_free(pdata)
        if category == "free" and not free:
            continue
        if category == "paid" and free:
            continue
        out.append((pid, pdata.get("name") or pid))
    return sorted(out, key=lambda x: x[0])


def provider_meta(provider: str) -> dict:
    """Naam, env-var en docs-url van een provider (uit models.dev)."""
    pdata = (_dev_data().get(provider) or {})
    env = pdata.get("env") or []
    return {
        "id": provider,
        "name": pdata.get("name") or provider,
        "env": env[0] if env else "",
        "doc": pdata.get("doc") or "",
        "models": list((pdata.get("models") or {}).keys()),
    }


def provider_models(provider: str, category: str = "all") -> list[str]:
    """Alle model-ids van één provider, optioneel gefilterd op gratis."""
    pdata = (_dev_data().get(provider) or {})
    models = pdata.get("models") or {}
    out = []
    for mid, mdata in models.items():
        free = is_free(mdata or {})
        if category == "free" and not free:
            continue
        if category == "paid" and free:
            continue
        out.append(mid)
    return sorted(out)


def fetch_free_models() -> list[tuple[str, str]]:
    """(provider, model) van models.dev waar cost 0 is."""
    return list_dev("free")


def list_models(base_url: str, api_key: str | None = None) -> str:
    """Markdown-lijst van modellen op de huidige provider."""
    models = fetch_provider_models(base_url, api_key)
    if not models:
        return "Geen modellen gevonden. Check `/setup` (provider, base_url, api_key)."
    lines = [f"**Modellen ({len(models)})**", ""]
    lines += [f"- `{m}`" for m in models]
    return "\n".join(lines)


def list_free() -> str:
    """Markdown-lijst van 100% gratis modellen (models.dev)."""
    free = fetch_free_models()
    if not free:
        return "Geen gratis modellen gevonden (of models.dev onbereikbaar)."
    lines = [f"**Gratis modellen ({len(free)})**", ""]
    lines += [f"- `{p}` · `{m}`" for p, m in free]
    return "\n".join(lines)
