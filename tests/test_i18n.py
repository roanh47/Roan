"""Tests voor de taal-laag (NL/EN) van programma en agent."""

import pytest

from roan import agent as agent_mod
from roan import config, i18n


@pytest.fixture(autouse=True)
def reset_language():
    i18n.set_language("nl")
    yield
    i18n.set_language("nl")


@pytest.fixture
def tmp_roan(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "ROAN_DIR", tmp_path)
    monkeypatch.setattr(config, "CONFIG_PATH", tmp_path / "config.json")
    monkeypatch.setattr(config, "MEMORY_PATH", tmp_path / "memory.md")
    monkeypatch.setattr(config, "INSTRUCTIONS_PATH", tmp_path / "instructions.md")
    monkeypatch.setattr(agent_mod, "SESSIONS_DIR", tmp_path / "sessions")
    return tmp_path


def test_default_language_is_dutch():
    assert config.DEFAULT_CONFIG["language"] == "nl"
    assert i18n.DEFAULT_LANGUAGE == "nl"


def test_translation_switches():
    i18n.set_language("nl")
    assert i18n.t("cmd_help") == "Toon alle commando's"
    i18n.set_language("en")
    assert i18n.t("cmd_help") == "List every command"


def test_invalid_language_is_ignored():
    i18n.set_language("nl")
    assert i18n.set_language("de") == "nl"
    assert i18n.set_language(None) == "nl"


def test_unknown_key_returns_key():
    assert i18n.t("bestaat_niet") == "bestaat_niet"


def test_english_is_fallback_for_missing_key(monkeypatch):
    monkeypatch.setitem(i18n.STRINGS["nl"], "only_en", None)
    i18n.STRINGS["nl"].pop("only_en", None)
    i18n.STRINGS["en"]["only_en"] = "fallback"
    try:
        assert i18n.t("only_en") == "fallback"
    finally:
        i18n.STRINGS["en"].pop("only_en", None)


def test_formatting():
    i18n.set_language("nl")
    assert i18n.t("msg_model_set", model="x") == "Model → x"
    i18n.set_language("en")
    assert i18n.t("msg_model_set", model="x") == "Model → x"


def test_instructions_differ_per_language():
    assert "Antwoord altijd in het Nederlands" in i18n.DEFAULT_INSTRUCTIONS["nl"]
    assert "Always answer in English" in i18n.DEFAULT_INSTRUCTIONS["en"]


def test_load_instructions_follows_language(tmp_roan):
    i18n.set_language("en")
    assert "Always answer in English" in config.load_instructions()
    i18n.set_language("nl")
    assert "Antwoord altijd in het Nederlands" in config.load_instructions()


def test_load_instructions_file_wins(tmp_roan):
    (tmp_roan / "instructions.md").write_text("eigen instructies")
    i18n.set_language("en")
    assert config.load_instructions() == "eigen instructies"


def test_language_persisted_in_config(tmp_roan):
    i18n.set_language("en")
    # via de agent, zoals de TUI doet
    a = agent_mod.Agent(session_id="lang", restore=False, use_mcp=False)
    a.set_language("en")
    assert config.load_config()["language"] == "en"


def test_agent_set_language_rebuilds_system_prompt(tmp_roan):
    a = agent_mod.Agent(session_id="lang2", restore=False, use_mcp=False)
    a.messages.append({"role": "user", "content": "hoi"})
    a.set_language("en")
    assert a.language() == "en"
    assert "Always answer in English" in a.messages[0]["content"]
    a.set_language("nl")
    assert "Antwoord altijd in het Nederlands" in a.messages[0]["content"]


def test_env_override_language(tmp_roan, monkeypatch):
    monkeypatch.setenv("ROAN_LANGUAGE", "en")
    assert config.load_config()["language"] == "en"


def test_init_from_config(tmp_roan):
    config.save_config({"language": "en"})
    assert i18n.init_from_config() == "en"
    assert i18n.current_language() == "en"


def test_commands_help_follows_language():
    from roan import commands

    i18n.set_language("en")
    help_en = commands.help_text()
    i18n.set_language("nl")
    help_nl = commands.help_text()
    assert "List every command" in help_en
    assert "Toon alle commando's" in help_nl
    # de commando-namen zelf blijven gelijk
    for name in ("/models", "/language", "/setup"):
        assert name in help_en and name in help_nl
