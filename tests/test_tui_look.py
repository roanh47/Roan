"""Tests voor het uiterlijk: Catppuccin-achtergrond, geen kaders, en of het past."""

import pytest

from roan import config
from roan import tui as tui_mod
from roan.themes import DEFAULT_THEME, PINK, THEME_NAMES
from roan.tui import ModelsScreen, ProviderScreen, RoanApp, SetupScreen


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
    config.save_config({"provider": "lmstudio", "model": "m", "tui": "default"})
    from roan import i18n

    i18n.set_language("nl")
    monkeypatch.setattr(tui_mod, "list_providers", lambda cat="all": [("groq", "Groq")])
    monkeypatch.setattr(tui_mod, "provider_meta", lambda pid: {"plan": False, "name": pid})
    monkeypatch.setattr(tui_mod, "provider_desc", lambda pid: "")
    return tmp_path


# ---------- thema ----------
@pytest.mark.asyncio
async def test_screen_background_is_opaque_catppuccin(roan_cfg):
    """Niet zwart: het mocha-vlak moet dekkend zijn, anders ziet het er zwart uit."""
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(60, 24)) as pilot:
        await pilot.pause()
        bg = app.screen.styles.background
        assert app.theme == DEFAULT_THEME
        assert bg.a == 1.0, f"achtergrond is niet dekkend (alpha={bg.a})"
        assert (bg.r, bg.g, bg.b) == (24, 24, 37)  # #181825 (Catppuccin mocha)


def test_four_catppuccin_flavours():
    assert THEME_NAMES == ("latte", "frappe", "macchiato", "mocha")
    assert [t.name for t in tui_mod.THEMES] == list(THEME_NAMES)


def test_accent_is_the_catppuccin_pink():
    """Altijd pink als accent, nooit groen of blauw."""
    for theme in tui_mod.THEMES:
        assert theme.primary == PINK[theme.name], theme.name
        assert theme.accent == PINK[theme.name], theme.name


def test_pinks_match_the_official_palette():
    # https://catppuccin.com/palette
    assert PINK["latte"] == "#EA76CB"
    assert PINK["frappe"] == "#F4B8E4"
    assert PINK["macchiato"] == "#F5BDE6"
    assert PINK["mocha"] == "#F5C2E7"


@pytest.mark.parametrize(
    "flavour,bg,surface",
    [
        ("latte", "#EFF1F5", "#E6E9EF"),
        ("frappe", "#303446", "#414559"),
        ("macchiato", "#24273A", "#363A4F"),
        ("mocha", "#181825", "#313244"),
    ],
)
def test_palettes_are_catppuccin(flavour, bg, surface):
    theme = tui_mod.THEME_BY_NAME[flavour]
    assert theme.background == bg
    assert theme.surface == surface


# ---------- geen lijntjes ----------
@pytest.mark.asyncio
async def test_no_borders_on_widgets(roan_cfg):
    from textual.widgets import Button, Input, OptionList, Select

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(60, 24)) as pilot:
        await pilot.pause()
        scr = SetupScreen(provider="groq", model="m")
        app.push_screen(scr)
        await pilot.pause()
        for sel in ("#api_key", "#base_url"):
            assert scr.query_one(sel, Input).styles.border.top[0] == "", sel
        for b in ("#save", "#cancel", "#close"):
            assert scr.query_one(b, Button).styles.border.top[0] == "", b

        prov = ProviderScreen()
        app.push_screen(prov)
        await pilot.pause()
        assert prov.query_one("#provider-list", OptionList).styles.border.top[0] == ""
        assert prov.query_one("#pcat", Select).styles.border.top[0] == ""


@pytest.mark.asyncio
async def test_modal_box_has_exactly_one_round_border(roan_cfg):
    """Eén kader per popup — anders zie je niet waar de popup begint."""
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(60, 24)) as pilot:
        await pilot.pause()
        for screen, box in (
            (SetupScreen(provider="groq", model="m"), "#setup-box"),
            (ProviderScreen(), "#provider-box"),
            (ModelsScreen([("groq", "m")], [], []), "#models-box"),
        ):
            app.push_screen(screen)
            await pilot.pause()
            border = screen.query_one(box).styles.border
            assert border.top[0] == "round", box
            # Catppuccin-lavender uit het thema, niet het standaardgrijs van Textual
            expected = tui_mod.THEME_BY_NAME[app.theme].variables["border"]
            assert border.top[1].hex.lower() == expected.lower(), box
            app.pop_screen()
            await pilot.pause()


# ---------- api key instelbaar ----------
@pytest.mark.asyncio
async def test_setup_focuses_the_api_key_field(roan_cfg):
    """Zonder focus op het key-veld kun je niet typen — dat was de klacht."""
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(60, 24)) as pilot:
        app.push_screen(SetupScreen(provider="groq", model="m"))
        await pilot.pause()
        assert app.focused is not None
        assert app.focused.id == "api_key"


@pytest.mark.asyncio
async def test_typing_and_enter_stores_the_key(roan_cfg):
    app = RoanApp(FakeAgent())
    results = []
    async with app.run_test(size=(60, 24)) as pilot:
        app.push_screen(SetupScreen(provider="groq", model="m"), results.append)
        await pilot.pause()
        await pilot.press(*"sk-mijn-key")
        await pilot.press("enter")
        await pilot.pause()
    assert results == [True]
    assert config.load_config()["api_key"] == "sk-mijn-key"


# ---------- het past op een telefoon ----------
@pytest.mark.asyncio
@pytest.mark.parametrize("size", [(60, 24), (50, 20), (46, 18)])
async def test_setup_fits_on_a_phone(roan_cfg, size):
    """Alles, inclusief Opslaan, moet binnen het scherm vallen."""
    app = RoanApp(FakeAgent())
    async with app.run_test(size=size) as pilot:
        await pilot.pause()
        scr = SetupScreen(provider="groq", model="m")
        app.push_screen(scr)
        await pilot.pause()
        height = size[1]
        for wid in ("#api_key", "#base_url", "#save", "#cancel"):
            region = scr.query_one(wid).region
            assert region.y + region.height <= height, f"{wid} valt buiten {size}"
            assert region.y >= 0, f"{wid} valt boven het scherm"


@pytest.mark.asyncio
async def test_provider_list_is_focused(roan_cfg):
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(60, 24)) as pilot:
        app.push_screen(ProviderScreen())
        await pilot.pause()
        assert app.focused is not None
        assert app.focused.id == "provider-list"
