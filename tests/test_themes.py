"""Tests voor de thema's: vier Catppuccin-smaken, altijd pink als accent."""

import pytest

from roan import config
from roan import tui as tui_mod
from textual.color import Color

from roan.themes import LAVENDER, PINK, THEME_NAMES
from roan.tui import RoanApp, ThemeScreen


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
    if config.CONFIG_PATH.exists():
        config.CONFIG_PATH.unlink()
    config.save_config({"provider": "lmstudio", "model": "m", "tui": "default"})
    from roan import i18n

    i18n.set_language("nl")
    monkeypatch.setattr(tui_mod, "list_providers", lambda cat="all": [("groq", "Groq")])
    monkeypatch.setattr(tui_mod, "provider_meta", lambda pid: {"plan": False, "name": pid})
    monkeypatch.setattr(tui_mod, "provider_desc", lambda pid: "")
    return tmp_path


def to_color(value):
    return value if isinstance(value, Color) else Color.parse(value)


def rgb(color):
    color = to_color(color)
    return (color.r, color.g, color.b)


# ---------- de vier smaken ----------
def test_theme_names():
    assert THEME_NAMES == ("latte", "frappe", "macchiato", "mocha")
    assert [t.name for t in tui_mod.THEMES] == list(THEME_NAMES)


@pytest.mark.parametrize("flavour", THEME_NAMES)
def test_every_theme_is_registered_and_activatable(roan_cfg, flavour):
    config.save_config({"theme": flavour})
    app = RoanApp(FakeAgent())
    assert app.theme == flavour


def test_invalid_theme_falls_back_to_mocha(roan_cfg):
    config.save_config({"theme": "paars"})
    app = RoanApp(FakeAgent())
    assert app.theme == "mocha"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "flavour,screen_bg",
    [
        ("latte", (239, 241, 245)),  # #EFF1F5
        ("frappe", (48, 52, 70)),  # #303446
        ("macchiato", (36, 39, 58)),  # #24273A
        ("mocha", (24, 24, 37)),  # #181825
    ],
)
async def test_background_is_catppuccin_and_opaque(roan_cfg, flavour, screen_bg):
    config.save_config({"theme": flavour})
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(60, 24)) as pilot:
        await pilot.pause()
        bg = app.screen.styles.background
        assert bg.a == 1.0, "achtergrond moet dekkend zijn, anders lijkt hij zwart"
        assert rgb(bg) == screen_bg, flavour


@pytest.mark.parametrize("flavour", THEME_NAMES)
def test_accent_is_the_flavour_pink(flavour):
    theme = tui_mod.THEME_BY_NAME[flavour]
    assert theme.primary == PINK[flavour]
    assert theme.accent == PINK[flavour]


@pytest.mark.parametrize("flavour", THEME_NAMES)
def test_border_is_the_flavour_lavender(flavour):
    assert tui_mod.THEME_BY_NAME[flavour].variables["border"] == LAVENDER[flavour]


# ---------- thema kiezen ----------
@pytest.mark.asyncio
async def test_theme_screen_lists_the_four_flavours(roan_cfg):
    from textual.widgets import OptionList

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(60, 24)) as pilot:
        screen = ThemeScreen()
        app.push_screen(screen)
        await pilot.pause()
        listing = screen.query_one("#theme-list", OptionList)
        assert listing.option_count == 4
        labels = [str(listing.get_option_at_index(i).prompt) for i in range(4)]
        for name in THEME_NAMES:
            assert any(name in lb for lb in labels)


@pytest.mark.asyncio
async def test_theme_screen_marks_the_active_one(roan_cfg):
    from textual.widgets import OptionList

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(60, 24)) as pilot:
        screen = ThemeScreen()
        app.push_screen(screen)
        await pilot.pause()
        listing = screen.query_one("#theme-list", OptionList)
        labels = [str(listing.get_option_at_index(i).prompt) for i in range(4)]
        assert labels[3].startswith("●")  # mocha is actief
        assert not labels[0].startswith("●")


@pytest.mark.asyncio
async def test_theme_screen_picks(roan_cfg):
    app = RoanApp(FakeAgent())
    results = []
    async with app.run_test(size=(60, 24)) as pilot:
        screen = ThemeScreen()
        app.push_screen(screen, results.append)
        await pilot.pause()
        listing = screen.query_one("#theme-list")
        listing.focus()
        listing.highlighted = 1  # frappe
        await pilot.pause()
        await pilot.press("enter")
        await pilot.pause()
    assert results == ["frappe"]


@pytest.mark.asyncio
async def test_cmd_theme_switches_and_saves(roan_cfg):
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(60, 24)) as pilot:
        await pilot.pause()
        app._cmd_theme(["latte"])
        await pilot.pause()
        assert app.theme == "latte"
        assert config.load_config()["theme"] == "latte"


@pytest.mark.asyncio
async def test_cmd_theme_rejects_unknown(roan_cfg):
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(60, 24)) as pilot:
        await pilot.pause()
        app._cmd_theme(["groen"])
        await pilot.pause()
        assert app.theme == "mocha"
        assert config.load_config().get("theme") in (None, "mocha")


@pytest.mark.asyncio
async def test_cmd_theme_without_args_opens_picker(roan_cfg):
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(60, 24)) as pilot:
        await pilot.pause()
        app._cmd_theme([])
        await pilot.pause()
        assert isinstance(app.screen, ThemeScreen)


@pytest.mark.asyncio
async def test_theme_persists_over_restart(roan_cfg):
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(60, 24)) as pilot:
        await pilot.pause()
        app._cmd_theme(["macchiato"])
        await pilot.pause()
    app2 = RoanApp(FakeAgent())
    assert app2.theme == "macchiato"


@pytest.mark.asyncio
async def test_popus_use_surface_over_base(roan_cfg):
    """Popup één trede lichter dan het scherm, anders zie je hem niet."""
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(60, 24)) as pilot:
        await pilot.pause()
        scr = tui_mod.SetupScreen(provider="groq", model="m")
        app.push_screen(scr)
        await pilot.pause()
        screen_bg = rgb(to_color(tui_mod.THEME_BY_NAME[app.theme].background))
        popup_bg = rgb(scr.query_one("#setup-box").styles.background)
        assert popup_bg != screen_bg, "popup valt weg tegen de achtergrond"
        field_bg = rgb(scr.query_one("#base_url").styles.background)
        assert field_bg != popup_bg, "veld valt weg tegen het popupvlak"
