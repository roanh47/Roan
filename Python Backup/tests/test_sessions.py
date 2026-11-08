"""/sessions als popup boven het gesprek: wat er te kiezen valt, en wat er gebeurt.

Deze tests staan apart van `test_tui.py` omdat het om één scherm gaat, en omdat
de hele kwestie hier is dat de popup een `ModalScreen` boven `#messages` is en
niets in het gesprek schrijft.
"""

import json
import re
from pathlib import Path

import pytest

from roan import config
from roan.i18n import t
from roan.tui import (
    POPUP_CSS,
    CLOSE_GLYPH,
    Input,
    NewSessionScreen,
    RenameScreen,
    RoanApp,
    SessionsScreen,
    _session_entries,
)


class Agent:
    """Agent met `_restore`/`save`/`clear`, zoals de echte."""

    model = "fake"

    def __init__(self, session_id: str = "nu"):
        self.session_id = session_id
        self.messages = [{"role": "system", "content": "sys"}]
        self.sent = []
        self.hersteld = 0
        self.geschoond = 0
        self.gesaved = 0

    def reload(self):
        pass

    def clear(self):
        self.geschoond += 1
        self.messages = [{"role": "system", "content": "sys"}]

    def save(self):
        self.gesaved += 1

    def _restore(self):
        from roan import agent as agent_mod

        self.hersteld += 1
        pad = agent_mod.SESSIONS_DIR / f"{self.session_id}.json"
        if not pad.exists():
            return
        data = json.loads(pad.read_text())
        if isinstance(data.get("messages"), list) and data["messages"]:
            self.messages.extend(data["messages"])

    def send(self, text):
        self.sent.append(text)
        return "echo"

    def send_stream(self, text, on_event=None):
        self.sent.append(text)
        yield "echo"


@pytest.fixture
def thuis(tmp_path, monkeypatch):
    """Een lege thuismap met een ingestelde config, plus een sessiemap."""
    monkeypatch.setattr(config, "ROAN_DIR", tmp_path)
    monkeypatch.setattr(config, "CONFIG_PATH", tmp_path / "config.json")
    monkeypatch.setattr(config, "MEMORY_PATH", tmp_path / "memory.md")
    monkeypatch.setattr(config, "USER_PATH", tmp_path / "user.md")
    monkeypatch.setattr(config, "INSTRUCTIONS_PATH", tmp_path / "instructions.md")
    monkeypatch.setattr(config, "SKILLS_DIR", tmp_path / "skills")
    config.save_config({"provider": "lmstudio", "model": "test-model", "tui": "default"})

    from roan import agent as agent_mod

    sessies = tmp_path / "sessions"
    sessies.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(agent_mod, "SESSIONS_DIR", sessies)
    return sessies


def schrijf(map_: Path, session_id: str, *berichten: str) -> Path:
    """Een sessiebestand met `berichten` (rol/content) of alleen strings."""
    msgs = []
    for bericht in berichten:
        if isinstance(bericht, tuple):
            msgs.append({"role": bericht[0], "content": bericht[1]})
        else:
            msgs.append({"role": "user", "content": bericht})
    pad = map_ / f"{session_id}.json"
    pad.write_text(json.dumps({"id": session_id, "messages": msgs}))
    return pad


def app_met_gesprek(agent=None) -> RoanApp:
    return RoanApp(agent or Agent())


async def _open(app, pilot):
    """Typ `/sessions` en laat de popup opkomen."""
    await pilot.press(*"/sessions", "enter")
    await pilot.pause()
    await pilot.pause()


def stack(app):
    return [s.__class__.__name__ for s in app.screen_stack]


# ---------- 1. een echte modal boven het gesprek ----------
@pytest.mark.asyncio
async def test_sessions_is_a_modal_above_the_conversation(thuis):
    """De popup komt op de stapel boven het gesprek; `#messages` blijft staan."""
    schrijf(thuis, "20260102-120000", "vraag", ("assistant", "antwoord"))
    app = app_met_gesprek()
    async with app.run_test(size=(100, 30)) as pilot:
        await pilot.pause()
        from roan.tui import user_line

        app._write(user_line("hallo daar"))
        await pilot.pause()
        voor_stack = stack(app)
        voor_kinderen = len(app.query("#messages > *"))

        await _open(app, pilot)

        assert stack(app) == voor_stack + ["SessionsScreen"], stack(app)
        assert voor_stack == ["Screen"], voor_stack
        # Het gesprek is er nog, met zijn berichten erin: niets verborgen of
        # vervangen, alleen verduimd achter de popup.
        assert len(app.query("#messages")) == 1
        assert len(app.query("#messages > *")) == voor_kinderen
        assert str(app.query_one("#messages > .user-line").render()) == "❯ hallo daar"
        assert len(app.query("#input")) == 1

        await pilot.press("escape")
        await pilot.pause()
        assert stack(app) == voor_stack, stack(app)
        assert len(app.query("#messages > *")) == voor_kinderen


@pytest.mark.asyncio
async def test_the_popup_does_not_hide_the_messages_behind_it(thuis):
    """Het gesprek moet zichtbaar blijven: de popup is er niet in de weg."""
    schrijf(thuis, "20260102-120000", "vraag")
    app = app_met_gesprek()
    async with app.run_test(size=(80, 24)) as pilot:
        await pilot.pause()
        from roan.tui import user_line

        app._write(user_line("zichtbaar"))
        await pilot.pause()
        await _open(app, pilot)
        scherm = app.screen
        regels = ["".join(seg.text for seg in strip) for strip in scherm._compositor.render_strips()]
        getekend = "\n".join(regels)
        assert "zichtbaar" in getekend, getekend
        # De titelbalk van het gesprek (het inputkader) staat er ook nog.
        assert "Bericht aan Roan" in getekend


# ---------- 2. huisstijl ----------
def test_the_screen_follows_the_popup_conventions():
    assert SessionsScreen.CSS.startswith(POPUP_CSS)
    box = SessionsScreen.CSS.split("#sessions-box {")[1].split("}")[0]
    assert "width: 92%;" in box and "max-width:" in box and "height: 66%;" in box
    assert ("escape", "close", "terug") in SessionsScreen.BINDINGS


@pytest.mark.asyncio
async def test_the_box_is_a_popup_with_a_titlebar_and_a_close_button(thuis):
    schrijf(thuis, "20260102-120000", "vraag")
    app = app_met_gesprek()
    async with app.run_test(size=(100, 30)) as pilot:
        await pilot.pause()
        await _open(app, pilot)
        box = app.screen.query_one("#sessions-box")
        assert box.classes == {"popup"}
        assert str(app.screen.query_one(".titlebar .title").render()) == t("msg_sessions_title")
        knop = app.screen.query_one(".titlebar Button.close")
        assert str(knop.label) == CLOSE_GLYPH


@pytest.mark.asyncio
async def test_the_hint_says_enter_and_escape(thuis):
    schrijf(thuis, "20260102-120000", "vraag")
    app = app_met_gesprek()
    async with app.run_test(size=(100, 30)) as pilot:
        await pilot.pause()
        await _open(app, pilot)
        hint = str(app.screen.query_one("#sessions-hint").render())
        assert "Enter" in hint, hint
        assert "Esc" in hint, hint


@pytest.mark.asyncio
async def test_escape_and_the_close_button_both_close(thuis):
    """Twee manieren om weg te gaan, en geen van beide schrijft in de chat."""
    schrijf(thuis, "20260102-120000", "vraag")
    app = app_met_gesprek()
    async with app.run_test(size=(100, 30)) as pilot:
        await pilot.pause()
        voor = len(app.query("#messages > *"))

        await _open(app, pilot)
        assert isinstance(app.screen, SessionsScreen)
        await pilot.press("escape")
        await pilot.pause()
        assert not isinstance(app.screen, SessionsScreen)

        await _open(app, pilot)
        assert isinstance(app.screen, SessionsScreen)
        await pilot.click(".titlebar Button.close")
        await pilot.pause()
        await pilot.pause()
        assert not isinstance(app.screen, SessionsScreen)

        assert len(app.query("#messages > *")) == voor, "er komt niets in de chat"


# ---------- 3. elke sessie, nieuwste eerst, met iets om op te kiezen ----------
@pytest.mark.asyncio
async def test_every_session_is_listed_newest_first(thuis):
    """Zeven sessies, alle zeven in beeld, en de volgorde is omgekeerd chronologisch."""
    ids = [f"2026010{i + 1}-120000" for i in range(7)]
    for nummer, sid in enumerate(ids, start=1):
        schrijf(thuis, sid, f"vraag nummer {nummer}", ("assistant", "antwoord"))
    app = app_met_gesprek()
    async with app.run_test(size=(120, 40)) as pilot:
        await pilot.pause()
        await _open(app, pilot)
        lijst = app.screen.query_one("#sessions-list")
        assert lijst.option_count == 7, lijst.option_count
        assert [str(lijst.get_option_at_index(i).id) for i in range(7)] == ids[::-1]


@pytest.mark.asyncio
async def test_every_row_carries_something_to_choose_by(thuis):
    """Titel, datum en aantal berichten in de rij — geen kale bestandsnaam."""
    schrijf(thuis, "20260102-120000", "maak de popup boven het chatbox", ("assistant", "ok"))
    app = app_met_gesprek()
    async with app.run_test(size=(100, 30)) as pilot:
        await pilot.pause()
        await _open(app, pilot)
        lijst = app.screen.query_one("#sessions-list")
        rij = "".join(seg.text for seg in lijst.render_line(0))
        assert "maak de popup boven het chatbox" in rij, rij
        assert "2026-" in rij, rij  # datum
        assert t("sessions_messages", n=2) in rij, rij  # aantal berichten
        assert "20260102-120000" not in rij, rij  # niet de kale bestandsnaam


@pytest.mark.asyncio
async def test_a_session_without_a_user_message_falls_back_to_its_id(thuis):
    schrijf(thuis, "20260102-120000", ("assistant", "alleen een antwoord"))
    app = app_met_gesprek()
    async with app.run_test(size=(100, 30)) as pilot:
        await pilot.pause()
        await _open(app, pilot)
        lijst = app.screen.query_one("#sessions-list")
        rij = "".join(seg.text for seg in lijst.render_line(0))
        assert "20260102-120000" in rij, rij


@pytest.mark.asyncio
async def test_the_current_session_is_marked(thuis):
    schrijf(thuis, "20260101-120000", "oud gesprek")
    schrijf(thuis, "20260102-120000", "huidig gesprek")
    agent = Agent(session_id="20260102-120000")
    app = app_met_gesprek(agent)
    async with app.run_test(size=(100, 30)) as pilot:
        await pilot.pause()
        await _open(app, pilot)
        lijst = app.screen.query_one("#sessions-list")
        rijen = [
            "".join(seg.text for seg in lijst.render_line(i)) for i in range(lijst.option_count)
        ]
        huidig = [rij for rij in rijen if "huidig gesprek" in rij][0]
        oud = [rij for rij in rijen if "oud gesprek" in rij][0]
        assert SessionsScreen.CURRENT_MARK in huidig, huidig
        assert SessionsScreen.OTHER_MARK in oud, oud


@pytest.mark.asyncio
async def test_a_broken_session_file_does_not_break_the_menu(thuis):
    (thuis / "kapot.json").write_text("{ dit is geen json")
    schrijf(thuis, "20260102-120000", "goede sessie")
    app = app_met_gesprek()
    async with app.run_test(size=(100, 30)) as pilot:
        await pilot.pause()
        await _open(app, pilot)
        lijst = app.screen.query_one("#sessions-list")
        assert lijst.option_count == 2, lijst.option_count
        rijen = [
            "".join(seg.text for seg in lijst.render_line(i)) for i in range(lijst.option_count)
        ]
        assert any("goede sessie" in rij for rij in rijen), rijen


# ---------- 4. herstellen ----------
@pytest.mark.asyncio
async def test_enter_restores_that_conversation(thuis):
    """Enter zet die sessie er weer bij, mét de geschiedenis in `#messages`."""
    schrijf(thuis, "20260101-120000", "oude vraag", ("assistant", "oud antwoord"))
    schrijf(thuis, "20260102-120000", "nieuwere vraag")
    agent = Agent()
    app = app_met_gesprek(agent)
    async with app.run_test(size=(100, 30)) as pilot:
        await pilot.pause()
        assert agent.session_id == "nu"
        assert len(agent.messages) == 1

        await _open(app, pilot)
        await pilot.press("down")   # de nieuwste staat boven; pak de oudere
        await pilot.press("enter")
        for _ in range(40):
            await pilot.pause()
            if not isinstance(app.screen, SessionsScreen):
                break

        assert not isinstance(app.screen, SessionsScreen)
        assert agent.session_id == "20260101-120000", agent.session_id
        assert agent.hersteld == 1, agent.hersteld
        assert [m["content"] for m in agent.messages[1:]] == ["oude vraag", "oud antwoord"]
        assert str(app.query("#messages > .user-line").first().render()) == "❯ oude vraag"
        antwoord = app.query("#messages > .roan-reply").first()
        assert str(antwoord.query_one("Markdown").source) == "oud antwoord"


@pytest.mark.asyncio
async def test_restoring_never_calls_clear_and_leaves_the_file_intact(thuis):
    """`Agent.clear()` zou het bestand meteen leegschrijven; dat mag niet."""
    pad = schrijf(thuis, "20260101-120000", "vraag", ("assistant", "antwoord"))
    voor = json.loads(pad.read_text())
    agent = Agent()
    app = app_met_gesprek(agent)
    async with app.run_test(size=(100, 30)) as pilot:
        await pilot.pause()
        await _open(app, pilot)
        await pilot.press("enter")
        for _ in range(40):
            await pilot.pause()
            if not isinstance(app.screen, SessionsScreen):
                break

        assert agent.geschoond == 0, "clear() is een no-op in het herstelpad"
        assert agent.hersteld == 1
        # Het bestand bestaat nog en levert nog hetzelfde gesprek op.
        assert pad.exists()
        data = json.loads(pad.read_text())
        assert data["messages"] == voor["messages"], data
        # En een tweede keer herstellen geeft nog steeds hetzelfde.
        assert len(agent.messages) == 3


@pytest.mark.asyncio
async def test_restoring_an_empty_session_does_not_wipe_the_file(thuis):
    """Een bestand zonder berichten blijft leeg, maar wordt niet overschreven."""
    pad = schrijf(thuis, "20260101-120000")
    agent = Agent()
    app = app_met_gesprek(agent)
    async with app.run_test(size=(100, 30)) as pilot:
        await pilot.pause()
        await _open(app, pilot)
        await pilot.press("enter")
        for _ in range(40):
            await pilot.pause()
            if not isinstance(app.screen, SessionsScreen):
                break
        assert json.loads(pad.read_text())["messages"] == []
        assert agent.gesaved == 0


# ---------- 5. scrollen, selectie, smalle terminal ----------
@pytest.mark.asyncio
async def test_a_long_list_scrolls_and_the_selection_is_visible(thuis):
    for i in range(12):
        schrijf(thuis, f"2026010{i + 1}-120000", f"sessie nummer {i + 1}")
    app = app_met_gesprek()
    async with app.run_test(size=(100, 30)) as pilot:
        await pilot.pause()
        await _open(app, pilot)
        lijst = app.screen.query_one("#sessions-list")
        assert lijst.option_count == 12
        assert lijst.max_scroll_y > 0, "twaalf sessies moeten scrollen"
        assert lijst.highlighted == 0
        # De gemarkeerde rij ziet er anders uit dan de rij ernaast.
        def stijl(y):
            return [seg.style for seg in lijst.render_line(y) if seg.text.strip()][0]

        assert stijl(0) != stijl(1), "de gekozen rij is niet zichtbaar geselecteerd"
        await pilot.press("down")
        await pilot.pause()
        assert lijst.highlighted == 1


@pytest.mark.asyncio
async def test_the_rows_stay_one_line_at_46_columns(thuis):
    """Op 46 kolommen breekt geen enkele rij om of af."""
    for i in range(6):
        schrijf(thuis, f"2026010{i + 1}-120000", f"een vrij lange vraag over sessie {i + 1}")
    app = app_met_gesprek()
    async with app.run_test(size=(46, 20)) as pilot:
        await pilot.pause()
        await _open(app, pilot)
        lijst = app.screen.query_one("#sessions-list")
        regio = lijst.scrollable_content_region
        assert set(lijst._line_cache.heights.values()) == {1}, lijst._line_cache.heights
        for y in range(regio.height):
            rij = "".join(seg.text for seg in lijst.render_line(y))
            assert len(rij) <= regio.width, (y, len(rij), regio.width)
        eerste = "".join(seg.text for seg in lijst.render_line(0))
        # De bovenste rij is de sessie van nu, dus welke datum daar staat hangt
        # van de klok af; toets op de vorm van de rechterkolom, niet op één dag.
        assert re.search(r"\d\d-\d\d", eerste), eerste
        assert t("sessions_messages", n=1) in eerste or "×1" in eerste, eerste


@pytest.mark.asyncio
async def test_the_popup_floats_above_the_input(thuis):
    """De popup mag het inputkader niet doorzijgen — dat leest als een kapotte render."""
    schrijf(thuis, "20260102-120000", "vraag")
    for size in ((80, 24), (46, 20), (100, 30)):
        app = app_met_gesprek()
        async with app.run_test(size=size) as pilot:
            await pilot.pause()
            await _open(app, pilot)
            box = app.screen.query_one("#sessions-box").region
            # `#input` woont op het hoofdscherm, dus zoeken vanuit de app.
            invoer = app.query_one("#input").region
            assert box.bottom <= invoer.y, (size, box, invoer)


@pytest.mark.asyncio
async def test_no_sessions_at_all_still_opens_a_popup(thuis):
    """Zonder sessies ook een popup: de lege-melding staat in de lijst, niet in de chat."""
    app = app_met_gesprek()
    async with app.run_test(size=(100, 30)) as pilot:
        await pilot.pause()
        await _open(app, pilot)
        assert isinstance(app.screen, SessionsScreen)
        lijst = app.screen.query_one("#sessions-list")
        assert lijst.option_count == 1
        rij = "".join(seg.text for seg in lijst.render_line(0))
        assert t("msg_no_sessions") in rij, rij
        assert len(app.query("#messages > *")) == 0, "er komt niets in de chat"
        await pilot.press("enter")  # niets te kiezen: geen crash, geen herstel
        await pilot.pause()
        assert isinstance(app.screen, SessionsScreen)


# ---------- 6. een sessie een naam geven ----------
@pytest.mark.asyncio
async def test_new_asks_for_a_name_before_it_starts_anything(thuis):
    """`/new` maakt pas een sessie nadat je in de popup een naam gaf."""
    app = app_met_gesprek()
    async with app.run_test(size=(100, 30)) as pilot:
        await pilot.pause()
        oud = app.agent.session_id
        await pilot.press(*"/new", "enter")
        await pilot.pause()
        await pilot.pause()
        assert isinstance(app.screen, NewSessionScreen), stack(app)
        assert app.agent.session_id == oud, "zonder naam begint er nog niets"
        app.screen.query_one("#new-name", Input).value = "trading bot"
        await pilot.press("enter")
        await pilot.pause()
        await pilot.pause()
        assert not isinstance(app.screen, NewSessionScreen), stack(app)
        assert app.agent.session_id != oud
        assert app.agent.session_name == "trading bot"


@pytest.mark.asyncio
async def test_an_empty_name_keeps_the_popup_open(thuis):
    """Een naam is het punt van dit scherm: Enter op niets maakt niets."""
    app = app_met_gesprek()
    async with app.run_test(size=(100, 30)) as pilot:
        await pilot.pause()
        oud = app.agent.session_id
        await pilot.press(*"/new", "enter")
        await pilot.pause()
        await pilot.pause()
        await pilot.press("enter")
        await pilot.pause()
        assert isinstance(app.screen, NewSessionScreen), stack(app)
        assert app.agent.session_id == oud
        hint = "".join(seg.text for seg in app.screen.query_one("#new-hint").render_line(0))
        assert t("new_session_needs_name") in hint, hint


def test_a_given_name_wins_from_the_first_message(thuis):
    """De rij heet naar de naam die je gaf, niet naar de eerste boodschap."""
    (thuis / "20260102-120000.json").write_text(
        json.dumps(
            {
                "id": "20260102-120000",
                "name": "trading bot",
                "messages": [{"role": "user", "content": "een vraag over van alles en nog wat"}],
            }
        )
    )
    entries = _session_entries()
    assert entries[0]["name"] == "trading bot"
    assert entries[0]["title"] == "trading bot"


@pytest.mark.asyncio
async def test_renaming_writes_the_name_and_the_row_follows(thuis):
    """`r` in /sessions schrijft de nieuwe naam weg en de lijst laat hem zien."""
    pad = schrijf(thuis, "20260102-120000", "vraag")
    app = app_met_gesprek()
    async with app.run_test(size=(100, 30)) as pilot:
        await pilot.pause()
        await _open(app, pilot)
        await pilot.press("r")
        await pilot.pause()
        await pilot.pause()
        assert isinstance(app.screen, RenameScreen), stack(app)
        app.screen.query_one("#rename-name", Input).value = "china store"
        await pilot.press("enter")
        await pilot.pause()
        await pilot.pause()
        assert json.loads(pad.read_text())["name"] == "china store"
        assert isinstance(app.screen, SessionsScreen), stack(app)
        lijst = app.screen.query_one("#sessions-list")
        eerste = "".join(seg.text for seg in lijst.render_line(0))
        assert "china store" in eerste, eerste


@pytest.mark.asyncio
async def test_renaming_the_session_you_are_in_moves_the_agent_along(thuis):
    """Het gesprek waar je in zit draagt de nieuwe naam ook.

    Anders schrijft de eerstvolgende `save()` de oude naam terug en is de
    hernoeming verdwenen.
    """
    schrijf(thuis, "nu", "vraag")
    app = app_met_gesprek(Agent("nu"))
    async with app.run_test(size=(100, 30)) as pilot:
        await pilot.pause()
        await _open(app, pilot)
        await pilot.press("r")
        await pilot.pause()
        await pilot.pause()
        app.screen.query_one("#rename-name", Input).value = "vanavond"
        await pilot.press("enter")
        await pilot.pause()
        await pilot.pause()
        assert app.agent.session_name == "vanavond"


def test_set_session_name_refuses_a_session_that_is_not_there(thuis):
    """Geen bestand, geen naam: liever niets dan een half geschreven sessie."""
    from roan import agent as agent_mod

    assert agent_mod.set_session_name("bestaat-niet", "iets") is False
    assert agent_mod.session_name("bestaat-niet") == ""


def test_a_name_survives_saving_and_restoring(thuis):
    """De naam staat in het sessiebestand, dus ook na een herstart."""
    from roan import agent as agent_mod

    agent = agent_mod.Agent(session_id="20260102-120000", restore=False, use_mcp=False)
    agent.session_name = "trading bot"
    agent.save()
    data = json.loads((thuis / "20260102-120000.json").read_text())
    assert data["name"] == "trading bot"
    opnieuw = agent_mod.Agent(session_id="20260102-120000", use_mcp=False)
    assert opnieuw.session_name == "trading bot"


def test_new_session_id_steps_aside_when_the_stamp_is_taken(thuis, monkeypatch):
    """Twee sessies in dezelfde seconde mogen niet hetzelfde bestand krijgen."""
    from roan import agent as agent_mod

    monkeypatch.setattr(agent_mod.time, "strftime", lambda *a: "20260102-120000")
    schrijf(thuis, "20260102-120000", "vraag")
    assert agent_mod.new_session_id() == "20260102-120000-2"