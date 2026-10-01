"""Tests voor de thema's: losse thema's zoals opencode, geen Catppuccin-familie."""

import pytest

from roan import config
from roan import tui as tui_mod
from textual.color import Color

from roan.themes import ACCENTS, DEFAULT_THEME, LABELS, ROAN, THEME_NAMES
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


# ---------- de lijst thema's ----------
def test_catppuccin_is_gone():
    """De vier Catppuccin-smaken zijn eruit; dat was één familie, geen keuzemenu."""
    assert not [n for n in THEME_NAMES if "catppuccin" in n or n in ("latte", "frappe", "macchiato", "mocha")]
    assert [t.name for t in tui_mod.THEMES] == list(THEME_NAMES)


def test_theme_list_matches_the_families_opencode_offers():
    for expected in ("tokyo-night", "gruvbox", "nord", "dracula", "monokai"):
        assert expected in THEME_NAMES, expected
    assert "ansi-dark" in THEME_NAMES and "ansi-light" in THEME_NAMES


def test_default_is_our_own_theme():
    assert DEFAULT_THEME == "roan"
    assert THEME_NAMES[0] == "roan"


def test_every_theme_has_a_label():
    for name in THEME_NAMES:
        assert LABELS.get(name), name


@pytest.mark.parametrize("name", THEME_NAMES)
def test_every_theme_is_registered_and_activatable(roan_cfg, name):
    config.save_config({"theme": name})
    app = RoanApp(FakeAgent())
    assert app.theme == name


def test_invalid_theme_falls_back_to_the_default(roan_cfg):
    config.save_config({"theme": "paars"})
    app = RoanApp(FakeAgent())
    assert app.theme == DEFAULT_THEME


# ---------- ons eigen thema ----------
def test_roan_theme_is_grey_with_a_loud_pink_accent():
    assert ROAN["background"] == "#14161c"
    assert ROAN["accent"] == "#ff2e88"
    theme = tui_mod.THEME_BY_NAME["roan"]
    assert theme.primary == "#ff2e88"
    assert theme.accent == "#ff2e88"


def test_roan_accent_is_a_real_pink_not_a_purple():
    r, g, b = rgb(ROAN["accent"])
    assert r > 200, "het rood hoort hoog te zijn voor fel roze"
    assert b > 100 and g < 100, "groen laag en blauw hoog maakt het roze"


@pytest.mark.asyncio
async def test_background_is_opaque_and_grey(roan_cfg):
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(60, 24)) as pilot:
        await pilot.pause()
        bg = app.screen.styles.background
        assert bg.a == 1.0, "achtergrond moet dekkend zijn, anders lijkt hij zwart"
        assert rgb(bg) == rgb(ROAN["background"])


# ---------- accent per thema ----------
@pytest.mark.parametrize("name", THEME_NAMES)
def test_accent_and_primary_agree(name):
    theme = tui_mod.THEME_BY_NAME[name]
    assert theme.primary == ACCENTS[name]
    assert theme.accent == theme.primary


@pytest.mark.parametrize("name", THEME_NAMES)
def test_every_theme_defines_the_variables_our_css_needs(name):
    """Zonder deze variabelen valt de CSS terug op Textual's blauw/groen."""
    variables = tui_mod.THEME_BY_NAME[name].variables
    for key in (
        "border",
        "text-muted",
        "block-cursor-background",
        "block-cursor-foreground",
        "input-selection-background",
        "input-cursor-background",
        "scrollbar",
        "scrollbar-hover",
        "scrollbar-active",
    ):
        assert variables.get(key), f"{name} mist {key}"


@pytest.mark.parametrize("name", THEME_NAMES)
def test_selection_uses_the_theme_accent(name):
    variables = tui_mod.THEME_BY_NAME[name].variables
    assert variables["block-cursor-background"] == ACCENTS[name]


# ---------- thema kiezen ----------
@pytest.mark.asyncio
async def test_theme_screen_lists_every_theme(roan_cfg):
    from textual.widgets import OptionList

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(60, 24)) as pilot:
        screen = ThemeScreen()
        app.push_screen(screen)
        await pilot.pause()
        listing = screen.query_one("#theme-list", OptionList)
        assert listing.option_count == len(THEME_NAMES)
        labels = [str(listing.get_option_at_index(i).prompt) for i in range(len(THEME_NAMES))]
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
        labels = [str(listing.get_option_at_index(i).prompt) for i in range(len(THEME_NAMES))]
        assert labels[0].startswith("●")  # roan is actief
        assert not labels[1].startswith("●")


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
        listing.highlighted = 1
        await pilot.pause()
        await pilot.press("enter")
        await pilot.pause()
    assert results == [THEME_NAMES[1]]


@pytest.mark.asyncio
async def test_cmd_theme_switches_and_saves(roan_cfg):
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(60, 24)) as pilot:
        await pilot.pause()
        app._cmd_theme(["dracula"])
        await pilot.pause()
        assert app.theme == "dracula"
        assert config.load_config()["theme"] == "dracula"


@pytest.mark.asyncio
async def test_cmd_theme_rejects_unknown(roan_cfg):
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(60, 24)) as pilot:
        await pilot.pause()
        app._cmd_theme(["groen"])
        await pilot.pause()
        assert app.theme == DEFAULT_THEME
        assert config.load_config().get("theme") in (None, DEFAULT_THEME)


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
        app._cmd_theme(["nord"])
        await pilot.pause()
    app2 = RoanApp(FakeAgent())
    assert app2.theme == "nord"


@pytest.mark.asyncio
async def test_popups_use_surface_over_base(roan_cfg):
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
