"""Tests voor het Telegram-kanaal (pure helpers, geen netwerk)."""

import pytest

from roan import config
from roan.channels import telegram as tg
from roan.channels.base import Channel


@pytest.fixture
def tmp_roan(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "ROAN_DIR", tmp_path)
    monkeypatch.setattr(config, "CONFIG_PATH", tmp_path / "config.json")
    monkeypatch.setattr(config, "MEMORY_PATH", tmp_path / "memory.md")
    monkeypatch.setattr(config, "INSTRUCTIONS_PATH", tmp_path / "instructions.md")
    return tmp_path


class FakeAgent:
    session_id = "s1"

    def reload(self):
        pass


class FakeChannel(Channel):
    name = "fake"


# ---------- split_message ----------
def test_split_short():
    assert tg.split_message("hoi") == ["hoi"]


def test_split_empty():
    assert tg.split_message("") == ["(leeg)"]


def test_split_long():
    text = "a" * 9000
    chunks = tg.split_message(text, limit=4000)
    assert all(len(c) <= 4000 for c in chunks)
    assert "".join(chunks) == text


def test_split_prefers_newline():
    text = "x" * 3900 + "\n" + "y" * 500
    chunks = tg.split_message(text, limit=4000)
    assert len(chunks) == 2
    assert chunks[0].endswith("x")


# ---------- escape ----------
def test_escape():
    assert tg.escape("<b>&</b>") == "&lt;b&gt;&amp;&lt;/b&gt;"


# ---------- parse_update ----------
def test_parse_update_valid():
    up = {"update_id": 1, "message": {"message_id": 5, "chat": {"id": 42}, "text": "hoi"}}
    assert tg.parse_update(up) == ("42", "hoi", 5)


def test_parse_update_no_text():
    up = {"update_id": 1, "message": {"message_id": 5, "chat": {"id": 42}, "photo": []}}
    assert tg.parse_update(up) is None


def test_parse_update_garbage():
    assert tg.parse_update({"update_id": 1}) is None


# ---------- handle_command ----------
def test_cmd_help(tmp_roan):
    assert "Roan" in tg.handle_command("/help", FakeAgent(), lambda: FakeAgent())
    assert "Roan" in tg.handle_command("/start", FakeAgent(), lambda: FakeAgent())


def test_cmd_not_a_command():
    assert tg.handle_command("gewoon tekst", FakeAgent(), lambda: FakeAgent()) is None


def test_cmd_model_show(tmp_roan):
    out = tg.handle_command("/model", FakeAgent(), lambda: FakeAgent())
    assert "lmstudio" not in out and "local-model" in out


def test_cmd_model_set(tmp_roan):
    out = tg.handle_command("/model cool-model", FakeAgent(), lambda: FakeAgent())
    assert "cool-model" in out
    assert config.load_config()["model"] == "cool-model"


def test_cmd_model_strips_botname(tmp_roan):
    out = tg.handle_command("/model@roanbot naam-x", FakeAgent(), lambda: FakeAgent())
    assert "naam-x" in out


def test_cmd_provider_invalid(tmp_roan):
    out = tg.handle_command("/provider nope", FakeAgent(), lambda: FakeAgent())
    assert "Providers" in out


def test_cmd_provider_set(tmp_roan):
    out = tg.handle_command("/provider groq", FakeAgent(), lambda: FakeAgent())
    assert "groq" in out
    assert config.load_config()["provider"] == "groq"


def test_cmd_status(tmp_roan):
    out = tg.handle_command("/status", FakeAgent(), lambda: FakeAgent())
    assert "provider:" in out and "model:" in out


def test_cmd_unknown():
    out = tg.handle_command("/blah", FakeAgent(), lambda: FakeAgent())
    assert "Onbekend" in out


# ---------- Channel ----------
def test_channel_caches_agent_per_conversation(tmp_roan):
    ch = FakeChannel()
    a1 = ch.agent_for("111")
    a2 = ch.agent_for("111")
    a3 = ch.agent_for("222")
    assert a1 is a2
    assert a1 is not a3
