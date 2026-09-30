"""Tests voor de CLI-dispatch en de plain-text chat-modus."""

import os
import sys

import pytest

from roan import cli, config
from roan import repl as repl_mod


@pytest.fixture
def tmp_roan(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "ROAN_DIR", tmp_path)
    monkeypatch.setattr(config, "CONFIG_PATH", tmp_path / "config.json")
    monkeypatch.setattr(config, "MEMORY_PATH", tmp_path / "memory.md")
    monkeypatch.setattr(config, "INSTRUCTIONS_PATH", tmp_path / "instructions.md")
    return tmp_path


def test_help(capsys, monkeypatch):
    monkeypatch.setattr(sys, "argv", ["roan", "help"])
    cli.main()
    out = capsys.readouterr().out
    assert "agent harness" in out
    assert "telegram" in out


def test_version(capsys, monkeypatch):
    monkeypatch.setattr(sys, "argv", ["roan", "version"])
    cli.main()
    assert "Roan" in capsys.readouterr().out


def test_chat_dispatch(monkeypatch):
    called = {}
    monkeypatch.setattr(repl_mod, "run_repl", lambda **kw: called.setdefault("ok", True))
    monkeypatch.setattr(sys, "argv", ["roan", "chat"])
    cli.main()
    assert called.get("ok")


# ---------- repl ----------
class FakeAgent:
    session_id = "s"

    def __init__(self, **kwargs):
        self.stopped = False

    def reload(self):
        pass

    def send_stream(self, text):
        yield f"antwoord op {text}"

    def stop(self):
        self.stopped = True


def test_repl_streams_and_stops(tmp_roan, monkeypatch, capsys):
    config.save_config({"provider": "lmstudio", "model": "m"})
    monkeypatch.setattr(repl_mod, "Agent", FakeAgent)
    lines = iter(["hoi", "/quit"])
    monkeypatch.setattr("builtins.input", lambda *a: next(lines))

    repl_mod.run_repl()
    out = capsys.readouterr().out
    assert "antwoord op hoi" in out


def test_repl_help_command(tmp_roan, monkeypatch, capsys):
    config.save_config({"provider": "lmstudio", "model": "m"})
    monkeypatch.setattr(repl_mod, "Agent", FakeAgent)
    lines = iter(["/help", "/quit"])
    monkeypatch.setattr("builtins.input", lambda *a: next(lines))

    repl_mod.run_repl()
    out = capsys.readouterr().out
    assert "Roan — agent harness" in out


def test_repl_onboarding_without_config(tmp_roan, monkeypatch, capsys):
    monkeypatch.delenv("ROAN_API_KEY", raising=False)
    repl_mod.run_repl()
    out = capsys.readouterr().out
    assert "Roan init" in out


def test_truecolor_is_forced_before_textual_loads(monkeypatch):
    """Regression: zonder dit vielen de Catppuccin-kleuren terug op 256 kleuren.

    Termius zet geen COLORTERM, waardoor Textual #181825 naar #000000 en
    #313244 naar #5F5F5F kwantiseerde. _force_truecolor draait vóór de eerste
    `import textual`, dus dit moet in cli.py bij het begin van main().
    """
    from roan.cli import _force_truecolor

    monkeypatch.delenv("COLORTERM", raising=False)
    monkeypatch.delenv("TEXTUAL_COLOR_SYSTEM", raising=False)
    _force_truecolor()
    assert os.environ["COLORTERM"] == "truecolor"
    assert os.environ["TEXTUAL_COLOR_SYSTEM"] == "truecolor"

    # Een expliciete keuze van de gebruiker mag niet overschreven worden.
    monkeypatch.setenv("TEXTUAL_COLOR_SYSTEM", "256")
    _force_truecolor()
    assert os.environ["TEXTUAL_COLOR_SYSTEM"] == "256"
