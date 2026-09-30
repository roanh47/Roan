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
            "groq": {
                "models": {
                    "free-one": {"cost": {"input": 0, "output": 0}},
                    "paid-one": {"cost": {"input": 1, "output": 2}},
                    "no-cost": {},
                }
            }
        }

    monkeypatch.setattr(models, "_get", fake_get)
    models.clear_cache()
    free = models.fetch_free_models()
    assert free == [("groq", "free-one")]


def test_free_models_ignores_plans_and_unknown_providers(monkeypatch):
    """cost 0 bij een abonnement of onbekende provider is niet gratis."""

    def fake_get(url, api_key=None):
        return {
            "alibaba-coding-plan": {"models": {"qwen3-max": {"cost": {"input": 0, "output": 0}}}},
            "onbekend": {"models": {"wat": {"cost": {"input": 0, "output": 0}}}},
            "openrouter": {"models": {"x/y:free": {"cost": {"input": 0, "output": 0}}}},
        }

    monkeypatch.setattr(models, "_get", fake_get)
    models.clear_cache()
    free = dict(models.fetch_free_models())
    assert free == {"openrouter": "x/y:free"}


def test_free_models_survives_error(monkeypatch):
    def boom(url, api_key=None):
        raise OSError("offline")

    models.clear_cache()
    monkeypatch.setattr(models, "_get", boom)
    assert models.fetch_free_models() == []


# ---------- tools ----------
def test_todo_write_writes_file(tmp_roan):
    from roan import tools

    out = tools.todo_write('[{"text": "een", "done": true}, {"text": "twee"}]')
    assert "2 items" in out
    content = (tmp_roan / "todo.md").read_text()
    assert "- [x] een" in content
    assert "- [ ] twee" in content


def test_todo_write_bad_json(tmp_roan):
    from roan import tools

    assert "Error" in tools.todo_write("niet json")


def test_edit_file_replaces_once(tmp_roan):
    from roan import tools

    target = tmp_roan / "f.txt"
    target.write_text("a b a")
    tools.edit_file(str(target), "a", "X")
    assert target.read_text() == "X b a"


def test_edit_file_missing_old(tmp_roan):
    from roan import tools

    target = tmp_roan / "f.txt"
    target.write_text("a")
    assert "Error" in tools.edit_file(str(target), "zzz", "X")


def test_list_and_glob(tmp_roan, monkeypatch):
    from roan import tools

    (tmp_roan / "one.txt").write_text("1")
    (tmp_roan / "two.py").write_text("2")
    assert "one.txt" in tools.list_files(str(tmp_roan))
    monkeypatch.chdir(tmp_roan)
    got = tools.glob_files("*.py")
    assert "two.py" in got
