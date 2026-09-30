"""Tests voor de gratis/betaald-classificatie van providers en modellen.

Aanleiding: models.dev zet de kosten van abonnementsproviders (Alibaba Coding
Plan, €20/maand) op 0, waardoor ze onterecht als 'gratis' verschenen.
"""

import pytest

from roan import models


@pytest.fixture(autouse=True)
def clear_cache():
    models.clear_cache()
    yield
    models.clear_cache()


# ---------- plan-detectie ----------
@pytest.mark.parametrize(
    "provider",
    [
        "alibaba-coding-plan",
        "alibaba-coding-plan-cn",
        "alibaba-token-plan",
        "zai-coding-plan",
        "minimax-coding-plan",
        "kimi-code-plan-global",
        "xiaomi-token-plan-ams",
        "kuae-cloud-coding-plan",
        "volcengine-coding-plan",
        "scnet-token-plan",
        "umans-ai-coding-plan",
        "tencent-coding-plan",
    ],
)
def test_plan_providers_are_detected(provider):
    assert models.is_plan_provider(provider) is True


@pytest.mark.parametrize(
    "provider",
    ["groq", "google", "openrouter", "cerebras", "mistral", "nvidia", "lmstudio"],
)
def test_real_providers_are_not_plans(provider):
    assert models.is_plan_provider(provider) is False


def test_plan_detected_from_name():
    assert models.is_plan_provider("iets", {"name": "Alibaba Coding Plan"}) is True
    assert models.is_plan_provider("iets", {"name": "Z.AI Coding Plan"}) is True
    assert models.is_plan_provider("iets", {"name": "Groq"}) is False


# ---------- gratis modellen ----------
def test_free_model_requires_zero_cost():
    assert models.is_free_model("groq", "llama-3", {"cost": {"input": 0.1, "output": 0.2}}) is False
    assert models.is_free_model("groq", "llama-3", {"cost": {"input": 0, "output": 0}}) is True


def test_free_model_needs_free_tier_provider():
    # kosten 0, maar geen bekende gratis provider en geen abonnement
    assert models.is_free_model("onbekend-provider", "m", {"cost": {"input": 0, "output": 0}}) is False


def test_plan_provider_models_are_never_free():
    # precies het Alibaba-geval: cost 0 maar een abonnement
    assert (
        models.is_free_model("alibaba-coding-plan", "qwen3-max", {"cost": {"input": 0, "output": 0}})
        is False
    )


def test_openrouter_free_suffix_always_free():
    assert models.is_free_model("openrouter", "deepseek/deepseek-r1:free", {}) is True
    assert models.is_free_model("iets-raars", "model-x:free", {}) is True


def test_local_providers_are_free():
    assert models.is_free_model("lmstudio", "local-model", {"cost": {"input": 0, "output": 0}}) is True
    assert models.is_free_model("ollama", "llama3", {"cost": {"input": 0, "output": 0}}) is True


def test_llama_hosted_is_not_local():
    # 'llama' is Meta's hosted API, niet lokaal
    assert "llama" not in models.LOCAL_PROVIDERS


# ---------- provider-lijsten ----------
def _fake_data():
    return {
        "groq": {
            "name": "Groq",
            "api": "https://api.groq.com/openai/v1",
            "env": ["GROQ_API_KEY"],
            "models": {
                "llama-3": {"cost": {"input": 0, "output": 0}},
                "mixtral": {"cost": {"input": 0.2, "output": 0.2}},
            },
        },
        "alibaba-coding-plan": {
            "name": "Alibaba Coding Plan",
            "env": ["ALIBABA_CODING_PLAN_API_KEY"],
            "models": {"qwen3-max": {"cost": {"input": 0, "output": 0}}},
        },
        "openai": {
            "name": "OpenAI",
            "api": "https://api.openai.com/v1",
            "env": ["OPENAI_API_KEY"],
            "models": {"gpt-5": {"cost": {"input": 2.5, "output": 10}}},
        },
    }


@pytest.fixture
def fake_dev(monkeypatch):
    monkeypatch.setattr(models, "_dev_data", lambda force=False: _fake_data())
    return _fake_data()


def test_list_providers_free_excludes_plans(fake_dev):
    free = dict(models.list_providers("free"))
    assert "groq" in free
    assert "alibaba-coding-plan" not in free
    assert "openai" not in free


def test_list_providers_paid_contains_plans(fake_dev):
    paid = dict(models.list_providers("paid"))
    assert "alibaba-coding-plan" in paid
    assert "openai" in paid
    assert "groq" not in paid


def test_list_dev_free_excludes_plan_models(fake_dev):
    free = models.list_dev("free")
    assert ("groq", "llama-3") in free
    assert ("alibaba-coding-plan", "qwen3-max") not in free
    assert ("openai", "gpt-5") not in free


def test_provider_models_filtering(fake_dev):
    assert models.provider_models("groq", "free") == ["llama-3"]
    assert models.provider_models("groq", "all") == ["llama-3", "mixtral"]


def test_provider_meta_includes_api_and_plan(fake_dev):
    meta = models.provider_meta("groq")
    assert meta["api"] == "https://api.groq.com/openai/v1"
    assert meta["env"] == "GROQ_API_KEY"
    assert meta["plan"] is False
    assert models.provider_meta("alibaba-coding-plan")["plan"] is True


# ---------- cache ----------
def test_dev_data_is_cached(monkeypatch):
    calls = []
    payload = {"p": {"name": "P", "models": {"m": {"cost": {"input": 0, "output": 0}}}}}

    def fake_get(url, api_key=None):
        calls.append(url)
        return payload

    models.clear_cache()
    monkeypatch.setattr(models, "_get", fake_get)
    models._dev_data()
    models._dev_data()
    assert len(calls) == 1


def test_dev_data_survives_error_with_stale_cache(monkeypatch):
    models.clear_cache()
    monkeypatch.setattr(models, "_get", lambda url, api_key=None: {"x": {"models": {}}})
    assert models._dev_data()

    def boom(url, api_key=None):
        raise OSError("offline")

    models._CACHE["at"] = 0  # forceer verversen
    monkeypatch.setattr(models, "_get", boom)
    assert models._dev_data() == {"x": {"models": {}}}
