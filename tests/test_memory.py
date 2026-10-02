"""Tests voor het geheugen: het bestand, en /memory als scherm (issue #21).

Vóór dit issue zette `_cmd_memory` de hele `memory.md` als markdown in de chat,
zonder manier om er iets aan toe te voegen of er iets uit te halen. Deze tests
leggen het gedrag vast: `entries()` en `forget()` op schijf, en de drie dingen
die het scherm moet kunnen — zien, toevoegen, verwijderen.
"""

import pytest
from textual.widgets import Button, Input, OptionList, Static

from roan import config, i18n
from roan.i18n import t
from roan.memory import entries, forget, load_memory, remember
from roan.tui import MemoryScreen, POPUP_CSS, RoanApp

MEMORY_KEYS = (
    "memory_title",
    "memory_empty",
    "memory_new",
    "memory_add",
    "memory_remove",
    "memory_count",
    "memory_added",
    "memory_removed",
    "memory_hint",
)


class FakeAgent:
    model = "fake"
    session_id = "memory-test"
    messages = []

    def reload(self):
        pass

    def clear(self):
        self.messages = []

    def send_stream(self, text, on_event=None):
        yield f"echo: {text}"


@pytest.fixture
def tmp_roan(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "ROAN_DIR", tmp_path)
    monkeypatch.setattr(config, "CONFIG_PATH", tmp_path / "config.json")
    monkeypatch.setattr(config, "MEMORY_PATH", tmp_path / "memory.md")
    monkeypatch.setattr(config, "USER_PATH", tmp_path / "user.md")
    monkeypatch.setattr(config, "INSTRUCTIONS_PATH", tmp_path / "instructions.md")
    config.save_config({"provider": "lmstudio", "model": "test-model", "tui": "default"})
    i18n.set_language("nl")
    return tmp_path


def render(screen) -> str:
    """Wat er echt op het scherm staat."""
    return "\n".join(
        "".join(seg.text for seg in strip) for strip in screen._compositor.render_strips()
    )


def open_screen(app, pilot, screen=None):
    screen = screen or MemoryScreen()
    app.push_screen(screen)
    return screen


# ---------- het bestand ----------
def test_entries_is_one_note_per_line(tmp_roan):
    remember("Houdt van lokale modellen")
    remember("Woont in Utrecht")
    assert entries() == ["Houdt van lokale modellen", "Woont in Utrecht"]


def test_entries_of_an_empty_memory_is_empty(tmp_roan):
    assert entries() == []
    assert load_memory() == ""


def test_entries_skips_comments_and_blank_lines(tmp_roan):
    # `read_profile` gooit commentaar weg; dat is geen notitie.
    config.MEMORY_PATH.write_text("# een kop\n\nHoudt van koffie\n", encoding="utf-8")
    assert entries() == ["Houdt van koffie"]


def test_forget_removes_the_note_from_disk(tmp_roan):
    remember("Houdt van lokale modellen")
    remember("Woont in Utrecht")
    assert forget("Woont in Utrecht") is True
    # Opnieuw van schijf lezen, niet uit een lijstje in het geheugen.
    assert load_memory() == "Houdt van lokale modellen"
    assert config.MEMORY_PATH.read_text() == "Houdt van lokale modellen\n"
    assert entries() == ["Houdt van lokale modellen"]


def test_forget_removes_only_the_first_of_two_equal_notes(tmp_roan):
    remember("Blij")
    remember("Blij")
    assert forget("Blij") is True
    assert entries() == ["Blij"]


def test_forget_of_an_unknown_note_changes_nothing(tmp_roan):
    remember("Houdt van koffie")
    before = config.MEMORY_PATH.read_text()
    assert forget("Staat er niet in") is False
    assert config.MEMORY_PATH.read_text() == before


def test_forget_without_a_file_is_false(tmp_roan):
    assert forget("iets") is False


def test_forget_of_the_last_note_leaves_an_empty_file(tmp_roan):
    remember("Enige notitie")
    assert forget("Enige notitie") is True
    assert config.MEMORY_PATH.read_text() == ""
    assert load_memory() == ""


# ---------- het scherm ----------
@pytest.mark.asyncio
async def test_screen_shows_every_entry_one_per_line(tmp_roan):
    """Elke notitie staat in het scherm, niet in de chat."""
    for note in ("Houdt van lokale modellen", "Woont in Utrecht", "Bouwt liever klein dan snel"):
        remember(note)
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(80, 24)) as pilot:
        await pilot.pause()
        screen = open_screen(app, pilot)
        await pilot.pause()
        listing = screen.query_one("#memory-list", OptionList)
        assert listing.option_count == 3
        out = render(screen)
        for note in entries():
            assert note in out, note
        # Eén per regel: de drie staan op drie verschillende regels.
        rows = {note: next(i for i, ln in enumerate(out.splitlines()) if note in ln)
                for note in entries()}
        assert len(set(rows.values())) == 3, rows


@pytest.mark.asyncio
async def test_typing_and_the_button_write_the_note_to_disk(tmp_roan):
    remember("Houdt van lokale modellen")
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(80, 24)) as pilot:
        await pilot.pause()
        screen = open_screen(app, pilot)
        await pilot.pause()
        box = screen.query_one("#memory-input", Input)
        box.focus()
        await pilot.press(*"Drinkt geen koffie")
        await pilot.pause()
        screen.query_one("#memory-add", Button).press()
        await pilot.pause()
        # Het scherm zelf...
        assert screen.query_one("#memory-list", OptionList).option_count == 2
        assert "Drinkt geen koffie" in render(screen)
        # ...en echt het bestand, met een verse load.
        assert load_memory() == "Houdt van lokale modellen\nDrinkt geen koffie"
        assert config.MEMORY_PATH.read_text().endswith("Drinkt geen koffie\n")
        assert box.value == "", "het veld moet leeg zijn na toevoegen"


@pytest.mark.asyncio
async def test_enter_in_the_input_adds_a_note(tmp_roan):
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(80, 24)) as pilot:
        await pilot.pause()
        screen = open_screen(app, pilot)
        await pilot.pause()
        box = screen.query_one("#memory-input", Input)
        box.focus()
        await pilot.press(*"Werkt in Utrecht", "enter")
        await pilot.pause()
        assert load_memory() == "Werkt in Utrecht"


@pytest.mark.asyncio
async def test_an_empty_input_adds_nothing(tmp_roan):
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(80, 24)) as pilot:
        await pilot.pause()
        screen = open_screen(app, pilot)
        await pilot.pause()
        screen.query_one("#memory-input", Input).value = "   "
        screen.query_one("#memory-add", Button).press()
        await pilot.pause()
        assert not config.MEMORY_PATH.exists()


@pytest.mark.asyncio
async def test_removing_takes_the_note_off_disk(tmp_roan):
    remember("Houdt van lokale modellen")
    remember("Woont in Utrecht")
    remember("Drinkt geen koffie")
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(80, 24)) as pilot:
        await pilot.pause()
        screen = open_screen(app, pilot)
        await pilot.pause()
        listing = screen.query_one("#memory-list", OptionList)
        listing.focus()
        listing.highlighted = 1
        await pilot.pause()
        screen.query_one("#memory-remove", Button).press()
        await pilot.pause()
        assert listing.option_count == 2
        assert "Woont in Utrecht" not in render(screen)
        assert load_memory() == "Houdt van lokale modellen\nDrinkt geen koffie"
        assert config.MEMORY_PATH.read_text() == (
            "Houdt van lokale modellen\nDrinkt geen koffie\n"
        )


@pytest.mark.asyncio
async def test_the_d_key_removes_the_highlighted_note(tmp_roan):
    remember("Eerste")
    remember("Tweede")
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(80, 24)) as pilot:
        await pilot.pause()
        screen = open_screen(app, pilot)
        await pilot.pause()
        listing = screen.query_one("#memory-list", OptionList)
        listing.focus()
        listing.highlighted = 0
        await pilot.pause()
        await pilot.press("d")
        await pilot.pause()
        assert load_memory() == "Tweede"


@pytest.mark.asyncio
async def test_empty_state_lives_in_the_screen(tmp_roan):
    """Leeg geheugen: de melding staat op het scherm, niet als chatregel."""
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(80, 24)) as pilot:
        await pilot.pause()
        screen = open_screen(app, pilot)
        await pilot.pause()
        listing = screen.query_one("#memory-list", OptionList)
        empty = screen.query_one("#memory-empty", Static)
        assert listing.display is False
        assert empty.display is True
        out = render(screen)
        assert t("memory_empty").splitlines()[0] in out
        # En het zegt wie er vulling in komt: alleen `remember` en dit scherm.
        assert "remember" in t("memory_empty")


@pytest.mark.asyncio
async def test_a_new_note_makes_the_empty_state_disappear(tmp_roan):
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(80, 24)) as pilot:
        await pilot.pause()
        screen = open_screen(app, pilot)
        await pilot.pause()
        screen.query_one("#memory-input", Input).focus()
        await pilot.press(*"iets", "enter")
        await pilot.pause()
        assert screen.query_one("#memory-list", OptionList).display is True
        assert screen.query_one("#memory-empty", Static).display is False


@pytest.mark.asyncio
async def test_a_long_entry_is_cut_in_the_list_and_whole_below(tmp_roan):
    """Transcript-patroon: kort in de lijst, de volledige tekst eronder."""
    long_note = (
        "Werkt aan een TUI met drie Catppuccin-smaken en wil dat het portret nooit "
        "een witte vlak wordt op een halfcell-terminal, want dat komt alleen voor "
        "als de terminal het beeldprotocol niet heeft aangekondigd"
    )
    remember(long_note)
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(60, 24)) as pilot:
        await pilot.pause()
        screen = open_screen(app, pilot)
        await pilot.pause()
        listing = screen.query_one("#memory-list", OptionList)
        assert listing.highlighted == 0
        out = render(screen)
        assert "…" in out, "de lijst moet de notitie afkappen"
        # Het balkje eronder heeft de tekst wél volledig, en scrollt als het te
        # groot is voor zijn vier regels.
        detail = screen.query_one("#memory-detail")
        assert detail.display is True
        assert str(screen.query_one("#memory-full", Static).render()) == long_note
        assert detail.max_scroll_y > 0, "de volledige tekst moet te scrollen zijn"


@pytest.mark.asyncio
async def test_memory_command_writes_nothing_into_messages(tmp_roan):
    """Het hele punt van issue #21: /memory is een scherm, geen chatregel."""
    remember("Houdt van lokale modellen")
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(80, 24)) as pilot:
        await pilot.pause()
        app.query_one("#messages").remove_children()
        await pilot.press(*"/memory", "enter")
        await pilot.pause()
        assert isinstance(app.screen, MemoryScreen)
        assert len(app.query("#messages > *")) == 0
        assert len(app.query("#messages Markdown")) == 0
        assert "Houdt van lokale modellen" in render(app.screen)
        await pilot.press("escape")
        await pilot.pause()
        assert len(app.query("#messages > *")) == 0
        assert not isinstance(app.screen, MemoryScreen)


@pytest.mark.asyncio
async def test_the_close_button_closes(tmp_roan):
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(80, 24)) as pilot:
        await pilot.pause()
        screen = open_screen(app, pilot)
        await pilot.pause()
        screen.query_one("#close", Button).press()
        await pilot.pause()
        assert not isinstance(app.screen, MemoryScreen)


# ---------- vorm en formaat ----------
@pytest.mark.asyncio
async def test_it_looks_like_every_other_popup(tmp_roan):
    """Zelfde klasse, zelfde gedeelde opmaak, één kader."""
    assert MemoryScreen.CSS.startswith(POPUP_CSS)
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(64, 26)) as pilot:
        await pilot.pause()
        screen = open_screen(app, pilot)
        await pilot.pause()
        box = screen.query_one("#memory-box")
        assert "popup" in box.classes
        assert box.styles.border.top[0] == "round"
        assert screen.query_one("#close", Button) is not None
        # Geen kaders ín de kist.
        for sel in ("#memory-input", "#memory-add", "#memory-remove"):
            assert screen.query_one(sel).styles.border.top[0] == "", sel
        # Focus ligt meteen in het notitieveld.
        assert app.focused is not None and app.focused.id == "memory-input"


@pytest.mark.asyncio
@pytest.mark.parametrize("size", [(80, 24), (46, 24), (46, 18)])
async def test_it_fits_a_phone(tmp_roan, size):
    """Niets valt buiten het scherm, en de hint blijft heel."""
    for note in ("Houdt van lokale modellen", "Woont in Utrecht", "Bouwt liever klein dan snel"):
        remember(note)
    cols, rows = size
    app = RoanApp(FakeAgent())
    async with app.run_test(size=size) as pilot:
        await pilot.pause()
        screen = open_screen(app, pilot)
        await pilot.pause()
        box = screen.query_one("#memory-box").region
        assert box.x >= 0 and box.x + box.width <= cols, box
        assert box.y >= 0 and box.y + box.height <= rows, box
        for sel in ("#memory-list", "#memory-input", "#memory-add", "#memory-status",
                    "#memory-remove", "#memory-hint"):
            region = screen.query_one(sel).region
            assert region.x >= 0 and region.x + region.width <= cols, f"{sel} {region}"
            assert region.y >= 0 and region.y + region.height <= rows, f"{sel} {region}"
        if rows >= 24:
            out = render(screen)
            for line in t("memory_hint").splitlines():
                assert line in out, f"hint afgekapt: {line!r}"


@pytest.mark.asyncio
async def test_both_languages_render(tmp_roan):
    """Elke memory-string bestaat in nl én en (test_i18n houdt ze synchroon)."""
    remember("Houdt van lokale modellen")
    for lang in ("nl", "en"):
        i18n.set_language(lang)
        app = RoanApp(FakeAgent())
        async with app.run_test(size=(80, 24)) as pilot:
            await pilot.pause()
            screen = open_screen(app, pilot)
            await pilot.pause()
            out = render(screen)
            for line in (
                i18n.t("memory_title"),
                i18n.t("memory_hint").splitlines()[0],
                i18n.t("memory_count", n=1),
            ):
                assert line in out, (lang, line)
    i18n.set_language("nl")


def test_every_memory_string_exists_in_both_languages():
    for key in MEMORY_KEYS:
        for lang in ("nl", "en"):
            value = i18n.STRINGS[lang].get(key)
            assert value, f"{key} ontbreekt in {lang}"
        assert i18n.STRINGS["nl"][key] != i18n.STRINGS["en"][key] or key == "memory_new"
