"""Tests voor de verplichte setup: zonder configuratie kom je er niet langs."""

import pytest

from roan import config
from roan import tui as tui_mod
from roan.tui import RoanApp, SetupScreen


class FakeAgent:
    model = "m"
    session_id = "s"
    messages = []

    def reload(self):
        pass

    def clear(self):
        pass

    def send_stream(self, text, on_event=None):
        yield f"echo: {text}"


@pytest.fixture
def roan_cfg(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "ROAN_DIR", tmp_path)
    monkeypatch.setattr(config, "CONFIG_PATH", tmp_path / "config.json")
    monkeypatch.setattr(config, "MEMORY_PATH", tmp_path / "memory.md")
    monkeypatch.setattr(config, "USER_PATH", tmp_path / "user.md")
    monkeypatch.setattr(config, "INSTRUCTIONS_PATH", tmp_path / "instructions.md")
    monkeypatch.setattr(config, "SKILLS_DIR", tmp_path / "skills")
    monkeypatch.setattr(config, "CRON_DIR", tmp_path / "cron")
    monkeypatch.setattr(config, "PLUGINS_DIR", tmp_path / "plugins")
    monkeypatch.setattr(config, "LOGS_DIR", tmp_path / "logs")
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(config, "PLANS_DIR", tmp_path / "plans")
    monkeypatch.delenv("ROAN_API_KEY", raising=False)
    from roan import i18n

    i18n.set_language("nl")
    monkeypatch.setattr(tui_mod, "list_providers", lambda cat="all": [("groq", "Groq")])
    monkeypatch.setattr(tui_mod, "provider_meta", lambda pid: {"plan": False, "name": pid})
    monkeypatch.setattr(tui_mod, "provider_desc", lambda pid: "")
    return tmp_path


# ---------- is_configured ----------
def test_nothing_configured(roan_cfg):
    assert config.is_configured() is False


def test_only_a_theme_is_not_enough(roan_cfg):
    """Het config-bestand bestaat dan wel, maar je kunt nog niet chatten."""
    config.save_config({"theme": "latte"})
    assert config.has_config() is True
    assert config.is_configured() is False


def test_local_provider_with_model_is_configured(roan_cfg):
    config.save_config(
        {"provider": "lmstudio", "base_url": "http://localhost:1234/v1", "model": "qwen3"}
    )
    assert config.is_configured() is True


def test_hosted_provider_needs_a_key(roan_cfg, monkeypatch):
    monkeypatch.setattr(tui_mod, "resolve_base_url", lambda p: "https://api.groq.com/openai/v1")
    config.save_config(
        {"provider": "groq", "base_url": "https://api.groq.com/openai/v1", "model": "llama-3"}
    )
    assert config.is_configured() is False  # nog geen key
    config.save_config({"api_key": "sk-1"})
    assert config.is_configured() is True


def test_default_model_does_not_count(roan_cfg):
    config.save_config({"provider": "groq", "base_url": "https://x/v1", "model": "local-model"})
    assert config.is_configured() is False


def test_env_key_counts(roan_cfg, monkeypatch):
    config.save_config({"provider": "groq", "base_url": "https://x/v1", "model": "llama-3"})
    monkeypatch.setenv("ROAN_API_KEY", "sk-env")
    assert config.is_configured() is True


# ---------- het scherm zelf ----------
@pytest.mark.asyncio
async def test_required_setup_has_no_close_button(roan_cfg):
    from textual.widgets import Button

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(60, 24)) as pilot:
        app.push_screen(SetupScreen(provider="groq", model="m", required=True))
        await pilot.pause()
        assert len(app.screen.query("#close")) == 0
        assert len(app.screen.query("#cancel")) == 0
        assert len(app.screen.query("#required-hint")) == 1
        assert len(app.screen.query("#save")) == 1


@pytest.mark.asyncio
async def test_optional_setup_has_close_and_cancel(roan_cfg):
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(60, 24)) as pilot:
        app.push_screen(SetupScreen(provider="groq", model="m"))
        await pilot.pause()
        assert len(app.screen.query("#close")) == 1
        assert len(app.screen.query("#cancel")) == 1
        assert len(app.screen.query("#required-hint")) == 0


@pytest.mark.asyncio
async def test_escape_does_not_dismiss_required_setup(roan_cfg):
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(60, 24)) as pilot:
        app.push_screen(SetupScreen(provider="groq", model="m", required=True))
        await pilot.pause()
        await pilot.press("escape")
        await pilot.pause()
        assert isinstance(app.screen, SetupScreen)
        assert app.screen.required is True


@pytest.mark.asyncio
async def test_escape_dismisses_optional_setup(roan_cfg):
    app = RoanApp(FakeAgent())
    results = []
    async with app.run_test(size=(60, 24)) as pilot:
        app.push_screen(SetupScreen(provider="groq", model="m"), results.append)
        await pilot.pause()
        await pilot.press("escape")
        await pilot.pause()
    assert results == [False]


# ---------- de app ----------
@pytest.mark.asyncio
async def test_app_forces_setup_when_nothing_configured(roan_cfg):
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(60, 24)) as pilot:
        await pilot.pause()
        assert isinstance(app.screen, SetupScreen)
        assert app.screen.required is True


@pytest.mark.asyncio
async def test_app_does_not_force_setup_when_configured(roan_cfg):
    config.save_config({"base_url": "http://localhost:1234/v1", "model": "qwen3", "tui": "default"})
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(60, 24)) as pilot:
        await pilot.pause()
        assert not isinstance(app.screen, SetupScreen)


@pytest.mark.asyncio
async def test_app_opens_optional_setup_with_f2(roan_cfg):
    config.save_config({"base_url": "http://localhost:1234/v1", "model": "qwen3", "tui": "default"})
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(60, 24)) as pilot:
        await pilot.pause()
        await pilot.press("f2")
        await pilot.pause()
        assert isinstance(app.screen, SetupScreen)
        assert app.screen.required is False


@pytest.mark.asyncio
async def test_saving_the_required_setup_gets_you_in(roan_cfg):
    """Na opslaan is het scherm weg en kun je verder."""
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(60, 24)) as pilot:
        await pilot.pause()
        assert isinstance(app.screen, SetupScreen)
        screen = app.screen
        screen.provider = "lmstudio"
        screen.model = "qwen3"
        screen.query_one("#base_url").value = "http://localhost:1234/v1"
        screen._save()
        await pilot.pause()
        assert not isinstance(app.screen, SetupScreen)
        assert config.is_configured() is True
