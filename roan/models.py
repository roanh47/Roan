"""Live model-lijsten: provider /models en models.dev."""

from __future__ import annotations

import json
import time
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
    """Kosten expliciet 0 in models.dev (laag-niveau check)."""
    cost = model.get("cost") or {}
    if not cost:
        return False
    return not cost.get("input") and not cost.get("output")


# Lokale servers: eigen categorie. Standaard localhost-poorten.
LOCAL_ENDPOINTS = (
    {"id": "lmstudio", "name": "LM Studio", "base_url": "http://localhost:1234/v1"},
    {"id": "ollama", "name": "Ollama", "base_url": "http://localhost:11434/v1"},
    {"id": "llamacpp", "name": "llama.cpp", "base_url": "http://localhost:8080/v1"},
    {"id": "vllm", "name": "vLLM", "base_url": "http://localhost:8000/v1"},
    {"id": "localai", "name": "LocalAI", "base_url": "http://localhost:8080/v1"},
    {"id": "jan", "name": "Jan", "base_url": "http://localhost:1337/v1"},
    {"id": "koboldcpp", "name": "KoboldCpp", "base_url": "http://localhost:5001/v1"},
    {
        "id": "text-generation-webui",
        "name": "text-generation-webui",
        "base_url": "http://localhost:5000/v1",
    },
    {"id": "gpt4all", "name": "GPT4All", "base_url": "http://localhost:4891/v1"},
)

LOCAL_IDS = {entry["id"] for entry in LOCAL_ENDPOINTS}


def list_local() -> list[tuple[str, str, str]]:
    """(id, naam, base_url) van de lokale servers."""
    return [(e["id"], e["name"], e["base_url"]) for e in LOCAL_ENDPOINTS]


def local_endpoint(endpoint_id: str) -> dict | None:
    for entry in LOCAL_ENDPOINTS:
        if entry["id"] == endpoint_id:
            return dict(entry)
    return None

# Providers waarvan de gratis laag de hele catalogus dekt (met rate limits).
FREE_TIER_PROVIDERS = {
    "google",  # Google AI Studio — gratis tier
    "groq",  # gratis tier, rate-limited
    "cerebras",  # gratis tier
    "mistral",  # Experiment-plan is gratis
    "nvidia",  # NIM — gratis tegoed
    "huggingface",  # gratis maandtegoed
    "chutes",  # gratis tier
    "modelscope",  # gratis inferentie-quotum
    "cloudflare-workers-ai",  # gratis dag-quotum
}

# Providers waar alléén bepaalde modellen gratis zijn; het model-id zegt het zelf.
PER_MODEL_FREE_PROVIDERS = {
    "openrouter",  # modellen met ':free'
    "opencode",  # modellen met '-free'
    "opencode-go",
}
FREE_MODEL_SUFFIXES = (":free", "-free")

# Providers waar `cost: 0` wél klopt: hun gratis modellen staan echt op 0.
# (Z.AI's flash-modellen zijn gratis; de rest van hun catalogus is betaald.)
COST_ZERO_FREE_PROVIDERS = {"zai", "z-ai"}

# Abonnementen: models.dev zet cost op 0 omdat de prijs per plan gaat (bijv.
# Alibaba Coding Plan). Die zijn dus níet gratis.
PLAN_MARKERS = (
    "coding plan",
    "token plan",
    "code plan",
    "for coding",
    "subscription",
    "abonnement",
)


def is_plan_provider(provider: str, pdata: dict | None = None) -> bool:
    """True als dit een abonnements-/planprovider is (cost 0 = plan, niet gratis)."""
    pid = (provider or "").lower().replace("_", " ")
    name = ((pdata or {}).get("name") or "").lower()
    return any(
        marker in haystack for marker in PLAN_MARKERS for haystack in (pid.replace("-", " "), name)
    )


def is_free_model(provider: str, model_id: str, model: dict | None = None) -> bool:
    """Gratis te gebruiken? Twee gevallen:

    1. de provider heeft een gratis laag die de hele catalogus dekt, of
    2. het model-id zegt zelf dat het gratis is, bij een partij waar dat
       betrouwbaar is (OpenRouter ':free', OpenCode/Z.AI '-free').

    Alleen `cost == 0` is niet genoeg: models.dev zet dat ook op 0 bij
    abonnementen en bij gateways die een gratis label plakken.
    """
    pid = (provider or "").lower()
    if pid in LOCAL_IDS:
        return False  # lokale servers hebben hun eigen categorie
    if pid in FREE_TIER_PROVIDERS:
        return True
    if pid in PER_MODEL_FREE_PROVIDERS:
        return str(model_id).lower().endswith(FREE_MODEL_SUFFIXES)
    if pid in COST_ZERO_FREE_PROVIDERS:
        return is_free(model or {})
    return False


def is_free_provider(provider: str, pdata: dict | None = None) -> bool:
    models = (pdata or {}).get("models") or {}
    return any(is_free_model(provider, mid, m) for mid, m in models.items())


_CACHE: dict = {"data": None, "at": 0.0}
CACHE_TTL = 300  # seconden


def clear_cache() -> None:
    """Leeg de models.dev-cache (tests)."""
    _CACHE["data"] = None
    _CACHE["at"] = 0.0


def _dev_data(force: bool = False) -> dict:
    """models.dev-data, gecacht zodat we niet per provider een HTTP-call doen."""
    now = time.time()
    if not force and _CACHE["data"] and now - _CACHE["at"] < CACHE_TTL:
        return _CACHE["data"]
    try:
        data = _get(MODELS_DEV_URL)
    except Exception:
        return _CACHE["data"] or {}
    if data:
        _CACHE["data"] = data
        _CACHE["at"] = now
    return data


def provider_has_free(pdata: dict) -> bool:
    """(laag niveau) True als de provider modellen met cost 0 heeft."""
    models = (pdata or {}).get("models") or {}
    return any(is_free(m or {}) for m in models.values())


def list_dev(category: str = "free") -> list[tuple[str, str]]:
    """(provider, model) van models.dev; category is 'free' of 'paid'."""
    data = _dev_data()
    out: list[tuple[str, str]] = []
    for provider, pdata in data.items():
        models = (pdata or {}).get("models") or {}
        for mid, mdata in models.items():
            free = is_free_model(provider, mid, mdata)
            if (category == "free" and free) or (category == "paid" and not free):
                out.append((provider, mid))
    return out


def list_providers(category: str = "all") -> list[tuple[str, str]]:
    """(id, naam) van providers uit models.dev, live.

    category: 'free' = heeft écht gratis modellen, 'paid' = de rest, 'all' = alles.
    Lokale servers hebben hun eigen categorie en staan hier nooit in.
    """
    data = _dev_data()
    out: list[tuple[str, str]] = []
    for pid, pdata in data.items():
        pdata = pdata or {}
        if pid in LOCAL_IDS:
            continue
        free = is_free_provider(pid, pdata)
        if category == "free" and not free:
            continue
        if category == "paid" and free:
            continue
        out.append((pid, pdata.get("name") or pid))
    return sorted(out, key=lambda x: x[0])


def provider_meta(provider: str) -> dict:
    """Naam, env-var, docs-url en API-base van een provider (uit models.dev)."""
    pdata = _dev_data().get(provider) or {}
    env = pdata.get("env") or []
    return {
        "id": provider,
        "name": pdata.get("name") or provider,
        "env": env[0] if env else "",
        "doc": pdata.get("doc") or "",
        "api": pdata.get("api") or "",
        "plan": is_plan_provider(provider, pdata),
        "models": list((pdata.get("models") or {}).keys()),
    }


def provider_models(provider: str, category: str = "all") -> list[str]:
    """Alle model-ids van één provider, optioneel gefilterd op gratis."""
    pdata = (_dev_data().get(provider) or {})
    models = pdata.get("models") or {}
    out = []
    for mid, mdata in models.items():
        free = is_free_model(provider, mid, mdata)
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
