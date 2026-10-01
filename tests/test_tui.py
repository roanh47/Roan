"""TUI-tests via Textual's headless pilot (geen netwerk)."""

import asyncio
import json
import threading

import pytest

from roan import config
from roan.i18n import t
from roan.tui import HistoryInput, RoanApp, SetupScreen


class FakeAgent:
    model = "fake"
    session_id = "test-session"
    messages = []

    def __init__(self):
        self.sent = []

    def reload(self):
        pass

    def clear(self):
        self.messages = []

    def save(self):
        pass

    def send(self, text):
        self.sent.append(text)
        return f"echo: {text}"

    def send_stream(self, text, on_event=None):
        self.sent.append(text)
        yield f"echo: {text}"


def avatar_path():
    from pathlib import Path

    return str(Path(__file__).resolve().parents[1] / "roan" / "assets" / "avatar.png")


@pytest.fixture
def tmp_roan(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "ROAN_DIR", tmp_path)
    monkeypatch.setattr(config, "CONFIG_PATH", tmp_path / "config.json")
    monkeypatch.setattr(config, "MEMORY_PATH", tmp_path / "memory.md")
    monkeypatch.setattr(config, "USER_PATH", tmp_path / "user.md")
    monkeypatch.setattr(config, "INSTRUCTIONS_PATH", tmp_path / "instructions.md")
    monkeypatch.setattr(config, "SKILLS_DIR", tmp_path / "skills")
    # Standaard een config zodat het setup-scherm niet automatisch opent,
    # en een expliciete renderer zodat de fullscreen-dialoog niet verschijnt.
    config.save_config({"provider": "lmstudio", "model": "test-model", "tui": "default"})
    return tmp_path


def avatar_path():
    from pathlib import Path

    return str(Path(__file__).resolve().parents[1] / "roan" / "assets" / "avatar.png")


@pytest.fixture
def tmp_roan_noconfig(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "ROAN_DIR", tmp_path)
    monkeypatch.setattr(config, "CONFIG_PATH", tmp_path / "config.json")
    monkeypatch.setattr(config, "MEMORY_PATH", tmp_path / "memory.md")
    monkeypatch.setattr(config, "USER_PATH", tmp_path / "user.md")
    monkeypatch.setattr(config, "INSTRUCTIONS_PATH", tmp_path / "instructions.md")
    monkeypatch.setattr(config, "SKILLS_DIR", tmp_path / "skills")
    return tmp_path


@pytest.mark.asyncio
async def test_slash_help(tmp_roan):
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        await pilot.press(*"/help", "enter")
        await pilot.pause()
        texts = [w.source for w in app.query("Markdown")]
        assert any("Commando" in str(t) for t in texts)


@pytest.mark.asyncio
async def test_slash_model_writes_config(tmp_roan):
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        await pilot.press(*"/model test-123", "enter")
        await pilot.pause()
        assert config.load_config()["model"] == "test-123"


@pytest.mark.asyncio
async def test_slash_clear(tmp_roan):
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        await pilot.press(*"/model x", "enter")
        await pilot.pause()
        assert len(app.query("#messages > *")) > 0
        await pilot.press(*"/clear", "enter")
        await pilot.pause()
        assert len(app.query("#messages > *")) == 0


@pytest.mark.asyncio
async def test_normal_message_goes_to_agent(tmp_roan):
    agent = FakeAgent()
    app = RoanApp(agent)
    async with app.run_test() as pilot:
        await pilot.press(*"hi there", "enter")
        await pilot.pause()
        await pilot.pause()
        assert agent.sent == ["hi there"]


@pytest.mark.asyncio
async def test_theme_switch(tmp_roan):
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        await pilot.press(*"/theme frappe", "enter")
        await pilot.pause()
        assert app.theme == "frappe"


@pytest.mark.asyncio
async def test_models_screen_saves_provider_and_model(tmp_roan):
    from roan.tui import ModelsScreen

    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        app._open_models([("groq", "llama-x")], [("openai", "gpt-5")], ["local-a"])
        await pilot.pause()
        assert isinstance(app.screen, ModelsScreen)
        listing = app.screen.query_one("#models-list")
        listing.focus()
        listing.highlighted = 0
        await pilot.pause()
        await pilot.press("enter")
        await pilot.pause()
        cfg = config.load_config()
        assert cfg["model"] == "llama-x"
        assert cfg["provider"] == "groq"


@pytest.mark.asyncio
async def test_models_screen_categories(tmp_roan):
    from roan.tui import ModelsScreen

    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        app._open_models([("groq", "free-a")], [("openai", "paid-a")], ["local-a"])
        await pilot.pause()
        screen = app.screen
        assert isinstance(screen, ModelsScreen)

        listing = screen.query_one("#models-list")
        assert listing.option_count == 1

        from textual.widgets import Select

        screen.query_one("#cat", Select).value = "paid"
        await pilot.pause()
        ids = [listing.get_option_at_index(i).id for i in range(listing.option_count)]
        assert ids == ["openai|paid-a"]

        screen.query_one("#cat", Select).value = "custom"
        await pilot.pause()
        ids = [listing.get_option_at_index(i).id for i in range(listing.option_count)]
        assert ids == [f"{config.load_config()['provider']}|local-a"]


@pytest.mark.asyncio
async def test_unknown_command_reports(tmp_roan):
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        await pilot.press(*"/nope", "enter")
        await pilot.pause()
        statics = [str(w.render()) for w in app.query("Static")]
        assert any("Onbekend" in s for s in statics)


@pytest.mark.asyncio
async def test_status_bar_shows_model(tmp_roan):
    config.save_config({"provider": "groq", "model": "my-model"})
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        await pilot.pause()
        status = str(app.query_one("#status").render())
        assert "my-model" in status
        assert "groq" in status


def test_tool_summary_variants():
    from roan.tui import tool_summary

    assert tool_summary("run_shell", {"command": "ls -la"}) == "ls -la"
    assert tool_summary("read_file", {"path": "/tmp/x"}) == "/tmp/x"
    assert tool_summary("web_search", {"query": "python"}) == "python"
    assert tool_summary("other", {}) == ""


@pytest.mark.asyncio
async def test_tool_events_render(tmp_roan):
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        await pilot.pause()
        before = len(app.query("#messages > *"))
        app._render_tool_event({"type": "tool_call", "name": "run_shell", "arguments": {"command": "ls"}})
        app._render_tool_event({"type": "tool_result", "name": "run_shell", "result": "file.py"})
        await pilot.pause()
        after = app.query("#messages > *")
        assert len(after) == before + 2
        rendered = " ".join(str(w.render()) for w in after)
        assert "run_shell" in rendered and "file.py" in rendered


@pytest.mark.asyncio
async def test_setup_auto_opens_without_config(tmp_roan_noconfig):
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        await pilot.pause()
        assert isinstance(app.screen, SetupScreen)


@pytest.mark.asyncio
async def test_setup_screen_saves(tmp_roan):
    from textual.widgets import Button, Input

    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        app._open_setup()
        await pilot.pause()
        assert isinstance(app.screen, SetupScreen)
        app.screen.provider = "groq"
        app.screen.model = "setup-model"
        app.screen.query_one("#api_key", Input).value = "key-123"
        app.screen.query_one("#save", Button).press()
        await pilot.pause()
        cfg = config.load_config()
        assert cfg["model"] == "setup-model"
        assert cfg["provider"] == "groq"
        assert cfg["api_key"] == "key-123"


@pytest.mark.asyncio
async def test_setup_cancel_leaves_config(tmp_roan):
    from textual.widgets import Button

    before = config.load_config()["model"]
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        app._open_setup()
        await pilot.pause()
        app.screen.query_one("#cancel", Button).press()
        await pilot.pause()
        assert config.load_config()["model"] == before


def test_history_input_dedup_and_navigate():

    inp = HistoryInput()
    inp.add_history("een")
    inp.add_history("twee")
    inp.add_history("twee")  # duplicaat niet nog eens
    assert inp._history == ["een", "twee"]


@pytest.mark.asyncio
async def test_input_history_arrow_up(tmp_roan):
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        await pilot.press(*"eerste", "enter")
        await pilot.pause()
        await pilot.pause()
        inp = app.query_one("#input")
        await pilot.press("up")
        await pilot.pause()
        assert inp.value == "eerste"


@pytest.mark.asyncio
async def test_action_new_session(tmp_roan):
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        old = app.agent.session_id
        app.action_new_session()
        await pilot.pause()
        assert app.agent.session_id != old


@pytest.mark.asyncio
async def test_action_clear_chat(tmp_roan):
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        app._sysline("iets")
        await pilot.pause()
        assert len(app.query("#messages > *")) > 0
        app.action_clear_chat()
        await pilot.pause()
        assert len(app.query("#messages > *")) == 0


@pytest.mark.asyncio
async def test_restored_history_is_rendered(tmp_roan):
    class HistAgent(FakeAgent):
        def __init__(self):
            super().__init__()
            self.messages = [
                {"role": "system", "content": "sys"},
                {"role": "user", "content": "oude vraag"},
                {"role": "assistant", "content": "oud antwoord"},
            ]

    app = RoanApp(HistAgent())
    async with app.run_test() as pilot:
        await pilot.pause()
        rendered = " ".join(str(w.render()) for w in app.query("#messages > *"))
        assert "oude vraag" in rendered
        assert "hersteld" in rendered
        sources = " ".join(str(w.source) for w in app.query("Markdown"))
        assert "oud antwoord" in sources


# ---------- slash-suggesties, zoals opencode / claude code ----------
@pytest.mark.asyncio
async def test_typing_slash_shows_command_suggestions(tmp_roan):
    from textual.widgets import OptionList

    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        await pilot.pause()
        listing = app.query_one("#slash", OptionList)
        assert not listing.has_class("visible")

        await pilot.press(*"/cl")
        await pilot.pause()
        assert listing.has_class("visible")
        assert listing.option_count == 1
        assert listing.get_option_at_index(0).id == "clear"

        # Een spatie betekent: commando gekozen, niet meer aanvullen.
        await pilot.press("space")
        await pilot.pause()
        assert not listing.has_class("visible")


@pytest.mark.asyncio
async def test_tab_completes_the_command_without_losing_focus(tmp_roan):
    from textual.widgets import OptionList

    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        await pilot.pause()
        await pilot.press(*"/cl")
        await pilot.pause()
        await pilot.press("tab")
        await pilot.pause()
        assert app.query_one("#input").value == "/clear"
        assert app.focused.id == "input", "tab mag de focus niet weggeven"


@pytest.mark.asyncio
async def test_enter_runs_a_fully_typed_command(tmp_roan):
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        await pilot.pause()
        await pilot.press(*"/clear", "enter")
        await pilot.pause()
        # /clear is uitgevoerd, niet alleen aangevuld.
        assert app.query_one("#input").value == ""
        from textual.widgets import OptionList

        assert not app.query_one("#slash", OptionList).has_class("visible")


@pytest.mark.asyncio
async def test_avatar_uses_our_renderer_when_not_a_graphics_protocol(tmp_roan):
    """Zonder sixel/TGP tekenen wij de avatar zelf.

    De halfcell-renderable van textual_image zet doorzichtige pixels op wit, dus
    dan zou de avatar als een witte vlak in het chatvenster staan.
    """
    from textual.widgets import Static

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(90, 30)) as pilot:
        await pilot.pause()
        avatar = app.query_one("#avatar")
        assert isinstance(avatar, Static), type(avatar).__name__


@pytest.mark.asyncio
@pytest.mark.parametrize("size", [(60, 26), (100, 50), (80, 24)])
async def test_avatar_rows_do_not_wrap(tmp_roan, size):
    """Regression: de avatar stond te klein en elke regel liep door.

    #avatar had horizontale padding, terwijl _size_avatar de breedte op het
    aantal kolommen van de tekst zet. De bruikbare breedte was daardoor vier
    tekenen kleiner dan de tekst en Rich wrapte elke regel in 12 + 4, wat
    eruitzag als losse streepjes tussen de regels door.
    """
    from roan.photo import fitted_cells

    app = RoanApp(FakeAgent())
    async with app.run_test(size=size) as pilot:
        await pilot.pause()
        avatar = app.query_one("#avatar")
        cols, rows = fitted_cells(avatar_path(), 26, max_rows=app._avatar_rows())
        # Als de tekst niet past in de widget, breekt Rich elke regel af.
        assert avatar.content_size.width >= cols, (
            f"avatar {avatar.content_size} past {cols} kolommen niet"
        )
        assert avatar.content_size.height >= rows


# ---------- statusbalk ----------
@pytest.mark.asyncio
async def test_status_bar_has_no_api_key_status(tmp_roan):
    """"key ingesteld" was nutteloos: de setup vertelt het al."""
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(110, 26)) as pilot:
        await pilot.pause()
        text = "".join(
            seg.text for seg in app.screen._compositor.render_strips()[25]
        ).lower()
        assert "key" not in text
        assert "ingesteld" not in text


@pytest.mark.asyncio
async def test_typing_model_still_offers_models(tmp_roan):
    """Regression: bij `/model` verdween `/models` uit de lijst.

    De exacte treffer sluit de langere varianten niet meer uit, anders is
    /models onbereikbaar zodra je het eerste commando volledig hebt getypt.
    """
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        await pilot.pause()
        await pilot.press(*"/model")
        await pilot.pause()
        listing = app.query_one("#slash")
        ids = [listing.get_option_at_index(i).id for i in range(listing.option_count)]
        assert "model" in ids
        assert "models" in ids, ids


@pytest.mark.asyncio
async def test_ctrl_p_hint_is_clickable(tmp_roan):
    from roan.tui import CommandScreen

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(110, 26)) as pilot:
        await pilot.pause()
        await pilot.click("#status-hints")
        await pilot.pause()
        assert isinstance(app.screen, CommandScreen)


@pytest.mark.asyncio
async def test_mode_permission_and_thinking_are_persisted(tmp_roan):
    from roan import config

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(110, 26)) as pilot:
        await pilot.pause()
        for text, key, value in (
            ("/mode plan", "mode", "plan"),
            ("/permissions user", "permissions", "user"),
            ("/thinking high", "thinking", "high"),
        ):
            await pilot.press(*text, "enter")
            await pilot.pause()
            assert config.load_config()[key] == value


@pytest.mark.asyncio
async def test_status_bar_hides_chips_on_a_narrow_window(tmp_roan):
    """Op een smal venster moet de provider niet weggeknipt worden."""
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(60, 26)) as pilot:
        await pilot.pause()
        assert app.query_one("#status-thinking").display is False
        assert app.query_one("#status-perm").display is False
        # ctrl+p blijft altijd klikbaar.
        assert app.query_one("#status-hints").display is True


# ---------- de ✕ is 5 kolommen, met het teken in het midden ----------
def _row_text(screen, y: int) -> str:
    return "".join(seg.text for seg in screen._compositor.render_strips()[y])


@pytest.mark.asyncio
async def test_popup_close_button_is_five_columns_with_the_glyph_centred(tmp_roan):
    """5 kolommen breed en 2 kolommen lucht aan weerszijden van het teken.

    In een popup won de generieke `.popup Button` (min-width 6, padding 0 1)
    van `.close`, waardoor de knop daar 6 kolommen breed werd. Het kruisje rechts
    bovenin het hoofdscherm is weg sinds de avatar daar staat.
    """
    from textual.widgets import Button

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(90, 30)) as pilot:
        await pilot.pause()
        scr = SetupScreen(provider="groq", model="m")
        app.push_screen(scr)
        await pilot.pause()
        popup_close = scr.query_one("#close", Button)
        assert popup_close.region.width == 5, popup_close.region
        row = _row_text(scr, popup_close.region.y)
        assert row[popup_close.region.x : popup_close.region.x + 5] == "  ✕  "


def _blank_columns_between(left, right) -> int:
    """Lege kolommen tussen twee knoppen.

    Textual tekent de achtergrond van een widget over zijn hele region, dus de
    marge telt mee in het vak van de knop en het gat ertussen is precies
    `right.region.x - (left.region.x + left.region.width)`.
    """
    return right.region.x - (left.region.x + left.region.width)


@pytest.mark.asyncio
async def test_two_blank_columns_between_the_setup_buttons(tmp_roan):
    """Tussen Annuleren en Opslaan staan twee lege kolommen."""
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(90, 30)) as pilot:
        app.push_screen(SetupScreen(provider="groq", model="m"))
        await pilot.pause()
        scr = app.screen
        assert _blank_columns_between(scr.query_one("#cancel"), scr.query_one("#save")) == 2
        # de rij staat nog steeds rechts, met de laatste knop tegen de rand
        box = scr.query_one("#setup-box")
        assert scr.query_one("#save").region.right == box.content_region.right


@pytest.mark.asyncio
async def test_two_blank_columns_between_the_models_buttons_and_filters(tmp_roan):
    from roan.tui import ModelsScreen, ProviderScreen

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(90, 30)) as pilot:
        await pilot.pause()

        models = ModelsScreen([("groq", "llama-3")], [], [])
        app.push_screen(models)
        await pilot.pause()
        assert _blank_columns_between(models.query_one("#mback"), models.query_one("#mchoose")) == 2
        # de categorie- en de providerkiezer
        assert _blank_columns_between(models.query_one("#cat"), models.query_one("#prov")) == 2
        app.pop_screen()
        await pilot.pause()

        provider = ProviderScreen()
        app.push_screen(provider)
        await pilot.pause()
        assert _blank_columns_between(provider.query_one("#pback"), provider.query_one("#pchoose")) == 2
        app.pop_screen()
        await pilot.pause()


# ---------- de setup heeft vorm en scheiding ----------
@pytest.mark.asyncio
async def test_provider_label_is_bold(tmp_roan):
    from roan.i18n import t

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(64, 26)) as pilot:
        app.push_screen(SetupScreen(provider="groq", model="m"))
        await pilot.pause()
        label = app.screen.query_one(".section.strong")
        assert str(label.render()) == t("setup_provider")
        segments = app.screen._compositor.render_strips()[label.region.y]
        assert any(seg.style.bold and t("setup_provider") in seg.text for seg in segments), (
            "het woord Provider moet vet zijn"
        )


@pytest.mark.asyncio
async def test_a_line_separates_provider_from_api_key(tmp_roan):
    from textual.widgets import Rule

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(64, 26)) as pilot:
        app.push_screen(SetupScreen(provider="groq", model="m"))
        await pilot.pause()
        scr = app.screen
        rule = scr.query_one("#sep-api-key", Rule)
        # tussen het providerblok en het api-keyblok in
        assert scr.query_one("#cur-provider").region.y < rule.region.y
        assert rule.region.y < scr.query_one("#api_key").region.y
        # en hij tekent echt een horizontale lijn over de hele breedte
        row = _row_text(scr, rule.region.y)
        assert row.count("─") == rule.content_size.width >= 8
        assert row.count("─") >= 8, row


@pytest.mark.asyncio
async def test_the_other_groups_are_separated_too(tmp_roan):
    """Model en base url krijgen dezelfde scheiding; base url alleen als je hem nodig hebt."""
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(64, 26)) as pilot:
        app.push_screen(SetupScreen(provider="groq", model="m"))
        await pilot.pause()
        scr = app.screen
        assert scr.query_one("#sep-model").region.y < scr.query_one("#cur-model").region.y
        # groq kent zijn eigen base url: geen extra groep, dus geen lijn
        assert scr.query_one("#sep-base-url").display is False

        app.pop_screen()
        await pilot.pause()
        custom = SetupScreen(provider="custom", model="m", base_url="https://thuis/v1")
        app.push_screen(custom)
        await pilot.pause()
        assert custom.query_one("#sep-base-url").display is True
        assert custom.query_one("#sep-base-url").region.y < custom.query_one("#base_url").region.y


# ---------- de api key: gemaskeerd, klikken onthult hem ----------
@pytest.mark.asyncio
async def test_api_key_is_shown_masked_and_revealed_on_click(tmp_roan):
    from textual.widgets import Input

    config.save_config({"api_key": "sk-bewaarde-sleutel"})
    app = RoanApp(FakeAgent())
    results = []
    async with app.run_test(size=(64, 26)) as pilot:
        app.push_screen(SetupScreen(provider="groq", model="m"), results.append)
        await pilot.pause()
        box = app.screen.query_one("#api_key", Input)
        # gemaskeerd, niet de echte sleutel
        assert box.value == "sk-…", box.value
        assert box.password is False
        assert "sk-bewaarde-sleutel" not in _row_text(app.screen, box.region.y)
        # '(leeg = behouden)' is weg
        assert "behouden" not in "\n".join(
            _row_text(app.screen, y) for y in range(app.screen.query_one("#setup-box").region.y,
                                                     app.screen.query_one("#setup-box").region.bottom)
        )
        # één klik en de echte sleutel staat er
        await pilot.click("#api_key")
        await pilot.pause()
        assert box.value == "sk-bewaarde-sleutel", box.value
        # en die is zichtbaar
        assert "sk-bewaarde-sleutel" in _row_text(app.screen, box.region.y)
        # zonder te typen blijft de bewaarde sleutel zoals hij is
        await pilot.press("enter")
        await pilot.pause()
    assert results == [True]
    assert config.load_config()["api_key"] == "sk-bewaarde-sleutel"


@pytest.mark.asyncio
async def test_api_key_starts_masked_again_on_every_open(tmp_roan):
    """Het onthullen duurt één scherm-opening; de volgende keer staat het mas weer."""
    from textual.widgets import Input

    config.save_config({"api_key": "sk-bewaarde-sleutel"})
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(64, 26)) as pilot:
        await pilot.pause()
        app.push_screen(SetupScreen(provider="groq", model="m"))
        await pilot.pause()
        await pilot.click("#api_key")
        await pilot.pause()
        assert app.screen.query_one("#api_key", Input).value == "sk-bewaarde-sleutel"
        app.pop_screen()
        await pilot.pause()

        app.push_screen(SetupScreen(provider="groq", model="m"))
        await pilot.pause()
        assert app.screen.query_one("#api_key", Input).value == "sk-…"


@pytest.mark.asyncio
async def test_typing_replaces_the_mask_instead_of_adding_to_it(tmp_roan):
    """Regression: de eerste letter van een nieuwe sleutel mocht niet wegvallen.

    De maskering begint met 's', dus een handler die 's' als een stukje van de
    maskering herkende, vrat de eerste toets op.
    """
    from textual.widgets import Input

    config.save_config({"api_key": "sk-oude-sleutel"})
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(64, 26)) as pilot:
        app.push_screen(SetupScreen(provider="groq", model="m"))
        await pilot.pause()
        box = app.screen.query_one("#api_key", Input)
        assert box.value == "sk-…"
        await pilot.press(*"sk-nieuw")
        await pilot.pause()
        assert box.value == "sk-nieuw", box.value
        await pilot.press("enter")
        await pilot.pause()
    assert config.load_config()["api_key"] == "sk-nieuw"


@pytest.mark.asyncio
async def test_saving_without_touching_the_key_keeps_the_stored_one(tmp_roan):
    config.save_config({"api_key": "sk-bewaarde-sleutel"})
    app = RoanApp(FakeAgent())
    results = []
    async with app.run_test(size=(64, 26)) as pilot:
        app.push_screen(SetupScreen(provider="groq", model="m"), results.append)
        await pilot.pause()
        await pilot.press("enter")  # alleen Enter, geen klik en geen typen
        await pilot.pause()
    assert results == [True]
    assert config.load_config()["api_key"] == "sk-bewaarde-sleutel"


# ---------- de slash staat maar één keer in de commandoregel ----------
@pytest.mark.asyncio
async def test_slash_popup_shows_the_slash_once(tmp_roan):
    from textual.widgets import OptionList

    from roan import commands

    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        await pilot.pause()
        listing = app.query_one("#slash", OptionList)
        for name in commands.names():
            app.query_one("#input").value = f"/{name}"
            app._update_slash()
            await pilot.pause()
            assert listing.option_count >= 1, name
            for index in range(listing.option_count):
                option = listing.get_option_at_index(index)
                assert option.id not in (None, ""), name
                prompt = str(option.prompt)
                dup = f"/{option.id}/{option.id}"
                assert dup not in prompt, f"{prompt!r} bevat {dup!r}"


@pytest.mark.asyncio
async def test_slash_popup_shows_arguments_without_repeating_the_name(tmp_roan):
    from textual.widgets import OptionList

    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        await pilot.pause()
        listing = app.query_one("#slash", OptionList)
        app.query_one("#input").value = "/tui"
        app._update_slash()
        await pilot.pause()
        prompt = str(listing.get_option_at_index(0).prompt)
        assert prompt.startswith("/tui <fullscreen|default>"), prompt

        app.query_one("#input").value = "/theme"
        app._update_slash()
        await pilot.pause()
        assert str(listing.get_option_at_index(0).prompt).startswith("/theme <naam>")


@pytest.mark.asyncio
async def test_command_palette_shows_the_slash_once(tmp_roan):
    from roan.commands import COMMANDS
    from roan.tui import CommandScreen
    from textual.widgets import OptionList

    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        await pilot.pause()
        app.push_screen(CommandScreen())
        await pilot.pause()
        listing = app.screen.query_one("#command-list", OptionList)
        assert listing.option_count == len(COMMANDS)
        for index in range(listing.option_count):
            option = listing.get_option_at_index(index)
            prompt = str(option.prompt)
            dup = f"/{option.id}/{option.id}"
            assert dup not in prompt, f"{prompt!r} bevat {dup!r}"
            assert prompt.startswith(f"/{option.id}"), prompt


@pytest.mark.asyncio
async def test_command_palette_usage_is_not_duplicated(tmp_roan):
    from roan.i18n import t
    from roan.tui import CommandScreen
    from textual.widgets import OptionList

    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        await pilot.pause()
        app.push_screen(CommandScreen())
        await pilot.pause()
        listing = app.screen.query_one("#command-list", OptionList)
        prompts = {
            str(listing.get_option_at_index(i).id): str(
                listing.get_option_at_index(i).prompt
            )
            for i in range(listing.option_count)
        }
        assert "/tui  <fullscreen|default>" in prompts["tui"], prompts["tui"]
        assert "/theme  <naam>" in prompts["theme"], prompts["theme"]
        # /help heeft geen argumenten: geen dubbele spatie, geen naam-tweemaal.
        # De rij is nu twee kolommen (commando, dan beschrijving op één vaste
        # kolom), dus het scheidingsteken tussen beide staat er niet meer.
        assert prompts["help"].startswith("/help "), prompts["help"]
        assert prompts["help"].rstrip().endswith(t("cmd_help")), prompts["help"]
        assert "/help  ·" not in prompts["help"], prompts["help"]
        app.pop_screen()
        await pilot.pause()


def test_help_text_shows_the_slash_once():
    from roan import commands

    for name in commands.names():
        line = next(
            ln
            for ln in commands.help_text().splitlines()
            if ln.startswith(f"- **/{name}**")
        )
        assert f"/{name}/{name}" not in line, line
    assert "- **/tui** `<fullscreen|default>`" in commands.help_text()
    assert "- **/help**" in commands.help_text()


# ---------- klikbare statusbalk: model, modus en toestemming ----------
async def _wait_for_models_screen(app, pilot, tries: int = 80) -> bool:
    """Het modellenoverzicht wordt in een worker-thread opgehaald."""
    import asyncio

    for _ in range(tries):
        await pilot.pause()
        await asyncio.sleep(0.01)
        if app.screen.__class__.__name__ == "ModelsScreen":
            return True
    return False


def _cell_style(app, x: int, y: int):
    """De stijl van één cel, om een hover zichtbaar te maken in de test."""
    for seg in app.screen._compositor.render_strips()[y]:
        if x < len(seg.text):
            return seg.style
        x -= len(seg.text)
    return None


@pytest.mark.asyncio
async def test_clicking_the_model_opens_the_models_screen(tmp_roan, monkeypatch):
    """Model · provider is een knopje: klikken doet hetzelfde als `/models`."""
    from roan import tui as tui_mod
    from roan.tui import ModelsScreen

    # geen netwerk: de lijsten liggen er al
    monkeypatch.setattr(
        tui_mod,
        "gather_models",
        lambda: ([("groq", "llama-x")], [("openai", "gpt-5")], ["local-a"]),
    )
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(110, 26)) as pilot:
        await pilot.pause()
        assert "test-model" in str(app.query_one("#status").render())
        assert await pilot.click("#status")
        assert await _wait_for_models_screen(app, pilot), app.screen
        assert isinstance(app.screen, ModelsScreen)
        assert app.screen.query_one("#models-list").option_count == 1


@pytest.mark.asyncio
async def test_clicking_the_mode_chip_cycles_chat_plan_build(tmp_roan):
    """Eén klik op de chip = de volgende modus, en het blijft saved."""
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(110, 26)) as pilot:
        await pilot.pause()
        assert config.load_config()["mode"] == "chat"
        # De chip toont `Mode: Chat`; in de config blijft het `chat` staan,
        # alleen voor het lezen wordt de eerste letter groot gemaakt.
        assert str(app.query_one("#status-mode").render()) == "·  Mode: Chat"
        for expected in ("plan", "build", "chat"):
            await pilot.click("#status-mode")
            await pilot.pause()
            assert config.load_config()["mode"] == expected
            assert (
                str(app.query_one("#status-mode").render())
                == f"·  Mode: {expected.capitalize()}"
            )
        # en het gesprek bevestigt het, met de nieuwe naam erbij
        assert "chat" in str(list(app.query("#messages > *"))[-1].render())


@pytest.mark.asyncio
async def test_clicking_the_permissions_chip_flips_auto_and_user(tmp_roan):
    """Auto ⇄ user, net als het commando zonder argument.

    Op het scherm staat `Approvals: Auto`/`User` (de waarde wordt voor het lezen
    met een hoofdletter geschreven, net als `Mode: Chat`); in de config blijft
    `auto`/`user` in klein staan.
    """
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(110, 26)) as pilot:
        await pilot.pause()
        assert config.load_config()["permissions"] == "auto"
        for expected in ("user", "auto"):
            await pilot.click("#status-perm")
            await pilot.pause()
            assert config.load_config()["permissions"] == expected
            assert config.load_config()["permissions"].islower()
            assert (
                str(app.query_one("#status-perm").render())
                == f"·  Approvals: {expected.capitalize()}"
            )
        assert "auto" in str(list(app.query("#messages > *"))[-1].render())


@pytest.mark.asyncio
async def test_clickable_status_items_show_it_on_hover(tmp_roan):
    """Zonder hover-acht is een chip niet te onderscheiden van gewone tekst."""
    for selector in ("#status", "#status-mode", "#status-perm", "#status-hints"):
        app = RoanApp(FakeAgent())
        async with app.run_test(size=(110, 26)) as pilot:
            await pilot.pause()
            region = app.query_one(selector).region
            # De eerste cel is bij een chip de ` · `, en die is een scheider: die
            # blijft grijs op hover. De test wil dus de WOORDEN zien omslaan.
            x = region.x + 1
            if str(app.query_one(selector).render()).startswith("·"):
                x += 3
            before = _cell_style(app, x, region.y)
            await pilot.hover(selector, offset=(1, 0))
            await pilot.pause()
            after = _cell_style(app, x, region.y)
            assert (before.color, before.bgcolor) != (after.color, after.bgcolor), selector


@pytest.mark.asyncio
async def test_hidden_status_chips_stay_quiet_and_model_stays_clickable(tmp_roan):
    """Op een smal venster staan modus en toestemming er niet meer.

    Dan klikt daar niemand, en een klik elders mag ze zeker niet meenemen;
    model · provider blijft de enige die altijd zichtbaar is.
    """
    from roan.tui import ModelsScreen

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(60, 26)) as pilot:
        await pilot.pause()
        assert app.query_one("#status-mode").display is False
        assert app.query_one("#status-perm").display is False
        assert app.query_one("#status").display is True

        before = (config.load_config()["mode"], config.load_config()["permissions"])
        await pilot.click("#messages", offset=(5, 5))
        await pilot.pause()
        assert (config.load_config()["mode"], config.load_config()["permissions"]) == before

        await pilot.click("#status")
        assert await _wait_for_models_screen(app, pilot), app.screen
        assert isinstance(app.screen, ModelsScreen)


# ---------- de ✕ volgt de rechterrand als het venster van maat verandert ----------
@pytest.mark.asyncio


@pytest.mark.asyncio
async def test_avatar_draws_the_pre_rendered_ansi_at_its_own_size(tmp_roan):
    """De inhoud krijgt precies de cellen van het bestand: 24 breed, 12 hoog.

    Hij mag dus niet groter of kleiner worden: een te smalle widget laat Rich
    elke regel op de volgende doorlopen, en dat breekt de kleur-escapes van
    die regel. De widget zelf is twee cells groter in beide richtingen, want de
    `round` rand zit eromheen en Textual rekent met border-box.
    """
    from rich.cells import cell_len
    from rich.color import ColorType
    from roan.photo import ANS_CELLS

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(90, 30)) as pilot:
        await pilot.pause()
        avatar = app.query_one("#avatar")
        regels = avatar.content.plain.split("\n")
        assert len(regels) == ANS_CELLS[1], f"{len(regels)} rijen, geen {ANS_CELLS[1]}"
        assert {cell_len(r) for r in regels} == {ANS_CELLS[0]}, "rij niet 24 kolommen"
        # de buitenste maat is de inhoud plus de twee cells van de rand
        assert avatar.region.size == (ANS_CELLS[0] + 2, ANS_CELLS[1] + 2), avatar.region
        # het vlak van het kader is exact de tekening: geen lucht ertussen
        assert avatar.content_size == ANS_CELLS, avatar.content_size
        # echte kleuren, geen 256 of 16 kleuren
        assert any(
            span.style is not None
            and span.style.color is not None
            and span.style.color.type is ColorType.TRUECOLOR
            for span in avatar.content.spans
        ), "geen truecolor in de stijlen"
        # chafa zet de cursor uit en weer aan; dat hoort niet in een widget
        assert "\x1b" not in avatar.content.plain


@pytest.mark.asyncio
async def test_every_avatar_screen_row_is_a_whole_row(tmp_roan):
    """Geen afgebroken regels: elke schermrij is even breed en niet leeg.

    Dit is de directe variant van de vorige bug: toen stond `padding: 0 2` op
    #avatar, zodat de 24 kolommen in een 20 kolommen brede doos pasten en Rich
    elke regel in 12 + 4 afbrak. Die losse streepjes van 4 tekenden tussen de
    regels door, en de kleur liep weg.
    """
    from rich.cells import cell_len

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(90, 30)) as pilot:
        await pilot.pause()
        avatar = app.query_one("#avatar")
        strips = app.screen._compositor.render_strips()
        rijen = [
            "".join(seg.text for seg in strips[y])
            for y in range(avatar.region.y, avatar.region.y + avatar.region.height)
        ]
        # 12 rijen tekening + 2 rijen rand
        assert len(rijen) == avatar.region.height == 14
        assert {cell_len(rij) for rij in rijen} == {90}, "schermrijen zijn niet even breed"
        # de tekening staat op elke rij; een afgebroken regel is een paar tekens
        for rij in rijen:
            zichtbaar = len(rij.strip())
            assert zichtbaar >= 8, f"rij valt weg (een afgebroken regel?): {rij!r}"


@pytest.mark.asyncio
async def test_avatar_widget_has_no_horizontal_padding(tmp_roan):
    """`padding: 0 2` op #avatar kost vier kolommen van de inhoudsbreedte."""
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(90, 30)) as pilot:
        await pilot.pause()
        avatar = app.query_one("#avatar")
        assert (avatar.styles.padding.left, avatar.styles.padding.right) == (0, 0)


@pytest.mark.asyncio
async def test_avatar_paths_prefers_the_ans_and_points_away_when_it_may_not(tmp_roan):
    """Op een normaal scherm de tekening; te kort → alleen het PNG-pad."""
    from pathlib import Path
    from roan.tui import AVATAR_COLS, BUNDLED_AVATAR, NO_AVATAR_ANS
    from roan.photo import ANS_AVATAR, ANS_CELLS

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(90, 30)) as pilot:
        await pilot.pause()
        ans, png = app._avatar_paths()
        assert Path(ans) == ANS_AVATAR
        assert Path(png) == BUNDLED_AVATAR
        assert app._avatar_rows() == ANS_CELLS[1]

        await pilot.resize_terminal(90, 20)
        await pilot.pause()
        ans, png = app._avatar_paths()
        assert Path(ans) == NO_AVATAR_ANS, "te kort scherm: geen tekening"
        assert app._avatar_rows() < ANS_CELLS[1]
        assert AVATAR_COLS > 0


@pytest.mark.asyncio
async def test_a_short_screen_scales_the_png_instead_of_squashing_the_drawing(tmp_roan):
    """Past 12 rijen er niet in, dan het raster uit de PNG, dat wél schaalt."""
    from rich.cells import cell_len
    from roan.photo import ANS_CELLS, fitted_cells
    from roan.tui import AVATAR_COLS

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(90, 20)) as pilot:
        await pilot.pause()
        avatar = app.query_one("#avatar")
        cols, rows = fitted_cells(avatar_path(), AVATAR_COLS, max_rows=app._avatar_rows())
        assert rows < ANS_CELLS[1], app._avatar_rows()
        # de widget is de raster-maat plus de twee cells van de rand ernaomheen
        assert avatar.region.size == (cols + 2, rows + 2), avatar.region
        assert avatar.content_size == (cols, rows), avatar.content_size
        regels = avatar.content.plain.split("\n")
        assert len(regels) == rows
        assert {cell_len(r) for r in regels} == {cols}


@pytest.mark.asyncio
async def test_a_missing_ans_still_draws_the_png_in_the_same_cells(tmp_roan, tmp_path, monkeypatch):
    """Het .ans is een optimalisatie; zonder het bestand blijft de avatar."""
    from roan import tui as tui_mod
    from roan.photo import ANS_CELLS

    monkeypatch.setattr(tui_mod, "ANS_AVATAR", tmp_path / "niet-meegeleverd.ans")
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(90, 30)) as pilot:
        await pilot.pause()
        avatar = app.query_one("#avatar")
        assert avatar.region.size == (ANS_CELLS[0] + 2, ANS_CELLS[1] + 2), avatar.region
        # het vlak van het kader is exact de tekening: geen lucht ertussen
        assert avatar.content_size == ANS_CELLS, avatar.content_size
        assert set(avatar.content.plain) <= {"▀", "\n"}, "geen halfblokjes uit de PNG"


# ---------- de provider staat in de modellenlijst flush rechts ----------
# De rij was `<model>  ·  <provider>`, waardoor de provider meebeweeg met de
# lengte van de modelnaam. `ModelsScreen._row` vult de modelnaam nu aan tot de
# rij precies zo breed is als de lijst, zodat elke provider op dezelfde kolom
# eindigt; een te lange modelnaam wordt met een liggende streep afgekapt zodat
# de rij nooit ombreekt.

MODELS_MIXED = [
    ("groq", "m"),
    ("cerebras", "qwen3-coder-480b-a35b-instruct-2507"),
    ("xai", "grok-3-mini-beta"),
    ("openai", "gpt-5-nano"),
]


def _models_rows(screen):
    """(rijteksten, inwendige breedte) van #models-list, zoals getekend."""
    from textual.widgets import OptionList

    listing = screen.query_one("#models-list", OptionList)
    width = listing.scrollable_content_region.width
    regels = []
    for y in range(listing.scrollable_content_region.height):
        strip = listing.render_line(y)
        regels.append("".join(seg.text for seg in strip).rstrip())
    while regels and not regels[-1]:
        regels.pop()
    return regels, width


def _provider_end_cells(regels, items):
    """Per rij de kolom (in cellen) waar de provider eindigt, of None."""
    from rich.cells import cell_len

    columns = []
    for regel, (provider, _) in zip(regels, items):
        kolommen = 0
        gevonden = None
        for index, char in enumerate(regel):
            if regel.startswith(str(provider), index):
                gevonden = kolommen + cell_len(str(provider)) - 1
            kolommen += cell_len(char)
        columns.append(gevonden)
    return columns


@pytest.mark.asyncio
async def test_models_provider_is_flush_right_on_every_row(tmp_roan):
    """Alle rijen eindigen op dezelfde kolom: de één na de laatste van de lijst.

    Die kolom is de laatste kolom van de lijst MIN de één die leeg blijft
    tussen de rij en de scrollbar (`SCROLLBAR_GAP`).
    """
    from roan.tui import ModelsScreen

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(100, 30)) as pilot:
        await pilot.pause()
        screen = ModelsScreen(MODELS_MIXED, [], [])
        app.push_screen(screen)
        await pilot.pause()
        regels, width = _models_rows(screen)
        assert len(regels) == len(MODELS_MIXED), regels
        kolommen = _provider_end_cells(regels, MODELS_MIXED)
        assert kolommen == [width - 2] * len(MODELS_MIXED), (kolommen, width, regels)


@pytest.mark.asyncio
async def test_models_rows_do_not_wrap_when_the_popup_is_narrow(tmp_roan):
    """Eén regel per model, ook als de modelnaam niet in de lijst past.

    Voor de opvulling brak een lange modelnaam de rij om, waardoor de provider
    op een aparte regel onderaan terechtkwam.
    """
    from rich.cells import cell_len
    from textual.widgets import OptionList

    from roan.tui import ModelsScreen

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(50, 30)) as pilot:
        await pilot.pause()
        screen = ModelsScreen(MODELS_MIXED, [], [])
        app.push_screen(screen)
        await pilot.pause()
        regels, width = _models_rows(screen)
        listing = screen.query_one("#models-list", OptionList)
        assert len(regels) == len(MODELS_MIXED), regels
        assert all(cell_len(regel) <= width for regel in regels), (regels, width)
        assert all(hoogte == 1 for hoogte in listing._line_cache.heights.values())
        assert all("·" in regel for regel in regels), regels
        assert _provider_end_cells(regels, MODELS_MIXED) == [width - 2] * len(MODELS_MIXED)


@pytest.mark.asyncio
async def test_models_provider_stays_flush_right_after_a_resize(tmp_roan):
    """De opvulling was op de breedte van toen gemaakt en dus gegooid bij resize."""
    from roan.tui import ModelsScreen

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(100, 30)) as pilot:
        await pilot.pause()
        screen = ModelsScreen(MODELS_MIXED, [], [])
        app.push_screen(screen)
        await pilot.pause()
        for size in [(60, 30), (140, 40), (50, 30), (100, 30)]:
            await pilot.resize_terminal(*size)
            await pilot.pause()
            regels, width = _models_rows(screen)
            assert len(regels) == len(MODELS_MIXED), (size, regels)
            kolommen = _provider_end_cells(regels, MODELS_MIXED)
            assert kolommen == [width - 2] * len(MODELS_MIXED), (size, kolommen, width, regels)


@pytest.mark.asyncio
async def test_models_provider_is_flush_right_while_filtering(tmp_roan):
    """Ook na filteren op provider of op zoektekst, en met een lange naam."""
    from textual.widgets import Select

    from roan.tui import ModelsScreen

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(100, 30)) as pilot:
        await pilot.pause()
        screen = ModelsScreen(MODELS_MIXED, [], [])
        app.push_screen(screen)
        await pilot.pause()

        screen.query_one("#prov", Select).value = "cerebras"
        await pilot.pause()
        items = [("cerebras", MODELS_MIXED[1][1])]
        regels, width = _models_rows(screen)
        assert _provider_end_cells(regels, items) == [width - 2], regels

        screen.query_one("#prov", Select).value = "__all__"
        await pilot.pause()
        screen.query_one("#msearch").value = "grok"
        await pilot.pause()
        items = [("xai", "grok-3-mini-beta")]
        regels, width = _models_rows(screen)
        assert _provider_end_cells(regels, items) == [width - 2], regels

        screen.query_one("#msearch").value = ""
        await pilot.pause()
        regels, width = _models_rows(screen)
        assert _provider_end_cells(regels, MODELS_MIXED) == [width - 2] * len(MODELS_MIXED)


@pytest.mark.asyncio
async def test_models_row_id_and_pick_survive_the_right_aligned_row(tmp_roan):
    """De `id` blijft `provider|model`; de pick-handler splitst 'm erop."""
    from textual.widgets import OptionList

    from roan.tui import ModelsScreen

    gekozen = []
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(100, 30)) as pilot:
        await pilot.pause()
        screen = ModelsScreen(MODELS_MIXED, [], [])
        app.push_screen(screen, gekozen.append)
        await pilot.pause()
        listing = screen.query_one("#models-list", OptionList)
        ids = [listing.get_option_at_index(i).id for i in range(listing.option_count)]
        assert ids == [f"{p}|{m}" for p, m in MODELS_MIXED], ids
        listing.highlighted = 1
        await pilot.pause()
        await pilot.press("enter")
        await pilot.pause()
    assert gekozen == [MODELS_MIXED[1]], gekozen


@pytest.mark.asyncio
async def test_models_non_model_options_stay_plain_text(tmp_roan):
    """De lege-stand en de 'nog N modellen'-regel zijn geen modelrijen."""
    from textual.widgets import OptionList

    from roan.tui import ModelsScreen

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(80, 30)) as pilot:
        await pilot.pause()
        screen = ModelsScreen([("groq", f"m{i}") for i in range(405)], [], [])
        app.push_screen(screen)
        await pilot.pause()
        listing = screen.query_one("#models-list", OptionList)
        laatste = listing.get_option_at_index(listing.option_count - 1)
        assert laatste.id is None
        tekst = str(laatste.prompt)
        assert tekst == tekst.strip(), repr(tekst)

        screen.query_one("#msearch").value = "zzz"
        await pilot.pause()
        leeg = listing.get_option_at_index(0)
        assert leeg.id is None
        assert str(leeg.prompt) == str(leeg.prompt).strip(), repr(str(leeg.prompt))


# ---------- het portret zweeft rechtsboven over het gesprek ----------
# Het portret is een DIRECT kind van de App met `position: absolute`, dus het
# neemt geen rijen uit de flow: #messages begint op rij 0 en loopt onder het
# portret door. De chat hoort daar volgens de gebruiker bij; de eerste
# chatregel staat daarom op dezelfde rij als de bovenrand van het portret.
# De doos is 2 cells breder dan de tekening (de `round` rand), en `_place_avatar`
# zet de offset op schermbreedte min die buitenbreedte, zodat hij tegen de
# rechterrand plakt.


def _avatar_screen_rows(app) -> list[str]:
    """De getekende schermrijen waar het portret staat."""
    avatar = app.query_one("#avatar")
    strips = app.screen._compositor.render_strips()
    return [
        "".join(seg.text for seg in strips[y])
        for y in range(avatar.region.y, avatar.region.y + avatar.region.height)
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize("size", [(60, 26), (80, 24), (100, 50), (120, 40), (46, 20)])
async def test_avatar_sits_top_right_flush_against_the_edge(tmp_roan, size):
    """Het portret zweeft bovenaan tegen de rechterrand van het scherm.

    `position: absolute` kent geen 'right', dus de rand wordt met een offset
    berekend; die komt uit `_place_avatar`, dat de offset pas ná de volgende
    refresh zet omdat `on_resize` nog de oude schermmaat ziet.
    """
    app = RoanApp(FakeAgent())
    async with app.run_test(size=size) as pilot:
        await pilot.pause()
        avatar = app.query_one("#avatar")
        assert avatar.region.y == 0, avatar.region
        assert avatar.region.x > 0, "het portret hoort rechts, niet links"
        assert avatar.region.right == app.screen.size.width, (
            avatar.region,
            app.screen.size.width,
        )
        # het zweeft: het gesprek begint op rij 0, niet onder het portret
        assert app.query_one("#messages").region.y == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("size", [(60, 26), (80, 24), (100, 50)])
async def test_the_first_chat_line_shares_the_row_with_the_avatar_border(tmp_roan, size):
    """De bovenrand van het portret en de eerste chatregel staan op rij 0.

    Vóór deze wijziging stond het portret in een rij boven het gesprek, dus de
    eerste chatregel begon pas onder de 14 rijen van de doos. Nu loopt de chat
    eronderdoor: de sysline staat links van het portret, op dezelfde rij.
    """
    from roan.i18n import t

    app = RoanApp(FakeAgent())
    async with app.run_test(size=size) as pilot:
        await pilot.pause()
        avatar = app.query_one("#avatar")
        assert avatar.region.y == 0, avatar.region
        rij0 = _avatar_screen_rows(app)[0]
        # de bovenrand van de doos staat op rij 0
        assert rij0[avatar.region.x] == "╭", rij0
        # ...en de eerste chatregel staat ernaast, niet eronder
        assert app.query_one("#messages").region.y == 0
        # De systeemregel begint op rij 0, links van het portret. Op een smal
        # venster kappt het zwevende portret haar af, dus check het begin.
        sysline = t("ready", model="test-model", provider="lmstudio")
        links = rij0[: avatar.region.x]
        assert links.strip().startswith(sysline[: len(links.strip())]), (
            rij0[: avatar.region.x]
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("size", [(60, 26), (80, 24), (100, 50)])
async def test_the_floating_avatar_costs_no_extra_rows(tmp_roan, size):
    """`position: absolute` houdt het portret buiten de flow.

    Vóór deze wijziging stond het in een rij van `height: auto` boven het
    gesprek, dus #messages begon pas op rij 14. Nu vult het gesprek alles tussen
    schermtop en de footer, en blijft de statusbalk de laatste rij.
    """
    app = RoanApp(FakeAgent())
    async with app.run_test(size=size) as pilot:
        await pilot.pause()
        avatar = app.query_one("#avatar")
        messages = app.query_one("#messages")
        footer = app.query_one("#footer")
        assert avatar.styles.position == "absolute", avatar.styles.position
        assert avatar.layer == "overlay", avatar.layer
        assert messages.region.y == 0, messages.region
        assert messages.region.x == 0, messages.region
        assert messages.region.width == app.screen.size.width, messages.region
        assert messages.region.height + footer.region.height == app.screen.size.height
        status = app.query_one("#status")
        assert status.region.y + status.region.height == app.screen.size.height


@pytest.mark.asyncio
async def test_the_avatar_still_flush_right_and_unwrapped_after_a_resize(tmp_roan):
    """Na een resize staat het portret weer tegen de nieuwe rechterrand.

    Dat vraagt nu wél een berekening, want het portret zweeft en `position:
    absolute` kent geen 'right'. De offset wordt pas ná de volgende refresh
    gezet; anders rekende hij met de schermmaat van vóór de resize en zou het
    portret één resize achterlopen (zoals de oude zwevende ✕ deed).
    """
    from rich.cells import cell_len

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(100, 50)) as pilot:
        await pilot.pause()
        for size in [(60, 26), (33, 12), (120, 40), (80, 24), (100, 50)]:
            await pilot.resize_terminal(*size)
            await pilot.pause()
            avatar = app.query_one("#avatar")
            breedte, _ = app._avatar_outer()
            assert avatar.region.right == size[0], (size, avatar.region)
            assert avatar.region.x == size[0] - breedte, (size, avatar.region, breedte)
            # elke schermrij waar het portret staat is even breed: niets loopt om
            assert {cell_len(rij_) for rij_ in _avatar_screen_rows(app)} == {
                app.screen.size.width
            }, size


# ---------- de zwevende ✕ rechtsboven is weg ----------
# Die hoek hoort nu bij het portret. Sluiten kan nog met Ctrl+C en Ctrl+Q en
# met de ✕ in elke popup.


@pytest.mark.asyncio
async def test_app_has_no_close_button_in_the_corner(tmp_roan):
    from roan.tui import CLOSE_GLYPH

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(100, 50)) as pilot:
        await pilot.pause()
        assert not app.query("#app-close"), "de zwevende ✕ hoort weg"
        assert not app.query("#app-close")
        # en er wordt ook geen ✕ meer getekend
        for y in range(4):
            assert CLOSE_GLYPH not in _row_text(app.screen, y)
        # de popup-✕ blijft
        from roan.tui import SetupScreen

        scr = SetupScreen(provider="groq", model="m")
        app.push_screen(scr)
        await pilot.pause()
        assert scr.query_one("#close")


@pytest.mark.asyncio
@pytest.mark.parametrize("key", ["ctrl+c", "ctrl+q"])
async def test_ctrl_c_and_ctrl_q_still_quit_without_the_close_button(tmp_roan, key):
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(100, 50)) as pilot:
        await pilot.pause()
        await pilot.press(key)
        await pilot.pause()
        assert getattr(app, "_exit", False) is True or not app.is_running


# ---------- waar staat de ╹ ? ----------
# Er staan twee ╹ op het scherm, en allebei zijn ze bedoeld: één als
# promptmerker links in het invoerveld (Region(x=3, y=...)), en één ín de
# chafa-tekening van het portret. Niets zet er één rechtsbuiten het portret.


@pytest.mark.asyncio
async def test_the_input_box_has_no_hook_glyph(tmp_roan):
    """Het ╹ naast het invoerveld is weg; de gebruiker vond het een los teken.

    Wat overblijft is alleen de ╹ die ín de chafa-tekening zit (rij 6), en die
    staat binnen het avatar-widget.
    """
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(100, 50)) as pilot:
        await pilot.pause()
        avatar = app.query_one("#avatar")
        assert not app.query("#prompt-mark")

        box = app.query_one("#prompt-row")
        for y in range(box.region.y, box.region.y + box.region.height):
            for x, char in enumerate(_row_text(app.screen, y)):
                if char == "╹":
                    assert not (
                        box.region.x <= x < box.region.x + box.region.width
                    ), f"╹ linksboven in het inputkader op ({y},{x})"

        # De enige resterende ╹ zit binnen het portret.
        treffers = [
            (y, x)
            for y in range(app.screen.size.height)
            for x, char in enumerate(_row_text(app.screen, y))
            if char == "╹"
        ]
        for y, x in treffers:
            assert avatar.region.y <= y < avatar.region.y + avatar.region.height, (y, x)
            assert avatar.region.x <= x < avatar.region.x + avatar.region.width, (y, x)
@pytest.mark.asyncio
async def test_the_short_screen_avatar_has_no_hook_glyph_outside_the_artwork(tmp_roan):
    """Op een kort scherm is het portret een PNG-raster en blijft geen ╹ over.

    De tekening uit assets/avatar.ans is 12 rijen; past die niet, dan schaalt
    het raster uit de PNG en verdwijnt de ╹ uit de tekening. Er staat geen ╹ meer
    in het invoerveld (`#prompt-mark` bestaat niet meer), dus een eventuele ╹
    moet ín het portret zitten — nergens anders op het scherm. Het portret
    zweeft en plakt tegen de rechterrand van het scherm.
    """
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(80, 24)) as pilot:
        await pilot.pause()
        avatar = app.query_one("#avatar")
        assert not app.query("#prompt-mark"), "de ╹ in het invoerveld is weg"
        treffers = [
            (y, x)
            for y, rij in enumerate(
                _row_text(app.screen, y) for y in range(app.screen.size.height)
            )
            for x, char in enumerate(rij)
            if char == "╹"
        ]
        for y, x in treffers:
            assert avatar.region.y <= y < avatar.region.y + avatar.region.height, (y, x)
            assert avatar.region.x <= x < avatar.region.x + avatar.region.width, (y, x)
        # en het portret plakt tegen de rechterrand van het scherm
        assert avatar.region.right == app.screen.size.width, avatar.region


# ---------- de statusbalk: denkniveau klikbaar, bullets, één kleur ----------
STATUS_CHIPS = ("#status-thinking", "#status-mode", "#status-perm")


def _chip_cells(app, selector: str) -> list:
    """[(teken, kleur)] van alle zichtbare tekstcellen in een chip."""
    region = app.query_one(selector).region
    cellen = []
    x = 0
    for seg in app.screen._compositor.render_strips()[region.y]:
        for char in seg.text:
            if region.x <= x < region.right and char.strip():
                cellen.append((char, seg.style.color.triplet.hex.lower()))
            x += 1
    return cellen


def _bar_text(app) -> str:
    return _row_text(app.screen, app.query_one("#status-bar").region.y).rstrip()


@pytest.mark.asyncio
async def test_clicking_the_thinking_chip_cycles_all_four_levels(tmp_roan):
    """Het denkniveau is een knopje: off → low → medium → high → off.

    Dit was een bug: `#status-thinking` had geen Click-handler, dus de chip
    reageerde nergens op. Nu doet hij hetzelfde als modus en toestemming.
    """
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(110, 26)) as pilot:
        await pilot.pause()
        chip = app.query_one("#status-thinking")
        assert config.load_config()["thinking"] == "off"
        assert "off" in str(chip.render())
        for expected in ("low", "medium", "high", "off"):
            await pilot.click("#status-thinking")
            await pilot.pause()
            assert config.load_config()["thinking"] == expected
            assert str(chip.render()).endswith(f"Think: {expected}")
            # en een regel eronder bevestigt het, met de nieuwe naam erbij
            assert expected in str(list(app.query("#messages > *"))[-1].render())


@pytest.mark.asyncio
async def test_thinking_chip_is_clickable_on_every_level(tmp_roan):
    """Ook `high` moet door kunnen naar `off`, dus alle vier de niveaus werken."""
    config.save_config({"thinking": "high"})
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(110, 26)) as pilot:
        await pilot.pause()
        await pilot.click("#status-thinking")
        await pilot.pause()
        assert config.load_config()["thinking"] == "off"
        assert str(app.query_one("#status-thinking").render()).endswith("Think: off")


@pytest.mark.asyncio
async def test_the_whole_status_bar_is_grey_until_you_hover(tmp_roan):
    """De hele balk is grijs; hover maakt alleen de tekst roze, zonder vlak.

    Een vlak oplichten is precies wat de gebruiker niet wilde, dus de hover
    mag géén `background` zetten, alleen `color`.
    """
    selectors = ["#status", "#status-thinking", "#status-mode", "#status-perm", "#status-hints"]
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(110, 26)) as pilot:
        await pilot.pause()
        def _tekst(selector):
            # de ` · ` bullet is een scheider en heeft een eigen, gedempte kleur
            return {k for char, k in _chip_cells(app, selector) if char.strip() and char != "·"}

        rustig = {s: _tekst(s) for s in selectors}
        # Zelfde grijstoon over de hele balk.
        assert len({tuple(sorted(map(str, v))) for v in rustig.values()}) == 1, rustig

        chip = app.query_one("#status-perm")
        voor = _chip_cells(app, "#status-perm")
        await pilot.hover("#status-perm", offset=(3, 0))
        await pilot.pause()
        na = _chip_cells(app, "#status-perm")
        # tekst roze geworden
        assert [k for c, k in na if c.strip()] != [k for c, k in voor if c.strip()], (
            "hover veranderde de tekstkleur niet"
        )
        # ...maar geen enkele cel een andere achtergrond
        assert chip.styles.background.a == 0, chip.styles.background
        # en de rest is grijs gebleven
        for s in selectors:
            if s == "#status-perm":
                continue
            assert _tekst(s) == rustig[s], s


@pytest.mark.asyncio
async def test_status_row_reads_think_mode_approvals(tmp_roan):
    """De balk zegt waar de drie chips ophangen, met ` · ` ertussen."""
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(110, 26)) as pilot:
        await pilot.pause()
        row = _bar_text(app)
        assert row.endswith(
            "Think: off  ·  Mode: Chat  ·  Approvals: Auto  ·  ctrl+p commands"
        ), row
        # links blijft model · provider zoals het was
        assert row.startswith("  ◆ test-model  ·  lmstudio"), row


@pytest.mark.asyncio
async def test_status_row_capitalises_the_mode_without_touching_the_config(tmp_roan):
    """`Chat` op het scherm, `chat` in de config."""
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(110, 26)) as pilot:
        await pilot.pause()
        assert "Mode: Chat" in _bar_text(app)
        assert config.load_config()["mode"] == "chat"


@pytest.mark.asyncio
async def test_the_status_chips_are_grey_not_accent(tmp_roan):
    """Alles in de onderbalk is grijs; alleen bij hover wordt de tekst roze.

    Twee dingen zaten hier tegen elkaar in: de helft van de balk was roze en de
    helft grijs, en het accent stond als Rich-markup IN de tekst, waardoor de
    CSS de kleur niet kon overnemen en `:hover` niets meer deed.
    """
    from roan.themes import THEME_BY_NAME

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(110, 26)) as pilot:
        await pilot.pause()
        thema = THEME_BY_NAME[app.theme]
        accent = str(thema.accent).lower()
        selectors = list(STATUS_CHIPS) + ["#status-hints", "#status"]
        for selector in selectors:
            celen = _chip_cells(app, selector)
            assert celen, selector
            tekst = {kleur for char, kleur in celen if char.strip()}
            for kleur in tekst:
                assert kleur.lower() != accent, (
                    f"{selector} tekent nog in het accent: {kleur}"
                )
        # Ze delen allemaal dezelfde grijstoon.
        grijs = [
            {kleur for char, kleur in _chip_cells(app, s) if char.strip()}
            for s in selectors
        ]
        assert grijs[0] == grijs[-1], grijs


@pytest.mark.asyncio
async def test_the_bullets_between_the_status_chips_are_dim(tmp_roan):
    """De ` · ` ertussen is een scheider, geen chip: dus niet in het accent."""
    from roan.themes import accent_color

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(110, 26)) as pilot:
        await pilot.pause()
        accent = accent_color().lower()
        for selector in STATUS_CHIPS[1:] + ("#status-hints",):
            cellen = _chip_cells(app, selector)
            bullets = [kleur for char, kleur in cellen if char == "·"]
            assert len(bullets) == 1, (selector, bullets)
            assert bullets[0] != accent, (selector, bullets[0])
        # de eerste chip begint zonder bullet, dus niets aan het begin
        eerste = [char for char, _ in _chip_cells(app, STATUS_CHIPS[0])]
        assert "·" not in eerste, eerste


@pytest.mark.asyncio
async def test_status_bar_never_clips_the_model_at_any_width(tmp_roan):
    """Bij 60, 80, 100 en 140 kolommen past de balk en blijft de linkerkant heel.

    De chiptekst is nu langer (`Think: medium`), dus de drempels in
    `STATUS_FITS` staan verder omhoog dan eerst.
    """
    for width in (60, 80, 100, 140):
        app = RoanApp(FakeAgent())
        async with app.run_test(size=(width, 26)) as pilot:
            await pilot.pause()
            row = _bar_text(app)
            bar = app.query_one("#status-bar")
            assert bar.region.height == 1, width
            assert bar.region.y == 25, width
            assert "◆ test-model  ·  lmstudio" in row, (width, row)
            # niets loopt de balk uit en geen enkele chip is gekneed
            assert len(row) <= width, (width, row)
            for selector in ("#status", *STATUS_CHIPS, "#status-hints"):
                node = app.query_one(selector)
                if not node.display:
                    continue
                if selector == "#status":
                    continue
                assert node.region.width == len(str(node.render())) + 2, (
                    width,
                    selector,
                )


@pytest.mark.asyncio
async def test_status_bar_fits_with_token_usage_too(tmp_roan):
    """Met verbruik erbij is het rijtje het langst; dan past het vanaf 122."""
    agent = FakeAgent()
    agent.usage = {"prompt": 12345, "completion": 900}
    config.save_config({"context_window": 200000})
    app = RoanApp(agent)
    async with app.run_test(size=(140, 26)) as pilot:
        await pilot.pause()
        row = _bar_text(app)
        assert "12.3K (6%)" in row, row
        assert "◆ test-model  ·  lmstudio" in row, row
        assert len(row) <= 140, row
    # op 110 past het verbruik er niet bij, maar het model wel
    app = RoanApp(agent)
    async with app.run_test(size=(110, 26)) as pilot:
        await pilot.pause()
        row = _bar_text(app)
        assert app.query_one("#status-tokens").display is False
        assert "◆ test-model  ·  lmstudio" in row, row
        assert len(row) <= 110, row


@pytest.mark.asyncio
async def test_status_bar_ladder_shows_more_chips_the_wider_it_gets(tmp_roan):
    """De drempels staan in een vaste volgorde: hoe breder, hoe meer chips."""
    gates = {
        60: ["#status-hints"],
        80: ["#status-perm", "#status-hints"],
        100: ["#status-mode", "#status-perm", "#status-hints"],
        140: ["#status-thinking", "#status-mode", "#status-perm", "#status-hints"],
    }
    for width, expected in gates.items():
        app = RoanApp(FakeAgent())
        async with app.run_test(size=(width, 26)) as pilot:
            await pilot.pause()
            shown = [
                selector
                for selector in (
                    "#status-tokens",
                    "#status-thinking",
                    "#status-mode",
                    "#status-perm",
                    "#status-hints",
                )
                if app.query_one(selector).display
            ]
            assert shown == expected, (width, shown)


@pytest.mark.asyncio
async def test_hidden_chips_take_their_bullet_with_them(tmp_roan):
    """Geen losse ` · ` aan het begin van het rijtje, wel één ervoor.

    De bullet zit in het stukje dat volgt, dus een weggezet stukje neemt zijn
    bullet mee; het eerste zichtbare stukje begint dus zonder bullet.
    """
    per_breedte = {
        60: ["·  ctrl+p commands"],
        80: ["Approvals: Auto", "·  ctrl+p commands"],
        100: ["Mode: Chat", "·  Approvals: Auto", "·  ctrl+p commands"],
        140: [
            "Think: off",
            "·  Mode: Chat",
            "·  Approvals: Auto",
            "·  ctrl+p commands",
        ],
    }
    for width, expected in per_breedte.items():
        app = RoanApp(FakeAgent())
        async with app.run_test(size=(width, 26)) as pilot:
            await pilot.pause()
            texts = [
                str(app.query_one(selector).render())
                for selector in (
                    "#status-tokens",
                    "#status-thinking",
                    "#status-mode",
                    "#status-perm",
                    "#status-hints",
                )
                if app.query_one(selector).display and app.query_one(selector).render()
            ]
            assert texts == expected, (width, texts)


@pytest.mark.asyncio
async def test_ctrl_p_hint_stays_clickable_at_the_narrowest_width(tmp_roan):
    """ctrl+p staat buiten de drempellijst en blijft dus overal klikbaar."""
    from roan.tui import CommandScreen

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(60, 26)) as pilot:
        await pilot.pause()
        hints = app.query_one("#status-hints")
        assert hints.display is True
        assert "ctrl+p commands" in _bar_text(app)
        await pilot.click("#status-hints")
        await pilot.pause()
        assert isinstance(app.screen, CommandScreen)


@pytest.mark.asyncio
async def test_the_bullet_follows_a_resize(tmp_roan):
    """Na een resize schuift de bullet mee: het eerste stukje heeft er geen.

    Anders blijft er een ` · ` aan het begin van het rijtje staan zodra een
    chip wegvalt, of verdwijnt hij juist terwijl hij er nog moet staan.
    """
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(110, 26)) as pilot:
        await pilot.pause()
        assert app.query_one("#status-thinking").display is True
        assert str(app.query_one("#status-thinking").render()) == "Think: off"

        await pilot.resize_terminal(80, 26)
        await pilot.pause()
        assert app.query_one("#status-thinking").display is False
        assert str(app.query_one("#status-perm").render()) == "Approvals: Auto"
        assert "·" not in _bar_text(app).split("lmstudio")[-1].split("Approvals")[0]

        await pilot.resize_terminal(110, 26)
        await pilot.pause()
        assert str(app.query_one("#status-thinking").render()) == "Think: off"
        assert str(app.query_one("#status-perm").render()) == "·  Approvals: Auto"
        assert _bar_text(app).endswith(
            "Think: off  ·  Mode: Chat  ·  Approvals: Auto  ·  ctrl+p commands"
        )

# =====================================================================
# Vijf kleine metingen: de bullet blijft grijs op hover, `Approvals: Auto`,
# de providerkiezer flush rechts, één kolom naast de modellenlijst, en de
# kleuren van de scrollbalk.
# =====================================================================


def _bullet_and_word(app, selector):
    """(kleur, vet) van de ` · ` in een chip, en van het woord erna."""
    node = app.query_one(selector)
    region = node.region
    x = region.x + node.styles.padding.left
    bullet = _cell_style(app, x, region.y)
    word = _cell_style(app, x + 3, region.y)
    return (bullet.color.triplet.hex.lower(), bool(bullet.bold)), (
        word.color.triplet.hex.lower(),
        bool(word.bold),
    )


def _scrollbar_columns(app, listing):
    """Per rij van de lijst: (kleur, achtergrond) van de laatste kolom."""
    x = listing.region.x + listing.region.width - 1
    return [
        (
            _cell_style(app, x, y).color.triplet.hex.lower(),
            _cell_style(app, x, y).bgcolor.triplet.hex.lower(),
        )
        for y in range(listing.region.y, listing.region.bottom)
    ]


MODELS_MANY = [(f"provider-{i % 3}", f"model-met-een-lange-naam-{i:03d}") for i in range(60)]


@pytest.mark.asyncio
async def test_hover_leaves_the_bullet_between_the_chips_alone(tmp_roan):
    """Op :hover wordt alleen het WOORD roze; de ` · ` blijft precies zoals hij was.

    `[dim]` in de markup is een relatieve stijl: Textual dimt de kleur die het
    widget op dat moment heeft, dus de bullet kreeg op hover de pink mee
    (`#a988a5`) en werd bovendien vet. De bullet staat nu als absolute kleur in
    de markup, dus geen widget-CSS en ook `:hover { text-style: bold }` kan hem
    nog raken.
    """
    from roan.themes import PINK

    pink = PINK["mocha"].lower()
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(110, 26)) as pilot:
        await pilot.pause()
        for selector in STATUS_CHIPS[1:] + ("#status-hints",):
            chip = app.query_one(selector)
            assert chip.display is True, selector
            assert str(chip.render()).startswith("·"), selector
            voor_bullet, voor_woord = _bullet_and_word(app, selector)
            await pilot.hover(selector, offset=(4, 0))
            await pilot.pause()
            na_bullet, na_woord = _bullet_and_word(app, selector)
            # de bullet is onveranderd, kleur EN gewicht
            assert na_bullet == voor_bullet, (selector, voor_bullet, na_bullet)
            # ...en is nog steeds de gedempte grijs, niet de pink
            assert na_bullet[0] != pink, (selector, na_bullet)
            # het woord erop turns wél roze (en vet)
            assert na_woord[0] == pink, (selector, na_woord)
            assert na_woord != voor_woord, (selector, voor_woord, na_woord)


@pytest.mark.asyncio
async def test_the_bullet_is_one_grey_for_every_chip_and_follows_the_theme(tmp_roan):
    """Alle bullets zijn dezelfde gedempte grijs, en ze volgen het thema mee.

    De kleur wordt uit de eigen CSS-regels van de chip berekend in plaats van
    vastgespikkeld, dus elke Catppuccin-smaak krijgt zijn eigen gedempte grijs.
    """
    per_thema = {}
    for thema in ("mocha", "latte", "frappe", "macchiato"):
        app = RoanApp(FakeAgent())
        async with app.run_test(size=(110, 26)) as pilot:
            await pilot.pause()
            app.theme = thema
            await pilot.pause()
            # de balk schildert zichzelf op de volgende `_update_status`
            app._update_status()
            await pilot.pause()
            kleuren = set()
            for selector in STATUS_CHIPS[1:] + ("#status-hints",):
                bullet, _woord = _bullet_and_word(app, selector)
                kleuren.add(bullet)
            assert len(kleuren) == 1, (thema, kleuren)
            per_thema[thema] = kleuren.pop()
    assert per_thema["mocha"] == ("#73737a", False), per_thema
    # vier smaken, dus vier eigen grijzen: het is echt afgeleid, niet vastgezet
    assert len({kleur for kleur, _ in per_thema.values()}) == 4, per_thema


@pytest.mark.asyncio
async def test_the_permissions_value_is_capitalised_on_screen_only(tmp_roan):
    """`Approvals: Auto`/`User` op het scherm, `auto`/`user` in de config."""
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(110, 26)) as pilot:
        await pilot.pause()
        for waarde in ("auto", "user"):
            config.save_config(
                {
                    "provider": "lmstudio",
                    "model": "test-model",
                    "tui": "default",
                    "permissions": waarde,
                }
            )
            app._update_status()
            await pilot.pause()
            assert config.load_config()["permissions"] == waarde
            assert str(app.query_one("#status-perm").render()) == (
                f"·  Approvals: {waarde.capitalize()}"
            )
            assert f"Approvals: {waarde.capitalize()}" in _bar_text(app)
            # de modus doet hetzelfde, en blijft ook klein in de config
            assert str(app.query_one("#status-mode").render()) == "·  Mode: Chat"
            assert config.load_config()["mode"] == "chat"


@pytest.mark.asyncio
async def test_the_provider_select_ends_flush_right(tmp_roan):
    """#prov eindigt precies op de rand van het popup; #cat houdt 2 kolomen lucht."""
    from roan.tui import ModelsScreen

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(80, 30)) as pilot:
        await pilot.pause()
        screen = ModelsScreen(MODELS_MIXED, [], [])
        app.push_screen(screen)
        await pilot.pause()
        box = screen.query_one("#models-box")
        cat = screen.query_one("#cat")
        prov = screen.query_one("#prov")
        content = box.content_region
        rand = content.x + content.width  # de kolom ná de laatste van het popup
        # flush: geen enkele kolom lucht meer tussen #prov en die rand
        assert prov.region.x + prov.region.width == rand, (prov.region, content)
        # tussen de twee kiezers blijven er twee lege kolommen staan
        assert prov.region.x - (cat.region.x + cat.region.width) == 2, (
            cat.region,
            prov.region,
        )
        assert cat.region.x + cat.region.width < rand


@pytest.mark.asyncio
async def test_one_clear_column_between_the_models_list_and_its_scrollbar(tmp_roan):
    """Precies één kolom lucht tussen het eind van de rij en de scrollbar.

    Vóór stond die kolom aan de ANDERE kant van de scrollbar (tussen scrollbar
    en rand van het popup), waar hij niets deed: de gemarkeerde rij liep
    meteen in de scrollbar. `margin-right`/`padding-right` kunnen dat niet
    repareren, want Textual tekent de scrollbar altijd tegen de rechterrand
    van de inwendige breedte (gemeten in 8.2.8). Dus is de rij zelf één kolom
    korter dan de lijst; de scrollbar staat nu tegen de rand van het popup.

    Geen scrollbar = geen scrollbalk, dus hier is een lijst nodig die echt te
    scrollen is: 60 modellen in een popup van 80x30.
    """
    from textual.widgets import OptionList

    from roan.tui import SCROLLBAR_GAP, ModelsScreen

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(80, 30)) as pilot:
        await pilot.pause()
        screen = ModelsScreen(MODELS_MANY, [], [])
        app.push_screen(screen)
        await pilot.pause()
        box = screen.query_one("#models-box")
        listing = screen.query_one("#models-list", OptionList)
        assert listing.show_vertical_scrollbar is True, "geen scrollbar om te meten"
        assert listing.max_scroll_y > 0, "lijst die niet te scrollen is"
        rand = box.content_region.right - 1  # laatste kolom van het popup
        laatste = listing.region.right - 1  # laatste kolom van de lijst
        # De lijst eindigt nu tegen de rand van het popup: geen marge meer.
        assert laatste == rand, (listing.region, box.content_region)
        assert listing.scrollbar_size_vertical == 2
        sb_links = laatste - 1  # eerste kolom van de scrollbar
        # Eén kolom lucht: de rij stopt op `sb_links - 2`, kolom `sb_links - 1`
        # blijft leeg.
        regel = _row_text(app.screen, listing.region.y)
        assert "model-met-een-lange-naam-000" in regel, regel
        assert "provider-0" in regel, regel
        laatste_tekst = max(i for i, teken in enumerate(regel[: sb_links + 1]) if teken != " ")
        assert laatste_tekst == sb_links - 1 - SCROLLBAR_GAP, (
            laatste_tekst,
            sb_links,
            regel[laatste_tekst - 2 : sb_links + 2],
        )
        assert regel[sb_links - 1] == " ", regel[sb_links - 3 : sb_links + 2]
        # en de duum van de scrollbar is nog altijd van het spoor te onderscheiden
        duim = _cell_style(app, sb_links, listing.region.y + 1)
        spoor = _cell_style(app, sb_links, listing.region.bottom - 1)
        assert duim.color.triplet.hex.lower() != spoor.color.triplet.hex.lower(), (
            "geen duim en spoor te onderscheiden"
        )


@pytest.mark.asyncio
async def test_every_model_row_still_ends_on_the_same_column_after_the_gap(tmp_roan):
    """De luchtkolom kost een kolom, maar de rijen blijven één regel en één kolom korter.

    `text-wrap: nowrap` en de opvulling in `_row` lopen over de breedte van de
    lijst min die één kolom, dus die wordt één kolom smaller; de provider moet
    daarna nog steeds op precies dezelfde kolom eindigen.
    """
    from textual.widgets import OptionList

    from roan.tui import SCROLLBAR_GAP, ModelsScreen

    veel = [
        ("groq", "kort"),
        ("cerebras", "qwen3-coder-480b-a35b-instruct-2507"),
        ("xai", "grok-3-mini-beta"),
        ("openai", "gpt-5-nano"),
    ]
    veel = [(f"{p}-{i}", m) for i in range(15) for p, m in veel]
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(80, 30)) as pilot:
        await pilot.pause()
        screen = ModelsScreen(veel, [], [])
        app.push_screen(screen)
        await pilot.pause()
        listing = screen.query_one("#models-list", OptionList)
        regels, width = _models_rows(screen)
        zichtbaar = veel[: len(regels)]
        assert len(regels) == len(zichtbaar), (len(regels), len(veel))
        assert listing.show_vertical_scrollbar is True, "scrollbar meetbaar nodig"
        # één regel per model, en niets groeit een kolom
        assert all(hoogte == 1 for hoogte in listing._line_cache.heights.values())
        assert {len(regel) for regel in regels} == {width - SCROLLBAR_GAP}, (
            set(map(len, regels)),
            width,
        )
        # en de provider eindigt op elke rij op dezelfde kolom, één vóór het gat
        assert _provider_end_cells(regels, zichtbaar) == [width - 2] * len(zichtbaar), width
        # de lijst is twee scrollbarkolommen smaller dan het popup; de rij nog één
        box = screen.query_one("#models-box")
        assert width == box.content_region.width - 2, (width, box.content_region)


@pytest.mark.asyncio
async def test_the_scrollbar_thumb_is_pink_and_its_track_matches_the_searchbar(tmp_roan):
    """Duim = de pink van het thema, spoor = de achtergrond van het zoekveld.

    Vóór deze meting was de duim grijs (`$scrollbar`) en het spoor `$surface`
    (`$scrollbar-background`), dus een losse donkere strook naast een grijs
    invoerveld. Nu is het spoor precies het paneelkleur van het thema.
    """
    from textual.widgets import OptionList

    from roan.themes import THEME_BY_NAME
    from roan.tui import ModelsScreen

    for thema in ("mocha", "latte", "frappe", "macchiato"):
        app = RoanApp(FakeAgent())
        async with app.run_test(size=(80, 30)) as pilot:
            await pilot.pause()
            app.theme = thema
            await pilot.pause()
            screen = ModelsScreen(MODELS_MANY, [], [])
            app.push_screen(screen)
            await pilot.pause()
            listing = screen.query_one("#models-list", OptionList)
            assert listing.show_vertical_scrollbar is True, thema
            pink = str(THEME_BY_NAME[thema].primary).lower()
            paneel = str(THEME_BY_NAME[thema].panel).lower()
            kolommen = _scrollbar_columns(app, listing)
            duim = {bg for fg, bg in kolommen if fg == pink}
            spoor = {bg for fg, bg in kolommen if fg != pink}
            assert duim, (thema, "geen duim in het accent", kolommen)
            assert spoor, (thema, "geen spoor", kolommen)
            # het spoor is het paneelkleur van het thema...
            assert spoor == {paneel}, (thema, spoor, paneel)
            # ...dus precies wat het zoekveld ernaast als achtergrond heeft
            zoekveld = screen.query_one("#msearch")
            stijl = _cell_style(app, zoekveld.region.x + 3, zoekveld.region.y)
            assert stijl.bgcolor.triplet.hex.lower() == paneel, (
                thema,
                stijl.bgcolor,
                paneel,
            )


def test_every_flavour_keeps_pink_thumb_and_panel_track():
    """Alle vier de smaken: duim = eigen pink, spoor = eigen paneelkleur."""
    from roan import themes as themes_module
    from roan.themes import DEFAULT_THEME, PINK, THEME_NAMES, THEMES
    from textual.theme import BUILTIN_THEMES

    assert THEME_NAMES == ("latte", "frappe", "macchiato", "mocha")
    assert DEFAULT_THEME == "mocha"
    # de losse SCROLLBAR-tabel is weg: de duim is nu overal de eigen pink
    assert not hasattr(themes_module, "SCROLLBAR")
    for thema in THEMES:
        pink = PINK[thema.name]
        paneel = BUILTIN_THEMES[f"catppuccin-{thema.name}"].panel
        variables = thema.variables
        assert variables["scrollbar"] == pink, thema.name
        assert variables["scrollbar-hover"] == pink, thema.name
        assert variables["scrollbar-active"] == pink, thema.name
        assert variables["scrollbar-background"] == paneel, thema.name


# ---------- de tekst loopt om het zwevende portret heen ----------
# Vóór deze wijziging liep het gesprek vol breed door en tekende het zwevende
# portret erover heen, wat afgebroken tekst leek. Nu is voor de rijen die het
# portret beslaat zijn linkerrand de rechterrand: een bericht breekt vóór het
# kader af en er komt geen teken onder. `_apply_avatar_wrap` in roan/tui.py
# rekent dat uit; de tests hieronder leggen het gedrag vast.

# Lang genoeg om over de bandgrens heen te lopen.
LANG = (
    "Dit is een vrij lange regel tekst die over de hele breedte loopt om te "
    "zien waar hij afgebroken wordt, en die dus netjes voor het zwevende "
    "portret moet blijven liggen in plaats van eronderdoor."
)


async def _breedtes_vast(pilot, ronden: int = 4) -> None:
    """Laat de breedtes van het gesprek vastliggen.

    Een andere breedte verandert de hoogtes, en dus de plek van het volgende
    bericht; de berekening loopt daarom net als een layout in rondes. Vier
    `pause()`'s zijn ruim voldoende (gemeten: 2 tot 3 ronden).
    """
    for _ in range(ronden):
        await pilot.pause()


def _avatar_cellen(app) -> list[str]:
    """De cellen die het portret ZELF tekent: zijn rand om zijn tekening.

    Zo kan de test de getekende rechthoek van het portret vergelijken met wat
    het portret hoort te tekenen, en dus zien of er iets anders ertussen zit.
    """
    avatar = app.query_one("#avatar")
    regio = avatar.region
    kunst = avatar.content.plain.split("\n")
    cellen = []
    for rij_index in range(regio.height):
        rij = [" "] * regio.width
        if rij_index == 0:
            rij[0], rij[-1] = "╭", "╮"
            rij[1:-1] = ["─"] * (regio.width - 2)
        elif rij_index == regio.height - 1:
            rij[0], rij[-1] = "╰", "╯"
            rij[1:-1] = ["─"] * (regio.width - 2)
        else:
            rij[0], rij[-1] = "│", "│"
            kunst_rij = kunst[rij_index - 1] if rij_index - 1 < len(kunst) else ""
            for x, teken in enumerate(kunst_rij[: regio.width - 2]):
                rij[x + 1] = teken
        cellen.append("".join(rij))
    return cellen


def _raakt_band(regio, band) -> bool:
    """Of een bericht één van de rijen van het portret raakt."""
    return regio.y < band.bottom and regio.bottom > band.y


def _smalle_breedtes(kind) -> int | None:
    """De breedte in cellen die wij hebben gezet, of None (dus `auto`)."""
    from roan.tui import _cellen

    return _cellen(kind.styles.width)


@pytest.mark.asyncio
async def test_the_chat_wraps_before_the_avatar(tmp_roan):
    """Voor de rijen van het portret is zijn linkerrand de rechterrand.

    Per cel gecontroleerd: elk teken in de rechthoek van het portret is van
    het portret zelf (dus geen chattekst), geen enkel bericht komt onder die
    rechthoek, en de kolom ertussen is leeg.
    """
    from textual.geometry import Region
    from textual.widgets import Markdown, Static

    from roan.tui import AVATAR_WRAP_GAP

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(60, 26)) as pilot:
        await pilot.pause()
        msgs = app.query_one("#messages")
        msgs.remove_children()
        await pilot.pause()
        app._write(Static(f"0 {LANG}"))
        app._write(Markdown(f"1 {LANG}"))
        await _breedtes_vast(pilot)

        band = app.query_one("#avatar").region
        assert band == Region(x=34, y=0, width=26, height=14), band
        # de band die wij rekenen is de gemeten rechthoek van het portret
        assert app._avatar_band() == band, app._avatar_band()

        # 1. elk teken in de rechthoek van het portret is van het portret zelf
        rijen = _avatar_screen_rows(app)
        verwacht = _avatar_cellen(app)
        for i, rij in enumerate(rijen):
            assert rij[band.x : band.x + band.width] == verwacht[i], (
                f"rij {band.y + i} is overschreven",
                rij[band.x : band.x + band.width],
                verwacht[i],
            )

        # 2. geen enkel bericht komt onder het portret; wat erin ligt is smaller
        #    met precies de luchtkolom ertussen
        in_band = 0
        for kind in msgs.children:
            if not _raakt_band(kind.region, band):
                assert _smalle_breedtes(kind) is None, (
                    kind.region,
                    kind.styles.width,
                )
                continue
            in_band += 1
            assert _smalle_breedtes(kind) is not None, kind.styles.width
            assert kind.region.right == band.x - AVATAR_WRAP_GAP, kind.region
        assert in_band >= 2, "beide berichten horen in de band te staan"

        # 3. de luchtkolom is leeg op elke rij die het portret beslaat
        lucht = band.x - AVATAR_WRAP_GAP
        for i, rij in enumerate(rijen):
            assert rij[lucht] == " ", f"rij {band.y + i}, kolom {lucht}: {rij!r}"


@pytest.mark.asyncio
@pytest.mark.parametrize("size", [(60, 26), (100, 50)])
async def test_a_message_below_the_avatar_uses_the_whole_width(tmp_roan, size):
    """Onder het portret geldt de gewone volle breedte weer.

    De breedte blijft daar leeg, dus `auto`: het bericht vult de hele lijst en
    hoeft niets te weten van het portret.
    """
    from textual.widgets import Markdown, Static

    app = RoanApp(FakeAgent())
    async with app.run_test(size=size) as pilot:
        await pilot.pause()
        msgs = app.query_one("#messages")
        msgs.remove_children()
        await pilot.pause()
        for n in range(10):
            app._write(Markdown(f"- vulruimte {n}"))
        app._write(Static(f"ONDER {LANG}"))
        await _breedtes_vast(pilot)

        band = app._avatar_band()
        laatste = msgs.children[-1]
        assert laatste.region.y >= band.bottom, laatste.region
        assert _smalle_breedtes(laatste) is None, laatste.styles.width
        smalle = [k for k in msgs.children if _raakt_band(k.region, band)]
        assert smalle, "er moeten smalle berichten zijn"
        assert laatste.region.width > min(k.region.width for k in smalle)


@pytest.mark.asyncio
async def test_scrolling_narrows_and_widens_the_messages_beside_the_avatar(tmp_roan):
    """Scrollen wisselt de breedte: die erin komen smal, die eruit gaan breed.

    Zonder dit zou de tekst blijven afbreken op de plek waar een bericht
    toevallig stond toen het scherm in beeld kwam.
    """
    from textual.widgets import Markdown

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(60, 26)) as pilot:
        await pilot.pause()
        msgs = app.query_one("#messages")
        msgs.remove_children()
        await pilot.pause()
        for n in range(12):
            app._write(Markdown(f"bericht {n} {LANG}"))
        await _breedtes_vast(pilot)
        msgs.scroll_home(animate=False)
        await _breedtes_vast(pilot)

        band = app._avatar_band()
        voor = {id(k): _smalle_breedtes(k) for k in msgs.children}
        assert any(breedte is not None for breedte in voor.values()), "bovenin smal"

        await pilot.press("pagedown")
        await _breedtes_vast(pilot)

        # wie in de band staat is smal, wie er buiten staat vol breed
        for kind in msgs.children:
            breedte = _smalle_breedtes(kind)
            if _raakt_band(kind.region, band):
                assert breedte is not None, (kind.region, voor[id(kind)])
                assert kind.region.right == band.x - 1, kind.region
            else:
                assert breedte is None, (kind.region, voor[id(kind)])
        # en het is allebei gebeurd: iemand werd breed en iemand werd smal
        gewijzigd = [
            (kind.region.y, voor[id(kind)], _smalle_breedtes(kind))
            for kind in msgs.children
            if voor[id(kind)] != _smalle_breedtes(kind)
        ]
        assert any(van is not None and naar is None for _, van, naar in gewijzigd), (
            "niemand ging van smal naar breed",
            gewijzigd,
        )
        assert any(van is None and naar is not None for _, van, naar in gewijzigd), (
            "niemand ging van breed naar smal",
            gewijzigd,
        )


@pytest.mark.asyncio
async def test_two_hundred_messages_keep_the_wrap_cheap_while_scrolling(tmp_roan):
    """Met 200 berichten mag scrollen niet duur worden.

    De pass hoeft niet alle berichten te bezoeken: hij stopt bij het eerste
    bericht onder het portret, en schrijft alleen een breedte als die echt
    verandert. Gemeten: 0,1 ms per pass bij 200 berichten, en dat is ná een
    scroll, dus als de compositor-map nog ongeldig is.
    """
    import statistics
    import time

    from textual.widgets import Markdown

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(60, 26)) as pilot:
        await pilot.pause()
        msgs = app.query_one("#messages")
        msgs.remove_children()
        await pilot.pause()
        for n in range(200):
            app._write(Markdown(f"bericht {n}. {LANG}"))
        await _breedtes_vast(pilot, 5)
        assert len(msgs.children) == 200

        msgs.scroll_home(animate=False)
        await _breedtes_vast(pilot)
        tijden = []
        for _ in range(25):
            msgs.scroll_to(y=msgs.scroll_y + 5, animate=False)
            await pilot.pause()
            t0 = time.perf_counter()
            app._apply_avatar_wrap()
            tijden.append(time.perf_counter() - t0)
        mediaan = statistics.median(tijden)
        print(f"\n  pass over 200 berichten: mediaan {mediaan * 1000:.3f} ms")
        assert mediaan < 0.010, f"de pass werd duur: {mediaan * 1000:.3f} ms"
        # en na al dat scrollen kloppen de breedtes nog steeds
        band = app._avatar_band()
        for kind in msgs.children:
            assert (_smalle_breedtes(kind) is not None) == _raakt_band(
                kind.region, band
            ), kind.region


@pytest.mark.asyncio
async def test_without_an_avatar_no_message_stays_narrow(tmp_roan):
    """Geen portret? Dan blijft er geen enkel bericht smal staan.

    Anders zou een bericht nog smal blijven nadat het portret bij een ander
    schermformaat of zonder afbeelding verdwenen is.
    """
    from textual.widgets import Markdown

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(60, 26)) as pilot:
        await pilot.pause()
        msgs = app.query_one("#messages")
        msgs.remove_children()
        await pilot.pause()
        for n in range(6):
            app._write(Markdown(f"{n} {LANG}"))
        await _breedtes_vast(pilot)
        assert [k for k in msgs.children if _smalle_breedtes(k) is not None], (
            "sanity: er moeten smalle berichten zijn"
        )

        await app.query_one("#avatar").remove()
        await _breedtes_vast(pilot)
        assert app._avatar_band() is None
        for kind in msgs.children:
            assert _smalle_breedtes(kind) is None, (kind.region, kind.styles.width)


@pytest.mark.asyncio
async def test_without_an_avatar_file_nothing_is_narrowed(
    tmp_roan, tmp_path, monkeypatch
):
    """Zonder avatar-bestand is er geen band en blijft alles vol breed."""
    from textual.widgets import Markdown

    import roan.tui as tui

    monkeypatch.setattr(tui, "BUNDLED_AVATAR", tmp_path / "er-is-geen-foto.png")
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(60, 26)) as pilot:
        await pilot.pause()
        assert not list(app.query("#avatar")), "er hoort geen portret te zijn"
        msgs = app.query_one("#messages")
        for n in range(3):
            app._write(Markdown(f"{n} {LANG}"))
        await _breedtes_vast(pilot)
        assert app._avatar_band() is None
        assert [k.styles.width for k in msgs.children] == [None] * len(msgs.children)


@pytest.mark.asyncio
async def test_a_message_that_straddles_the_avatar_stays_narrow_all_the_way(tmp_roan):
    """Eén widget heeft één breedte: wie over de bandgrens loopt is helemaal smal.

    Dit is de enige plek waar dit afwijkt van een tekstverwerker. Splitsen zou
    `render_lines` en een herbouw van het Markdown uit losse regels vergen, en
    dat verliest links en klikhandlers. Vastgelegd, zodat het een bewuste keuze
    blijft en niet per ongeluk verandert.
    """
    from textual.widgets import Markdown

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(60, 26)) as pilot:
        await pilot.pause()
        msgs = app.query_one("#messages")
        msgs.remove_children()
        await pilot.pause()
        app._write(Markdown(f"0 {LANG}"))
        app._write(Markdown(f"1 {LANG}"))
        await _breedtes_vast(pilot)

        band = app._avatar_band()
        over = [k for k in msgs.children if k.region.y < band.bottom < k.region.bottom]
        assert over, "er hoort een bericht over de grens te staan"
        for kind in over:
            assert _smalle_breedtes(kind) is not None, kind.styles.width
            assert kind.region.right == band.x - 1, kind.region


@pytest.mark.asyncio
@pytest.mark.parametrize("size", [(60, 26), (80, 24), (100, 50)])
async def test_a_resize_recalculates_the_width_beside_the_avatar(tmp_roan, size):
    """Na een resize staat het portret op een andere plek, dus de breedte ook.

    Het portret zelf verandert er niet van: maat, plaats en inhoud blijven
    gelijk (`_avatar_outer` en `_place_avatar` zijn niet aangeraakt).
    """
    from textual.widgets import Markdown

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(100, 50)) as pilot:
        await pilot.pause()
        msgs = app.query_one("#messages")
        msgs.remove_children()
        await pilot.pause()
        for n in range(4):
            app._write(Markdown(f"bericht {n} {LANG}"))
        await _breedtes_vast(pilot)

        for maat in [size, (70, 30), size]:
            await pilot.resize_terminal(*maat)
            await _breedtes_vast(pilot)
            avatar = app.query_one("#avatar")
            breedte, _ = app._avatar_outer()
            assert avatar.region.x == maat[0] - breedte, (maat, avatar.region)
            band = app._avatar_band()
            assert band == avatar.region, (band, avatar.region)
            for kind in msgs.children:
                if _raakt_band(kind.region, band):
                    assert kind.region.right == band.x - 1, (maat, kind.region)
                else:
                    assert _smalle_breedtes(kind) is None, (maat, kind.region)


@pytest.mark.asyncio
async def test_nothing_is_rewritten_when_the_chat_does_not_move(tmp_roan):
    """Een pass die niets te veranderen heeft, schrijft ook niets.

    Elke `styles.width` is een layout, dus zonder deze vergelijking zou elk
    scrollen het hele scherm opnieuw opbouwen.
    """
    from textual.widgets import Markdown

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(60, 26)) as pilot:
        await pilot.pause()
        msgs = app.query_one("#messages")
        msgs.remove_children()
        await pilot.pause()
        for n in range(5):
            app._write(Markdown(f"{n} {LANG}"))
        await _breedtes_vast(pilot)
        assert app._apply_avatar_wrap() is False
        assert app._apply_avatar_wrap() is False


# ---------- 1. de hint van de modelbrowser staat op de knoppenrij ----------
@pytest.mark.asyncio
async def test_models_hint_shares_the_row_with_the_buttons(tmp_roan):
    """De hint staat op dezelfde rij als Terug en Kies, met twee kolommen ertussen.

    Vóór stond de hint op een eigen regel boven de knoppen: een regel extra, en
    op een smalle terminal schoof hij de knoppen van het scherm af.
    """
    from roan.i18n import t
    from textual.widgets import Button

    from roan.tui import ModelsScreen

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(100, 30)) as pilot:
        await pilot.pause()
        screen = ModelsScreen(MODELS_MANY, [], [])
        app.push_screen(screen)
        await pilot.pause()
        hint = screen.query_one("#models-hint")
        back = screen.query_one("#mback", Button)
        choose = screen.query_one("#mchoose", Button)
        assert hint.region.y == back.region.y == choose.region.y, (
            hint.region,
            back.region,
        )
        assert hint.region.right == back.region.x, (hint.region, back.region)
        # twee lege kolommen tussen Terug en Kies, en Kies flush tegen de rand
        assert choose.region.x - (back.region.x + back.region.width) == 2, (
            back.region,
            choose.region,
        )
        box = screen.query_one("#models-box")
        assert choose.region.right == box.content_region.right, (choose.region, box.region)
        assert t("models_hint", n=len(MODELS_MANY)) in str(hint.render())


@pytest.mark.asyncio
@pytest.mark.parametrize("size", [(100, 30), (64, 26), (52, 24), (44, 22), (38, 20)])
async def test_the_models_buttons_survive_a_narrow_window(tmp_roan, size):
    """De hint neemt de rest (`1fr`) en wordt afgekapt; hij duwt de knoppen niet weg."""
    from roan.i18n import t
    from textual.widgets import Button

    from roan.tui import ModelsScreen

    app = RoanApp(FakeAgent())
    async with app.run_test(size=size) as pilot:
        await pilot.pause()
        screen = ModelsScreen(MODELS_MANY, [], [])
        app.push_screen(screen)
        await pilot.pause()
        await pilot.pause()
        hint = screen.query_one("#models-hint")
        back = screen.query_one("#mback", Button)
        choose = screen.query_one("#mchoose", Button)
        assert hint.region.height == 1, hint.region
        assert choose.region.right <= app.screen.size.width, (size, choose.region)
        assert choose.region.x - (back.region.x + back.region.width) == 2, size
        assert str(back.label) == t("btn_back")
        assert str(choose.label) == t("btn_choose")


# ---------- 2. de luchtkolom staat links van de scrollbar, niet rechts ----------
@pytest.mark.asyncio
@pytest.mark.parametrize("selector", ["#models-list", "#command-list"])
async def test_the_clear_column_sits_between_the_row_and_the_scrollbar(tmp_roan, selector):
    """Gemeten, niet aangenomen: laatste cel, gat, scrollbar.

    De lucht stond eerst rechts van de scrollbar (tussen scrollbar en rand van het
    popup), waar de gemarkeerde rij nog steeds tegen de scrollbar aan plakte.
    Een `margin-right` of `padding-right` kan dat niet repareren: Textual tekent
    de scrollbar altijd tegen de rechterrand van de inwendige breedte, dus de
    luchtkolom komt uit de rij zelf.

    Wat niet kan: de achtergrond van de rij ophogen. Textual kleurt de helft
    option over de volle breedte van `scrollable_content_region`, dus de ene
    luchtkolom draagt bij een gemarkeerde rij de rij-kleur in plaats van de
    vlakkleur. Gemeten en gedocumenteerd, niet weggelaten.
    """
    from roan.tui import SCROLLBAR_GAP, CommandScreen, ModelsScreen

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(100, 30)) as pilot:
        await pilot.pause()
        if selector == "#models-list":
            app.push_screen(ModelsScreen(MODELS_MANY, [], []))
            box_id = "#models-box"
        else:
            app.push_screen(CommandScreen())
            box_id = "#commands-box"
        await pilot.pause()
        await pilot.pause()
        listing = app.screen.query_one(selector)
        sb = listing.vertical_scrollbar
        sc = listing.scrollable_content_region
        assert listing.show_vertical_scrollbar is True, selector
        # de scrollbar staat meteen na de inwendige breedte van de rij
        assert sb.region.x == sc.right, (selector, sb.region, sc)
        assert listing.scrollbar_size_vertical == 2, selector
        # elke rij stopt een kolom vóór de scrollbar
        hoogste = -1
        for y in range(sc.height):
            regel = _row_text(app.screen, sc.y + y)
            assert regel[sc.right - 1] == " ", (selector, y, regel)
            hoogste = max(
                hoogste,
                max(
                    (i for i, teken in enumerate(regel[sc.x : sc.right - 1]) if teken != " "),
                    default=-1,
                )
                + sc.x,
            )
        assert hoogste <= sc.right - 1 - SCROLLBAR_GAP, (selector, hoogste, sc.right)
        # en rechts van de scrollbar is de luchtkolom weg: hij zit nu links
        box = app.screen.query_one(box_id)
        assert sb.region.right == box.content_region.right, (selector, sb.region, box.region)
        if selector == "#models-list":
            # de modellenlijstrij lopen tot die kolom toe, dus daar is de laatste
            # tekstcel echt de laatste kolom vóór de lucht
            assert hoogste == sc.right - 1 - SCROLLBAR_GAP, (hoogste, sc)


@pytest.mark.asyncio
async def test_the_models_rows_stay_one_column_even_next_to_the_scrollbar(tmp_roan):
    """De rij is precies `scrollable_content_region` min de luchtkolom.

    Dus elke rij eindigt op dezelfde kolom, één vóór de scrollbar, en er breekt
    niets om.
    """
    from textual.widgets import OptionList

    from roan.tui import SCROLLBAR_GAP, ModelsScreen

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(100, 30)) as pilot:
        await pilot.pause()
        screen = ModelsScreen(MODELS_MANY, [], [])
        app.push_screen(screen)
        await pilot.pause()
        await pilot.pause()
        listing = screen.query_one("#models-list", OptionList)
        sc = listing.scrollable_content_region
        assert listing.show_vertical_scrollbar is True
        for y in range(sc.height):
            regel = "".join(seg.text for seg in listing.render_line(y))
            assert len(regel.rstrip()) == sc.width - SCROLLBAR_GAP, (y, len(regel), sc)
        assert set(listing._line_cache.heights.values()) == {1}


# ---------- 3. drie klikken op model · provider geven één browser ----------
@pytest.mark.asyncio
async def test_three_clicks_on_the_model_open_exactly_one_screen(tmp_roan, monkeypatch):
    """Eén laadbeurt per keer: drie klikken tijdens het ophalen geven één popup.

    `exclusive=True` op de worker hield de worker uniek, maar het scherm wordt bij
    elke aanroep opnieuw gepusht, dus zonder een eigen vlag stonden er na drie
    klikken drie browsers op elkaar.
    """
    from roan import tui as tui_mod
    from roan.tui import ModelsScreen

    aanroepen = []

    def traag() -> None:
        import time

        aanroepen.append(1)
        time.sleep(0.4)
        return ([("groq", "llama-x")], [("openai", "gpt-5")], ["lokaal"])

    monkeypatch.setattr(tui_mod, "gather_models", traag)
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(110, 26)) as pilot:
        await pilot.pause()
        assert app._models_busy is False
        for _ in range(3):
            await pilot.click("#status")
            assert len(app.screen_stack) == 1, app.screen_stack
        assert await _wait_for_models_screen(app, pilot), app.screen
        await pilot.pause()
        schermen = [s for s in app.screen_stack if isinstance(s, ModelsScreen)]
        assert len(schermen) == 1, [type(s).__name__ for s in app.screen_stack]
        assert len(aanroepen) == 1, f"gather_models {len(aanroepen)} keer aangeroepen"
        assert app._models_busy is False, "na het ophalen mag de vlag weer omlaag"


# ---------- 4. pink voor de gebruiker, grijs voor Roan ----------
@pytest.mark.asyncio
async def test_the_user_mark_is_pink_and_the_roan_mark_is_grey(tmp_roan):
    """De gebruiker praat in de pink, Roan in het gedempte grijs.

    Beide kleuren komen uit de CSS van de app (`$accent` en `$text-muted`), dus
    een theme-switch raakt geen code aan.
    """
    from roan.themes import PINK
    from roan.tui import PROMPT_MARK

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(100, 30)) as pilot:
        await pilot.pause()
        await pilot.press(*"hallo", "enter")
        await pilot.pause()
        await pilot.pause()
        gebruiker = app.query("#messages > .user-line").first()
        antwoord = app.query("#messages > .roan-reply").first()
        pink = PINK[app.theme]
        assert str(gebruiker.render()) == f"{PROMPT_MARK} hallo", gebruiker.render()
        stijl = _cell_style(app, gebruiker.region.x, gebruiker.region.y)
        assert stijl.color.triplet.hex.lower() == pink.lower(), (
            stijl.color.triplet.hex,
            pink,
        )
        assert stijl.bold is True, "de gebruikersregel is vet, net als eerst"
        mark = antwoord.query_one(".roan-mark")
        assert str(mark.render()) == PROMPT_MARK
        grijs = _cell_style(app, mark.region.x, mark.region.y)
        assert grijs.color.triplet.hex.lower() != pink.lower(), (
            "Roans teken mag niet de pink zijn",
            grijs.color.triplet.hex,
        )
        # en het is echt een gedempte kleur, geen zwart
        assert grijs.color.triplet.hex.lower() not in ("000000", "ffffff")
        # beide tekens staan op dezelfde kolom
        assert mark.region.x == gebruiker.region.x, (mark.region, gebruiker.region)


@pytest.mark.asyncio
async def test_a_restored_conversation_uses_the_same_two_sides(tmp_roan):
    """`_render_history` gebruikt dezelfde helper, dus pink en grijs als live."""
    from roan.tui import PROMPT_MARK

    agent = FakeAgent()
    agent.messages = [
        {"role": "system", "content": "sys"},
        {"role": "user", "content": "vraag"},
        {"role": "assistant", "content": "antwoord"},
    ]
    app = RoanApp(agent)
    async with app.run_test(size=(100, 30)) as pilot:
        await pilot.pause()
        gebruiker = app.query("#messages > .user-line")
        antwoord = app.query("#messages > .roan-reply")
        assert len(gebruiker) == 1, len(gebruiker)
        assert len(antwoord) == 1, len(antwoord)
        assert str(gebruiker.first().render()) == f"{PROMPT_MARK} vraag"
        assert str(antwoord.first().query_one("Markdown").source) == "antwoord"


# ---------- 5. de commandopalette is een tabel met twee kolommen ----------
def _command_kolommen(listing):
    """Per rij de kolom waar de beschrijving begint, volgens de tabelregels.

    De regels van het scherm worden hier overgenomen (breedste ZICHTBARE
    linkerkolom, twee kolommen ertussen, kappen wat niet past). Zo meet de test
    dezelfde breedte als het scherm, in plaats van te gokken.
    """
    from rich.cells import cell_len

    from roan.commands import COMMANDS
    from roan.i18n import t as vertaal
    from roan.tui import SCROLLBAR_GAP, CommandScreen, clip_cells

    namen = [str(listing.get_option_at_index(i).id) for i in range(listing.option_count)]
    scherm = CommandScreen()
    available = listing.scrollable_content_region.width - SCROLLBAR_GAP
    linker_room = available - max(available // 2, 8) - CommandScreen.COLUMNS_GAP
    if linker_room < 4:
        linker_room = max(available - 12, 1)
    linker = min(
        max((cell_len(scherm._left(n)) for n in namen), default=0),
        linker_room,
        CommandScreen.LEFT_MAX,
    )
    kolom = linker + CommandScreen.COLUMNS_GAP
    return {
        name: str(listing.get_option_at_index(i).prompt).index(
            clip_cells(vertaal(COMMANDS[name].description), max(available - kolom, 1))
        )
        for i, name in enumerate(namen)
    }


@pytest.mark.asyncio
async def test_every_command_description_starts_in_the_same_column(tmp_roan):
    """Niet raden: de breedste ZICHTBARE linkerkolom bepaalt de kolom."""
    from roan.commands import COMMANDS
    from roan.tui import CommandScreen
    from textual.widgets import OptionList

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(100, 30)) as pilot:
        await pilot.pause()
        app.push_screen(CommandScreen())
        await pilot.pause()
        await pilot.pause()
        listing = app.screen.query_one("#command-list", OptionList)
        assert [str(listing.get_option_at_index(i).id) for i in range(listing.option_count)] == sorted(
            COMMANDS
        ), "de id blijft de naam; `_pick_highlighted` hangt eraan"
        kolommen = _command_kolommen(listing)
        assert len(set(kolommen.values())) == 1, kolommen
        for i, name in enumerate(sorted(COMMANDS)):
            prompt = str(listing.get_option_at_index(i).prompt)
            assert prompt.startswith(f"/{name}"), prompt


@pytest.mark.asyncio
async def test_the_command_table_moves_its_column_when_the_filter_narrows_it(tmp_roan):
    """Na filteren wordt de tabel opnieuw gebouwd: kolom meegerekend, één rij."""
    from roan.tui import CommandScreen
    from textual.widgets import OptionList

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(100, 30)) as pilot:
        await pilot.pause()
        app.push_screen(CommandScreen())
        await pilot.pause()
        await pilot.pause()
        listing = app.screen.query_one("#command-list", OptionList)
        breed = set(_command_kolommen(listing).values())
        app.screen.query_one("#csearch").value = "model"
        await pilot.pause()
        await pilot.pause()
        listing = app.screen.query_one("#command-list", OptionList)
        assert listing.option_count == 3, listing.option_count  # /model /models /mode
        smal = _command_kolommen(listing)
        assert len(set(smal.values())) == 1, smal
        assert smal != breed, (smal, breed)  # de kolom is meegerekend
        assert set(listing._line_cache.heights.values()) == {1}


@pytest.mark.asyncio
async def test_the_command_table_never_wraps_on_a_narrow_window(tmp_roan):
    """Kappen, nooit ombreken: ook op 40 kolomen blijft het één regel per commando."""
    from textual.widgets import OptionList

    from roan.tui import CommandScreen

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(100, 30)) as pilot:
        await pilot.pause()
        app.push_screen(CommandScreen())
        await pilot.pause()
        for size in ((60, 24), (40, 20), (100, 30)):
            await pilot.resize_terminal(*size)
            await pilot.pause()
            await pilot.pause()
            listing = app.screen.query_one("#command-list", OptionList)
            assert set(listing._line_cache.heights.values()) == {1}, size
            sc = listing.scrollable_content_region
            for y in range(sc.height):
                regel = "".join(seg.text for seg in listing.render_line(y))
                assert len(regel) <= sc.width, (size, len(regel), sc.width)


# ---------- 6. /sessions opent een popup in plaats van in de chat te printen ----------
class AgentMetHerstel(FakeAgent):
    """Agent met `_restore`/`save`, zoals de echte `Agent` die sessies laadt."""

    def __init__(self):
        super().__init__()
        self.session_id = "nu"
        self.messages = [{"role": "system", "content": "sys"}]
        self.hersteld = 0

    def _restore(self):
        from roan import agent as agent_mod

        self.hersteld += 1
        pad = agent_mod.SESSIONS_DIR / f"{self.session_id}.json"
        if not pad.exists():
            return
        data = json.loads(pad.read_text())
        if isinstance(data.get("messages"), list) and data["messages"]:
            self.messages.extend(data["messages"])


@pytest.mark.asyncio
async def test_sessions_opens_a_popup_and_writes_nothing_in_the_chat(
    tmp_roan, monkeypatch
):
    """Vóór stond de lijst als Markdown ín de chat, tussen de berichten door."""
    from roan import agent as agent_mod
    from roan.tui import SessionsScreen

    monkeypatch.setattr(agent_mod, "SESSIONS_DIR", tmp_roan / "sessions")
    (tmp_roan / "sessions").mkdir()
    for i in range(3):
        (tmp_roan / "sessions" / f"2026010{i + 1}-120000.json").write_text(
            json.dumps({"id": f"2026010{i + 1}-120000", "messages": [{"role": "user", "content": "hoi"}]})
        )
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(100, 30)) as pilot:
        await pilot.pause()
        voor = len(app.query("#messages > *"))
        await pilot.press(*"/sessions", "enter")
        await pilot.pause()
        assert isinstance(app.screen, SessionsScreen), type(app.screen).__name__
        lijst = app.screen.query_one("#sessions-list")
        assert lijst.option_count == 3, lijst.option_count
        # nieuwste eerst
        assert [str(lijst.get_option_at_index(i).id) for i in range(3)] == [
            "20260103-120000",
            "20260102-120000",
            "20260101-120000",
        ]
        assert len(app.query("#messages > *")) == voor, "er komt niets in de chat"
        assert app.screen.query_one("#sessions-box").classes == {"popup"}
        assert app.screen.query_one("#sessions-hint") is not None
        await pilot.press("escape")
        await pilot.pause()
        assert not isinstance(app.screen, SessionsScreen)
        assert len(app.query("#messages > *")) == voor


@pytest.mark.asyncio
async def test_picking_a_session_restores_that_conversation(tmp_roan, monkeypatch):
    """Enter op een sessie herstelt hem: zelfde gesprek, zelfde weergave."""
    from roan import agent as agent_mod
    from roan.tui import SessionsScreen

    monkeypatch.setattr(agent_mod, "SESSIONS_DIR", tmp_roan / "sessions")
    (tmp_roan / "sessions").mkdir()
    (tmp_roan / "sessions" / "20260101-120000.json").write_text(
        json.dumps(
            {
                "id": "20260101-120000",
                "messages": [
                    {"role": "user", "content": "oude vraag"},
                    {"role": "assistant", "content": "oud antwoord"},
                ],
            }
        )
    )
    agent = AgentMetHerstel()
    app = RoanApp(agent)
    async with app.run_test(size=(100, 30)) as pilot:
        await pilot.pause()
        await pilot.press(*"/sessions", "enter")
        await pilot.pause()
        await pilot.pause()
        assert isinstance(app.screen, SessionsScreen)
        await pilot.press("enter")
        for _ in range(40):
            await pilot.pause()
            await asyncio.sleep(0.01)
            if not isinstance(app.screen, SessionsScreen):
                break
        await pilot.pause()
        assert agent.session_id == "20260101-120000", agent.session_id
        assert agent.hersteld == 1, agent.hersteld
        assert [m["content"] for m in agent.messages[1:]] == [
            "oude vraag",
            "oud antwoord",
        ]
        gebruiker = app.query("#messages > .user-line")
        antwoord = app.query("#messages > .roan-reply")
        assert str(gebruiker.first().render()) == "❯ oude vraag"
        assert str(antwoord.first().query_one("Markdown").source) == "oud antwoord"


# ---------- 7. wachtrij: intypen tijdens een antwoord gaat niet verloren ----------
class LangzameAgent(FakeAgent):
    """Elk antwoord duurt even, zodat er tijd is om een tweede bericht te typen."""

    def __init__(self):
        super().__init__()
        self.gunst = threading.Event()
        self.gunst.set()

    def send_stream(self, text, on_event=None):
        self.sent.append(text)
        for stuk in ("antwoord ", "op: ", text):
            self.gunst.wait(5)
            yield stuk
        self.gunst.set()


@pytest.mark.asyncio
async def test_a_message_typed_during_the_reply_is_sent_after_it(tmp_roan):
    """Het veld blijft bruikbaar, het bericht gaat in de wachtrij en komt na.

    Vóór werd `inp.disabled = True` gezet tijdens het antwoord, dus je kon pas
    typen als Roan klaar was.
    """
    agent = LangzameAgent()
    app = RoanApp(agent)
    async with app.run_test(size=(100, 30)) as pilot:
        await pilot.pause()
        inp = app.query_one("#input")
        queue = app.query_one("#queue")
        assert queue.display is False
        agent.gunst.clear()
        await pilot.press(*"eerste vraag", "enter")
        await pilot.pause()
        assert app._streaming is True
        assert inp.disabled is False, "het veld moet bruikbaar blijven"
        await pilot.press(*"tweede vraag", "enter")
        await pilot.pause()
        await pilot.press(*"derde vraag", "enter")
        await pilot.pause()
        assert app._queue == ["tweede vraag", "derde vraag"], app._queue
        assert queue.display is True
        assert str(queue.render()).startswith(t("queue_pending", n=2)), str(queue.render())
        assert agent.sent == ["eerste vraag"], agent.sent
        # het rijtje staat in de footer, boven het invoerveld
        assert queue.region.y < inp.region.y, (queue.region, inp.region)
        assert queue.region.height == 1, queue.region

        agent.gunst.set()
        for _ in range(300):
            await pilot.pause()
            await asyncio.sleep(0.01)
            if not app._streaming and not app._queue:
                break
        await pilot.pause()
        assert agent.sent == ["eerste vraag", "tweede vraag", "derde vraag"], agent.sent
        assert app._queue == [] and app._streaming is False
        assert queue.display is False
        assert inp.disabled is False
        # beide antwoorden staan in het gesprek, in dezelfde volgorde
        antwoorden = [
            str(w.query_one("Markdown").source)
            for w in app.query("#messages > .roan-reply")
        ]
        assert antwoorden == [
            "antwoord op: eerste vraag",
            "antwoord op: tweede vraag",
            "antwoord op: derde vraag",
        ], antwoorden


@pytest.mark.asyncio
async def test_ctrl_c_while_draining_keeps_the_session_usable(tmp_roan):
    """Ctrl+C stopt het antwoord, leegt de wachtrij en laat de app open.

    Het bericht in de wachtrij wordt daarna níet alsnog verstuurd, en een
    volgend bericht werkt gewoon.
    """
    agent = LangzameAgent()
    app = RoanApp(agent)
    async with app.run_test(size=(100, 30)) as pilot:
        await pilot.pause()
        agent.gunst.clear()
        await pilot.press(*"vraag in de lucht", "enter")
        await pilot.pause()
        await pilot.press(*"wachtende vraag", "enter")
        await pilot.pause()
        assert app._queue == ["wachtende vraag"], app._queue
        await pilot.press("ctrl+c")
        await pilot.pause()
        assert app._queue == [], "de wachtrij is geleegd"
        assert app.is_running, "de app blijft staan, het gesprek is bruikbaar"
        assert getattr(app, "_exit", False) is False
        agent.gunst.set()
        await pilot.pause()
        await asyncio.sleep(0.3)
        await pilot.pause()
        assert agent.sent == ["vraag in de lucht"], agent.sent
        assert app.query_one("#input").disabled is False
        # en een volgend bericht wordt gewoon verstuurd
        await pilot.press(*"na het afbreken", "enter")
        for _ in range(300):
            await pilot.pause()
            await asyncio.sleep(0.01)
            if not app._streaming and not app._queue:
                break
        await pilot.pause()
        assert agent.sent == ["vraag in de lucht", "na het afbreken"], agent.sent


@pytest.mark.asyncio
async def test_ctrl_c_without_a_reply_still_quits(tmp_roan):
    """Zonder lopend antwoord blijft Ctrl+C gewoon sluiten."""
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        await pilot.pause()
        await pilot.press("ctrl+c")
        await pilot.pause()
        assert getattr(app, "_exit", False) is True or not app.is_running
