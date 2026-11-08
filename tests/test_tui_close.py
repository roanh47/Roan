"""Tests voor sluiten: Ctrl+C, Ctrl+Q en de ✕ rechtsboven in app en popups."""

import pytest

from roan import config
from roan import tui as tui_mod
from roan.tui import (
    ModelsScreen,
    ProviderScreen,
    RoanApp,
    SetupScreen,
    TranscriptScreen,
    ThemeScreen,
)


class FakeAgent:
    model = "fake"
    session_id = "test-session"
    messages = []

    def reload(self):
        pass

    def clear(self):
        pass

    def save(self):
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
    config.save_config({"provider": "lmstudio", "model": "m", "tui": "default"})
    from roan import i18n

    i18n.set_language("nl")
    monkeypatch.setattr(tui_mod, "list_providers", lambda cat="all": [("groq", "Groq")])
    monkeypatch.setattr(tui_mod, "provider_meta", lambda pid: {"plan": False, "name": pid})
    monkeypatch.setattr(tui_mod, "provider_desc", lambda pid: "")
    return tmp_path


# ---------- Ctrl+C ----------
@pytest.mark.asyncio
async def test_ctrl_c_quits(roan_cfg):
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        await pilot.pause()
        await pilot.press("ctrl+c")
        await pilot.pause()
        assert getattr(app, "_exit", False) is True or not app.is_running


@pytest.mark.asyncio
async def test_ctrl_q_quits(roan_cfg):
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        await pilot.pause()
        await pilot.press("ctrl+q")
        await pilot.pause()
        assert getattr(app, "_exit", False) is True or not app.is_running


@pytest.mark.asyncio
async def test_ctrl_c_quits_from_modal(roan_cfg):
    """Ook vanuit een popup moet Ctrl+C de app sluiten."""
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        await pilot.pause()
        app.push_screen(SetupScreen(provider="groq", model="m"))
        await pilot.pause()
        await pilot.press("ctrl+c")
        await pilot.pause()
        assert getattr(app, "_exit", False) is True or not app.is_running


# ---------- ✕ in de app ----------
@pytest.mark.asyncio
async def test_app_has_no_close_button(roan_cfg):
    """Het kruisje rechtsboven is weg: daar staat nu de avatar.

    Sluiten kan nog via ctrl+c en ctrl+q, wat hierboven getest staat.
    """
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        await pilot.pause()
        assert not app.query("#app-close")
        rendered = "".join(
            seg.text for seg in app.screen._compositor.render_strips()[0]
        )
        assert tui_mod.CLOSE_GLYPH not in rendered


# ---------- ✕ in de popups ----------
@pytest.mark.asyncio
async def test_setup_close_button(roan_cfg):
    app = RoanApp(FakeAgent())
    results = []
    async with app.run_test() as pilot:
        app.push_screen(SetupScreen(provider="groq", model="m"), results.append)
        await pilot.pause()
        await pilot.click("#close")
        await pilot.pause()
    assert results == [False]


@pytest.mark.asyncio
async def test_provider_close_button(roan_cfg):
    app = RoanApp(FakeAgent())
    results = []
    async with app.run_test() as pilot:
        app.push_screen(ProviderScreen(), results.append)
        await pilot.pause()
        await pilot.click("#close")
        await pilot.pause()
    assert results == [None]


@pytest.mark.asyncio
async def test_models_close_button(roan_cfg):
    app = RoanApp(FakeAgent())
    results = []
    async with app.run_test() as pilot:
        app.push_screen(ModelsScreen([("groq", "llama-3")], [], []), results.append)
        await pilot.pause()
        await pilot.click("#close")
        await pilot.pause()
    assert results == [None]


@pytest.mark.asyncio
async def test_theme_picker_close_button(roan_cfg):
    app = RoanApp(FakeAgent())
    results = []
    async with app.run_test() as pilot:
        app.push_screen(ThemeScreen(), results.append)
        await pilot.pause()
        await pilot.click("#close")
        await pilot.pause()
    assert results == [None]


@pytest.mark.asyncio
async def test_transcript_close_button(roan_cfg):
    app = RoanApp(FakeAgent())
    results = []
    async with app.run_test() as pilot:
        app.push_screen(TranscriptScreen([{"role": "user", "content": "hoi"}]), results.append)
        await pilot.pause()
        await pilot.click("#close")
        await pilot.pause()
    assert results == [None]


# ---------- elke popup heeft er een ----------
@pytest.mark.asyncio
@pytest.mark.parametrize(
    "factory",
    [
        lambda: SetupScreen(provider="groq", model="m"),
        lambda: ProviderScreen(),
        lambda: ModelsScreen([("groq", "m")], [], []),
        ThemeScreen,
        lambda: TranscriptScreen([]),
    ],
)
async def test_every_modal_has_a_close_button(roan_cfg, factory):
    from textual.widgets import Button

    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        screen = factory()
        app.push_screen(screen)
        await pilot.pause()
        button = screen.query_one("#close", Button)
        assert str(button.label) == tui_mod.CLOSE_GLYPH
        # en hij staat rechts: verder naar rechts dan de titel
        from textual.widgets import Static

        title = screen.query_one(".title", Static)
        assert button.region.x > title.region.x
