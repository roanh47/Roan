"""Tests voor de Roan harness."""

import json

import pytest

from roan import commands, config, models


@pytest.fixture
def tmp_roan(tmp_path, monkeypatch):
    """Isoleer ~/.roan naar een tijdelijke map."""
    monkeypatch.setattr(config, "ROAN_DIR", tmp_path)
    monkeypatch.setattr(config, "CONFIG_PATH", tmp_path / "config.json")
    monkeypatch.setattr(config, "MEMORY_PATH", tmp_path / "memory.md")
    monkeypatch.setattr(config, "INSTRUCTIONS_PATH", tmp_path / "instructions.md")
    return tmp_path


# ---------- config ----------
def test_config_defaults(tmp_roan):
    cfg = config.load_config()
    assert cfg["provider"] == "lmstudio"
    assert cfg["base_url"] == "http://localhost:1234/v1"


def test_config_roundtrip(tmp_roan):
    config.save_config({"model": "gpt-oss-120b", "provider": "groq"})
    cfg = config.load_config()
    assert cfg["model"] == "gpt-oss-120b"
    assert cfg["provider"] == "groq"
    assert cfg["base_url"] == "https://api.groq.com/openai/v1"


def test_config_persists_unknown_keys(tmp_roan):
    config.save_config({"avatar": "/tmp/x.png"})
    config.save_config({"model": "m"})
    raw = json.loads((tmp_roan / "config.json").read_text())
    assert raw["avatar"] == "/tmp/x.png"
    assert raw["model"] == "m"


def test_instructions_default(tmp_roan):
    text = config.load_instructions()
    assert "Roan" in text


# ---------- commands ----------
def test_help_lists_everything():
    for name in ("help", "clear", "theme", "model", "models", "setup", "quit"):
        assert name in commands.names()
    text = commands.help_text()
    assert "/model" in text


def test_get_strips_slash():
    assert commands.get("/help") is not None
    assert commands.get("help") is not None


# ---------- models ----------
def test_provider_models_parses_openai_shape(monkeypatch):
    def fake_get(url, api_key=None):
        assert url.endswith("/v1/models")
        return {"data": [{"id": "b"}, {"id": "a"}, {"id": "a"}]}

    monkeypatch.setattr(models, "_get", fake_get)
    assert models.fetch_provider_models("http://x/v1") == ["a", "b"]


def test_provider_models_empty_base():
    assert models.fetch_provider_models("") == []


def test_provider_models_survives_error(monkeypatch):
    def boom(url, api_key=None):
        raise OSError("offline")

    monkeypatch.setattr(models, "_get", boom)
    assert models.fetch_provider_models("http://x/v1") == []


def test_free_models_filters_zero_cost(monkeypatch):
    def fake_get(url, api_key=None):
        return {
            "acme": {
                "models": {
                    "free-one": {"cost": {"input": 0, "output": 0}},
                    "paid-one": {"cost": {"input": 1, "output": 2}},
                    "no-cost": {},
                }
            }
        }

    monkeypatch.setattr(models, "_get", fake_get)
    free = models.fetch_free_models()
    assert free == [("acme", "free-one")]


def test_free_models_survives_error(monkeypatch):
    def boom(url, api_key=None):
        raise OSError("offline")

    monkeypatch.setattr(models, "_get", boom)
    assert models.fetch_free_models() == []
