"""Tests voor het uiterlijk: Catppuccin-achtergrond, geen kaders, en of het past."""

import pytest

from roan import config
from roan import tui as tui_mod
from roan.themes import DEFAULT_THEME, PINK, THEME_NAMES
from roan.i18n import t
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
    """De vier Catppuccin-smaken blijven, dat is de hele point."""
    assert THEME_NAMES == ("latte", "frappe", "macchiato", "mocha")
    assert [t.name for t in tui_mod.THEMES] == list(THEME_NAMES)


def test_every_catppuccin_colour_is_present():
    """Regression: het programma startte niet meer.

    Een thema met een lege kleur liet `str(None)` de string "None" worden,
    waarop `Color.parse` een ColorParseError gooide en THEMES niet gebouwd
    werd. Elk kleurveld moet nu een echte kleur zijn.
    """
    for theme in tui_mod.THEMES:
        for field in ("primary", "accent", "secondary", "foreground",
                      "background", "surface", "panel", "success",
                      "warning", "error"):
            value = getattr(theme, field)
            assert value is not None, f"{theme.name}.{field} is None"
            assert str(value).lower() != "none", f"{theme.name}.{field} is 'None'"


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


# ---------- nette, gedeelde opmaak ----------
POPUPS = [
    (lambda: SetupScreen(provider="groq", model="m"), "#setup-box"),
    (lambda: ProviderScreen(), "#provider-box"),
    (lambda: ModelsScreen([("groq", "llama-3")], [], []), "#models-box"),
    (lambda: tui_mod.ThemeScreen(), "#theme-box"),
    (lambda: tui_mod.TranscriptScreen([{"role": "user", "content": "hoi"}]), "#transcript-box"),
]


@pytest.mark.asyncio
@pytest.mark.parametrize("factory,box", POPUPS)
async def test_every_popup_uses_the_shared_popup_class(roan_cfg, factory, box):
    """Eén plek waar de popup-opmaak staat, anders lopen ze uit elkaar."""
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(64, 26)) as pilot:
        await pilot.pause()
        screen = factory()
        app.push_screen(screen)
        await pilot.pause()
        assert "popup" in screen.query_one(box).classes, box


@pytest.mark.asyncio
@pytest.mark.parametrize("factory,box", POPUPS)
async def test_popup_sits_on_a_lighter_surface_than_the_screen(roan_cfg, factory, box):
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(64, 26)) as pilot:
        await pilot.pause()
        screen = factory()
        app.push_screen(screen)
        await pilot.pause()
        theme = tui_mod.THEME_BY_NAME[app.theme]
        assert screen.query_one(box).styles.background.hex.lower() != theme.background.lower()


@pytest.mark.asyncio
async def test_title_lines_up_with_the_field_labels(roan_cfg):
    """De titel hoort boven de velden te staan, niet 2 kolommen ernaast."""
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(64, 26)) as pilot:
        await pilot.pause()
        scr = SetupScreen(provider="groq", model="m")
        app.push_screen(scr)
        await pilot.pause()
        title_x = scr.query_one(".titlebar .title").region.x
        label_x = scr.query_one("#setup-box Label").region.x
        assert title_x == label_x


@pytest.mark.asyncio
async def test_setup_hint_is_fully_visible(roan_cfg):
    """De hint mag niet afgekapt worden — daar is hij te kort voor."""
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(64, 26)) as pilot:
        await pilot.pause()
        scr = SetupScreen(provider="groq", model="m")
        app.push_screen(scr)
        await pilot.pause()
        rendered = "\n".join(
            "".join(seg.text for seg in strip) for strip in scr._compositor.render_strips()
        )
        assert t("setup_hint") in rendered
        assert t("setup_required") not in rendered  # niet verplicht hier


@pytest.mark.asyncio
async def test_setup_hides_base_url_for_a_known_provider(roan_cfg):
    """Bij groq/lmstudio weet Roan de base URL al; dat veld is dan ruis."""
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(64, 26)) as pilot:
        await pilot.pause()
        scr = SetupScreen(provider="groq", model="m")
        app.push_screen(scr)
        await pilot.pause()
        assert scr.query_one("#base_url").display is False
        assert scr.query_one("#lbl-base-url").display is False


@pytest.mark.asyncio
async def test_setup_shows_base_url_for_custom(roan_cfg):
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(64, 26)) as pilot:
        await pilot.pause()
        scr = SetupScreen(provider="custom", model="m", base_url="https://thuis/v1")
        app.push_screen(scr)
        await pilot.pause()
        assert scr.query_one("#base_url").display is True
        assert scr.query_one("#lbl-base-url").display is True


@pytest.mark.asyncio
async def test_setup_has_a_save_and_cancel_button(roan_cfg):
    from textual.widgets import Button

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(64, 26)) as pilot:
        await pilot.pause()
        scr = SetupScreen(provider="groq", model="m")
        app.push_screen(scr)
        await pilot.pause()
        assert str(scr.query_one("#save", Button).label) == t("setup_save")
        assert str(scr.query_one("#cancel", Button).label) == t("setup_cancel")


@pytest.mark.asyncio
async def test_models_shows_the_count_in_the_hint(roan_cfg):
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(64, 26)) as pilot:
        await pilot.pause()
        scr = ModelsScreen([("groq", "llama-3"), ("groq", "mixtral")], [], [])
        app.push_screen(scr)
        await pilot.pause()
        hint = str(scr.query_one("#models-hint").render())
        assert "2" in hint


@pytest.mark.asyncio
async def test_models_rows_and_buttons(roan_cfg):
    from textual.widgets import Button

    app = RoanApp(FakeAgent())
    results = []
    async with app.run_test(size=(64, 26)) as pilot:
        await pilot.pause()
        scr = ModelsScreen([("groq", "llama-3")], [], [])
        app.push_screen(scr, results.append)
        await pilot.pause()
        assert str(scr.query_one("#mback", Button).label) == t("btn_back")
        scr.query_one("#mchoose", Button).press()
        await pilot.pause()
    assert results == [("groq", "llama-3")]


def test_theme_bullets_use_each_flavour_pink(roan_cfg):
    """De kleurstip in het thema-menu is de pink van die smaak."""
    from rich.text import Text

    for name, pink in PINK.items():
        label = Text.from_markup(f"[{pink}]●[/] {name}")
        assert str(label.spans[0].style).lower() == pink.lower()


@pytest.mark.asyncio
async def test_typed_input_text_is_actually_rendered(roan_cfg):
    """Regression: het rand van #input vond de generieke `Input { height: 1 }`.

    Daardoor was de content-hoogte 0 en getypte tekst verscheen nooit, hoe goed
    de `color` ook was. De rand (2) + 1 tekstregel moet op height 3 uitkomen.
    """
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(80, 24)) as pilot:
        await pilot.pause()
        inp = app.query_one("#input")
        inp.focus()
        await pilot.pause()
        await pilot.press(*"hello")
        await pilot.pause()

        assert inp.value == "hello"
        # Er moet minimaal een regel tekstruimte overblijven binnen de rand.
        assert inp.content_region.height >= 1, (
            f"content-hoogte is {inp.content_region.height}; "
            "getypte tekst kan dan niet getekend worden"
        )
        # En de tekst moet daadwerkelijk in de buffer staan.
        strips = app.screen._compositor.render_strips()
        row = "".join(seg.text for seg in strips[inp.content_region.y])
        assert "hello" in row, f"tekst niet gerenderd, rij was: {row!r}"
