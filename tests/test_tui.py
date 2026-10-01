"""TUI-tests via Textual's headless pilot (geen netwerk)."""

import pytest

from roan import config
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
async def test_close_button_sits_top_right(tmp_roan):
    """De ✕ hoort rechtsboven; `position: absolute` haalt hem uit de flow."""
    from textual.widgets import Button

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(90, 30)) as pilot:
        await pilot.pause()
        btn = app.query_one("#app-close", Button)
        assert btn.region.y == 0
        assert btn.region.x + btn.region.width >= 90 - 6


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
async def test_close_button_is_five_columns_with_the_glyph_centred(tmp_roan):
    """5 kolommen breed en 2 kolommen lucht aan weerszijden van het teken.

    In een popup won de generieke `.popup Button` (min-width 6, padding 0 1)
    van `.close`, waardoor de knop daar 6 kolommen breed werd.
    """
    from textual.widgets import Button

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(90, 30)) as pilot:
        await pilot.pause()
        app_close = app.query_one("#app-close", Button)
        assert app_close.region.width == 5, app_close.region
        row = _row_text(app.screen, app_close.region.y)
        assert row[app_close.region.x : app_close.region.x + 5] == "  ✕  "

        scr = SetupScreen(provider="groq", model="m")
        app.push_screen(scr)
        await pilot.pause()
        popup_close = scr.query_one("#close", Button)
        assert popup_close.region.width == 5, popup_close.region
        row = _row_text(scr, popup_close.region.y)
        assert row[popup_close.region.x : popup_close.region.x + 5] == "  ✕  "


@pytest.mark.asyncio
@pytest.mark.parametrize("size", [(90, 30), (60, 24), (120, 40)])
async def test_close_button_keeps_its_width_on_any_window(tmp_roan, size):
    from textual.widgets import Button

    app = RoanApp(FakeAgent())
    async with app.run_test(size=size) as pilot:
        await pilot.pause()
        assert app.query_one("#app-close", Button).region.width == 5


# ---------- twee kolomen lucht tussen twee knoppen ----------
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
        assert prompts["help"].startswith("/help  ·"), prompts["help"]
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
        assert str(app.query_one("#status-mode").render()) == "chat"
        for expected in ("plan", "build", "chat"):
            await pilot.click("#status-mode")
            await pilot.pause()
            assert config.load_config()["mode"] == expected
            assert str(app.query_one("#status-mode").render()) == expected
        # en het gesprek bevestigt het, met de nieuwe naam erbij
        assert "chat" in str(list(app.query("#messages > *"))[-1].render())


@pytest.mark.asyncio
async def test_clicking_the_permissions_chip_flips_auto_and_user(tmp_roan):
    """Auto ⇄ user, net als het commando zonder argument."""
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(110, 26)) as pilot:
        await pilot.pause()
        assert config.load_config()["permissions"] == "auto"
        for expected in ("user", "auto"):
            await pilot.click("#status-perm")
            await pilot.pause()
            assert config.load_config()["permissions"] == expected
            assert str(app.query_one("#status-perm").render()) == expected
        assert "auto" in str(list(app.query("#messages > *"))[-1].render())


@pytest.mark.asyncio
async def test_clickable_status_items_show_it_on_hover(tmp_roan):
    """Zonder hover-acht is een chip niet te onderscheiden van gewone tekst."""
    for selector in ("#status", "#status-mode", "#status-perm", "#status-hints"):
        app = RoanApp(FakeAgent())
        async with app.run_test(size=(110, 26)) as pilot:
            await pilot.pause()
            region = app.query_one(selector).region
            before = _cell_style(app, region.x + 1, region.y)
            await pilot.hover(selector, offset=(1, 0))
            await pilot.pause()
            after = _cell_style(app, region.x + 1, region.y)
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
async def test_close_button_follows_the_right_edge_after_a_resize(tmp_roan):
    """Na een resize staat de ✕ weer precies tegen de nieuwe rechterrand.

    `App._on_resize` stuurt de Resize naar het scherm en zet de nieuwe maat
    pas daarna; wie in `on_resize` meteen `self.size` gebruikt, rekent nog met
    de OUDE vensterbreedte en laat de knop één resize achter (of buiten beeld
    als het venster kleiner werd). Daarom loopt het plaatsen via
    `call_after_refresh`.
    """
    from textual.widgets import Button

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(90, 30)) as pilot:
        await pilot.pause()
        btn = app.query_one("#app-close", Button)
        assert btn.region.width == 5, btn.region
        assert btn.region.right == 90, btn.region

        for size in [(46, 20), (120, 40), (60, 24), (33, 12)]:
            await pilot.resize_terminal(*size)
            await pilot.pause()
            width = app.size.width
            assert btn.region.width == 5, (size, btn.region)
            assert btn.region.right == width, (size, btn.region, width)
            # het teken blijft in het midden van zijn 5 kolommen
            row = _row_text(app.screen, btn.region.y)
            assert row[btn.region.x : btn.region.right] == "  ✕  ", (size, row)


# ---------- de avatar is de vooraf gerenderde tekening ----------
# assets/avatar.ans is met chafa gemaakt (24x12, echte truecolor) en staat als
# tekst in de repo; de PNG is alleen de terugvalroute.


@pytest.mark.asyncio
async def test_avatar_draws_the_pre_rendered_ansi_at_its_own_size(tmp_roan):
    """De widget krijgt precies de cellen van het bestand: 24 breed, 12 hoog.

    Hij mag dus niet groter of kleiner worden: een te smalle widget laat Rich
    elke regel op de volgende doorlopen, en dat breekt de kleur-escapes van
    die regel.
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
        assert (avatar.region.width, avatar.region.height) == ANS_CELLS, avatar.region
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
        assert len(rijen) == avatar.region.height == 12
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
        assert (avatar.region.width, avatar.region.height) == (cols, rows)
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
        assert (avatar.region.width, avatar.region.height) == ANS_CELLS, avatar.region
        assert set(avatar.content.plain) <= {"▀", "\n"}, "geen halfblokjes uit de PNG"
