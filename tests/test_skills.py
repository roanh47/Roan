"""Tests voor skills: de `always`-vlag, het inlinen, en de limieten daarboven.

De bestaande skills-tests staan in tests/test_home.py; hier gaat het om wat de
vlag toevoegt, want dat is wat een schrijfstijl afdwingbaar maakt.
"""

import pytest
from textual.screen import ModalScreen
from textual.widgets import OptionList, Static
from textual.widgets import Markdown

from roan import config, skills
from roan.agent import _build_system_prompt


@pytest.fixture
def roan_home(tmp_path, monkeypatch):
    """Isoleer ~/.Roan naar tmp_path, met een skills-map erbij."""
    monkeypatch.setattr(config, "ROAN_DIR", tmp_path)
    monkeypatch.setattr(config, "CONFIG_PATH", tmp_path / "config.json")
    monkeypatch.setattr(config, "MEMORY_PATH", tmp_path / "memory.md")
    monkeypatch.setattr(config, "USER_PATH", tmp_path / "user.md")
    monkeypatch.setattr(config, "INSTRUCTIONS_PATH", tmp_path / "instructions.md")
    monkeypatch.setattr(config, "SKILLS_DIR", tmp_path / "skills")
    (tmp_path / "skills").mkdir(parents=True, exist_ok=True)
    return tmp_path


def write_skill(roan_home, filename, text):
    path = roan_home / "skills" / filename
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


# ---------- frontmatter ----------
@pytest.mark.parametrize("value", ["true", "True", "TRUE", "yes", "1", "on", "ja"])
def test_is_always_truthy(value):
    assert skills.is_always({"always": value}) is True


@pytest.mark.parametrize("value", ["false", "no", "0", "off", "", "misschien", "1.5"])
def test_is_always_falsy(value):
    assert skills.is_always({"always": value}) is False


def test_is_always_without_key():
    assert skills.is_always({}) is False


def test_parse_frontmatter_returns_keys_and_body():
    front, body = skills.parse_frontmatter(
        '---\nname: stijl\ndescription: "regels"\nalways: true\n---\nBody hier\n'
    )
    assert front == {"name": "stijl", "description": "regels", "always": "true"}
    assert body.strip() == "Body hier"


def test_parse_skill_without_frontmatter():
    front, body = skills.parse_frontmatter("# Titel\nGeen frontmatter\n")
    assert front == {}
    assert "Geen frontmatter" in body


def test_parse_skill_still_returns_triple():
    # De bestaande signature blijft een drietal: naam, beschrijving, body.
    name, desc, body = skills.parse_skill("---\nname: s\ndescription: d\n---\nBody")
    assert (name, desc, body) == ("s", "d", "Body")


# ---------- laden ----------
def test_load_skill_from_subdirectory(roan_home):
    write_skill(
        roan_home,
        "mijn-onderwerp/SKILL.md",
        "---\nname: mijn-onderwerp\ndescription: per onderwerp\nalways: true\n---\nDe regels",
    )
    loaded = skills.load_skills()
    assert [s["name"] for s in loaded] == ["mijn-onderwerp"]
    assert loaded[0]["always"] is True
    assert loaded[0]["body"] == "De regels"


def test_load_skill_flat_file_without_flag(roan_home):
    write_skill(roan_home, "los.md", "---\nname: los\ndescription: niet altijd\n---\nBody")
    loaded = skills.load_skills()
    assert loaded[0]["always"] is False
    assert skills.get_skill("los")["body"] == "Body"


def test_subdirectory_without_skill_md_is_ignored(roan_home):
    write_skill(roan_home, "leeg-map/notes.md", "# geen skill")
    assert skills.load_skills() == []


# ---------- de prompt ----------
def test_always_skill_body_is_inlined(roan_home):
    write_skill(
        roan_home,
        "stijl/SKILL.md",
        "---\nname: stijl\ndescription: altijd\nalways: true\n---\nREGEL: geen opvulwoorden",
    )
    prompt = skills.skills_prompt()
    assert skills.ALWAYS_HEADING in prompt
    assert "REGEL: geen opvulwoorden" in prompt
    assert "stijl" in prompt


def test_without_flag_only_name_and_description(roan_home):
    write_skill(
        roan_home,
        "gewoon.md",
        "---\nname: gewoon\ndescription: losse skill\n---\nGEHEIME BODY",
    )
    prompt = skills.skills_prompt()
    assert "- gewoon: losse skill" in prompt
    assert "GEHEIME BODY" not in prompt
    assert skills.ALWAYS_HEADING not in prompt
    assert "read_skill" in prompt


def test_always_block_precedes_the_loose_list(roan_home):
    write_skill(roan_home, "a-stijl.md", "---\nname: stijl\ndescription: d\nalways: true\n---\nSTIJLREGEL")
    write_skill(roan_home, "b-los.md", "---\nname: los\ndescription: d\n---\nBody")
    prompt = skills.skills_prompt()
    assert prompt.index("STIJLREGEL") < prompt.index("Beschikbare skills")
    assert prompt.index("Beschikbare skills") < prompt.index("- los: d")


def test_only_always_skills_gives_no_loose_list(roan_home):
    write_skill(roan_home, "a.md", "---\nname: stijl\ndescription: d\nalways: true\n---\nBody")
    prompt = skills.skills_prompt()
    assert "Beschikbare skills" not in prompt
    assert skills.ALWAYS_HEADING in prompt


def test_system_prompt_order_identity_then_style_then_list(roan_home):
    (roan_home / "instructions.md").write_text("DIT IS DE IDENTITEIT")
    write_skill(roan_home, "stijl/SKILL.md", "---\nname: stijl\ndescription: d\nalways: true\n---\nSTIJLREGEL")
    write_skill(roan_home, "los.md", "---\nname: los\ndescription: d\n---\nBody")
    prompt = _build_system_prompt()
    assert prompt.index("DIT IS DE IDENTITEIT") < prompt.index(skills.ALWAYS_HEADING)
    assert prompt.index(skills.ALWAYS_HEADING) < prompt.index("- los: d")
    assert "STIJLREGEL" in prompt


# ---------- limieten ----------
def test_long_always_skill_is_clipped_visibly(roan_home):
    body = "X" * (skills.MAX_ALWAYS_CHARS + 500) + "EINDE-STAART"
    write_skill(
        roan_home,
        "lang.md",
        f"---\nname: lang\ndescription: d\nalways: true\n---\n{body}",
    )
    prompt = skills.skills_prompt()
    assert "afgekapt" in prompt
    assert f'Haal de rest op met read_skill("lang")' in prompt
    assert f"{skills.MAX_ALWAYS_CHARS}" in prompt
    # De staart van de body mag er echt niet meer in zitten.
    assert "EINDE-STAART" not in prompt


def test_short_always_skill_is_never_clipped(roan_home):
    write_skill(roan_home, "kort.md", "---\nname: kort\ndescription: d\nalways: true\n---\nKort")
    assert "afgekapt" not in skills.skills_prompt()


def test_total_budget_drops_skills_by_name(roan_home):
    chunk = "Y" * (skills.MAX_ALWAYS_TOTAL + 200)
    for name in ("a", "b", "c"):
        write_skill(
            roan_home,
            f"{name}.md",
            f"---\nname: {name}\ndescription: d\nalways: true\n---\n{chunk}",
        )
    prompt = skills.skills_prompt()
    assert "### a" in prompt
    assert "NIET meegestuurd" in prompt
    assert "### c" not in prompt
    assert len(prompt) < skills.MAX_ALWAYS_TOTAL * 2


def test_multiple_always_skills_all_inlined(roan_home):
    write_skill(roan_home, "een.md", "---\nname: een\ndescription: d\nalways: true\n---\nREGEL EEN")
    write_skill(roan_home, "twee.md", "---\nname: twee\ndescription: d\nalways: true\n---\nREGEL TWEE")
    prompt = skills.skills_prompt()
    assert "REGEL EEN" in prompt
    assert "REGEL TWEE" in prompt
    assert prompt.index("REGEL EEN") < prompt.index("REGEL TWEE")


# ---------- /skills-overzicht ----------
def test_skills_list_text_marks_always(roan_home):
    write_skill(roan_home, "stijl.md", "---\nname: stijl\ndescription: d\nalways: true\n---\nB")
    write_skill(roan_home, "los.md", "---\nname: los\ndescription: d\n---\nB")
    text = skills.skills_list_text()
    assert "**stijl** — altijd aan" in text
    assert "**los** — d" in text


# ---------- /skills als menu ----------
#
# De hele vorige inhoud van /skills stond in de chat. Dat moet een popup zijn
# die de lijst én de body laat zien, en die niets in `#messages` schrijft.


class FakeAgent:
    model = "fake"
    session_id = "test-session"
    messages: list = []

    def reload(self):
        pass

    def clear(self):
        self.messages = []

    def save(self):
        pass

    def send(self, text):
        return f"echo: {text}"

    def send_stream(self, text, on_event=None):
        yield f"echo: {text}"


@pytest.fixture
def app_home(roan_home):
    """Dezelfde isolatie, plus een werkende config zodat geen setup-scherm opent."""
    config.save_config({"provider": "lmstudio", "model": "m", "tui": "default"})
    return roan_home


def rendered(screen) -> str:
    return "\n".join(
        "".join(seg.text for seg in strip)
        for strip in screen._compositor.render_strips()
    )


def messages_empty(app) -> bool:
    """True als er niets in de chat staat.

    `.children` is een `NodeList` en niet vergelijkbaar met een lege tuple, dus
    `== ()` zou altijd falen; de lengte is de echte vraag.
    """
    return len(app.query_one("#messages").children) == 0


def options(screen) -> list[str]:
    """De regels van de skilllijst, zoals ze in het scherm staan."""
    listing = screen.query_one("#skills-list", OptionList)
    return [str(listing.get_option_at_index(i)) for i in range(listing.option_count)]


async def open_skills(app, pilot, size=(80, 24)):
    """Typ /skills en geef het scherm terug."""
    await pilot.pause()
    await pilot.press(*"/skills", "enter")
    await pilot.pause()
    await pilot.pause()
    return app.screen


@pytest.mark.asyncio
async def test_slash_skills_opens_the_popup(app_home):
    from roan.tui import RoanApp, SkillsScreen

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(80, 24)) as pilot:
        screen = await open_skills(app, pilot)
        assert isinstance(screen, SkillsScreen)


@pytest.mark.asyncio
async def test_slash_skills_writes_nothing_into_the_chat(app_home):
    from roan.tui import RoanApp

    write_skill(
        app_home,
        "stijl.md",
        "---\nname: stijl\ndescription: altijd\nalways: true\n---\nSTIJLREGEL",
    )
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(80, 24)) as pilot:
        await pilot.pause()
        assert messages_empty(app)
        await pilot.press(*"/skills", "enter")
        await pilot.pause()
        assert messages_empty(app), "/skills hoort niets te schrijven"


@pytest.mark.asyncio
async def test_list_shows_name_description_and_marker(app_home):
    from roan.tui import RoanApp

    write_skill(
        app_home,
        "stijl.md",
        "---\nname: stijl\ndescription: altijd aan\nalways: true\n---\nSTIJLREGEL",
    )
    write_skill(app_home, "los.md", "---\nname: los\ndescription: op verzoek\n---\nBody")
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(80, 24)) as pilot:
        screen = await open_skills(app, pilot)
        labels = options(screen)
        assert len(labels) == 2
        always_label = next(row for row in labels if "stijl" in row)
        assert "★" in always_label and "altijd aan" in always_label
        loose_label = next(row for row in labels if "los" in row)
        assert "○" in loose_label and "op verzoek" in loose_label


@pytest.mark.asyncio
async def test_always_marker_is_visible_on_a_narrow_screen(app_home):
    """60 kolommen: de markering staat vooraan en verdwijnt dus nooit."""
    from roan.tui import RoanApp

    write_skill(
        app_home,
        "stijl.md",
        "---\nname: stijl\ndescription: altijd aan, met een heel lange beschrijving "
        "die op een smal scherm afgekapt wordt\nalways: true\n---\nSTIJLREGEL",
    )
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(60, 26)) as pilot:
        screen = await open_skills(app, pilot)
        row = next(r for r in rendered(screen).splitlines() if "stijl" in r)
        # Zonder rand en opvulling van het popup.
        inner = row.strip().strip("│ ")
        assert inner.startswith("★"), inner
        # De beschrijving is wél afgekapt: dat is precies waarom de markering
        # vooraan moet staan.
        assert inner.endswith("…"), inner


@pytest.mark.asyncio
async def test_body_of_the_selected_skill_is_shown(app_home):
    from roan.tui import RoanApp

    write_skill(app_home, "a.md", "---\nname: a\ndescription: d\n---\nBODY VAN A")
    write_skill(
        app_home,
        "b.md",
        "---\nname: b\ndescription: d\nalways: true\n---\nBODY VAN B, HEEL LANG " * 20,
    )
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(80, 24)) as pilot:
        screen = await open_skills(app, pilot)
        assert "BODY VAN A" in str(screen.query_one("#skills-md", Markdown).source)
        await pilot.press("down")
        await pilot.pause()
        assert "BODY VAN B" in str(screen.query_one("#skills-md", Markdown).source)


@pytest.mark.asyncio
async def test_long_body_scrolls(app_home):
    from textual.containers import VerticalScroll

    from roan.tui import RoanApp

    body = "\n".join(f"regel {i}" for i in range(80))
    write_skill(app_home, "lang.md", f"---\nname: lang\ndescription: d\n---\n{body}")
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(80, 24)) as pilot:
        screen = await open_skills(app, pilot)
        pane = screen.query_one("#skills-doc", VerticalScroll)
        assert pane.max_scroll_y > 0
        pane.scroll_end(animate=False)
        await pilot.pause()
        assert pane.scroll_y == pane.max_scroll_y


@pytest.mark.asyncio
async def test_body_is_readable_at_both_sizes(app_home):
    from roan.tui import RoanApp

    write_skill(
        app_home,
        "stijl.md",
        "---\nname: stijl\ndescription: de schrijfstijl\nalways: true\n---\n"
        "## Schrijfstijl\n\n- Nooit 'Ik zal zeker'.\n- Toon de uitvoer van een commando.\n",
    )
    for size in ((80, 24), (60, 26)):
        # Een eigen app per maat: dezelfde app twee keer `run_test` geven
        # laat hem na de eerste sessie niets meer verwerken.
        app = RoanApp(FakeAgent())
        async with app.run_test(size=size) as pilot:
            screen = await open_skills(app, pilot)
            text = rendered(screen)
            assert "★" in text
            assert "Schrijfstijl" in text, f"body onleesbaar op {size}"
            assert "Esc" in text


@pytest.mark.asyncio
async def test_escape_closes_without_writing(app_home):
    from roan.tui import RoanApp, SkillsScreen

    write_skill(app_home, "a.md", "---\nname: a\ndescription: d\n---\nBody")
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(80, 24)) as pilot:
        await open_skills(app, pilot)
        await pilot.press("escape")
        await pilot.pause()
        assert not isinstance(app.screen, SkillsScreen)
        assert messages_empty(app)


@pytest.mark.asyncio
async def test_close_button_closes(app_home):
    from textual.widgets import Button

    from roan.tui import RoanApp, SkillsScreen

    write_skill(app_home, "a.md", "---\nname: a\ndescription: d\n---\nBody")
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(80, 24)) as pilot:
        screen = await open_skills(app, pilot)
        # Vóór het sluiten: een gedismisste screen heeft geen kinden meer.
        button = screen.query_one("#skills-box Button.close", Button)
        await pilot.click(button)
        await pilot.pause()
        assert not isinstance(app.screen, SkillsScreen)
        assert messages_empty(app)


@pytest.mark.asyncio
async def test_empty_skills_says_where_to_put_them(app_home):
    from roan.tui import RoanApp

    app = RoanApp(FakeAgent())
    async with app.run_test(size=(80, 24)) as pilot:
        screen = await open_skills(app, pilot)
        assert "Nog geen skills" in str(screen.query_one("#skills-md", Markdown).source)
        assert "Skills (0)" in rendered(screen)


@pytest.mark.asyncio
async def test_screen_follows_the_popup_conventions(app_home):
    """Vertical(classes='popup'), _titlebar met ✕, en CSS = POPUP_CSS + eigen ids."""
    from roan.tui import POPUP_CSS, RoanApp, SkillsScreen

    assert issubclass(SkillsScreen, ModalScreen)
    assert SkillsScreen.CSS.startswith(POPUP_CSS)

    write_skill(app_home, "a.md", "---\nname: a\ndescription: d\n---\nBody")
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(80, 24)) as pilot:
        await open_skills(app, pilot)
        box = app.screen.query_one("#skills-box")
        assert box.classes == {"popup"}
        # De titelbalk met het kruisje zit ín het popup, niet erbuiten.
        assert isinstance(box.query_one(".titlebar Static"), Static)
        assert box.query_one("Button.close")
        assert box.query_one("#skills-list", OptionList)
        assert box.query_one("#skills-doc")


@pytest.mark.asyncio
async def test_clipped_always_skill_is_visible_in_the_menu(app_home):
    """Een afgekapt stijldocument mag niet stilzwijgend half werken."""
    from roan.tui import RoanApp

    body = "STIJL " * (skills.MAX_ALWAYS_CHARS // 5 + 40)
    write_skill(
        app_home,
        "stijl.md",
        f"---\nname: stijl\ndescription: te lang\nalways: true\n---\n{body}",
    )
    app = RoanApp(FakeAgent())
    async with app.run_test(size=(80, 24)) as pilot:
        screen = await open_skills(app, pilot)
        source = str(screen.query_one("#skills-md", Markdown).source)
        assert "afgekapt" in source
        assert 'read_skill("stijl")' in source
        assert "afgekapt" in rendered(screen)


def test_the_shipped_style_fits_the_always_budget():
    """De schrijfstijl uit de repo moet in één keer mee, niet afgekapt.

    De agent hoort altijd in Roans stijl te schrijven. Zakt het budget onder de
    lengte van het document, dan gaat hij dat stil half doen — en een half
    toegepaste stijl is erger dan geen stijl.
    """
    from roan import style, skills as skills_mod

    tekst = style.bundled_path().read_text(encoding="utf-8")
    front, body = skills_mod.parse_frontmatter(tekst)
    assert skills_mod.is_always(front), "de stijl hoort altijd aan te staan"
    assert front.get("name") == style.STYLE_NAME
    assert len(body) <= skills_mod.MAX_ALWAYS_CHARS, (len(body), skills_mod.MAX_ALWAYS_CHARS)
    skill = {"name": style.STYLE_NAME, "description": "", "body": body, "always": True}
    assert skills_mod.always_warnings([skill]) == {}
    assert body in skills_mod.always_skills_prompt([skill])


def test_warnings_follow_the_budget():
    lang = {"name": "lang", "body": "X" * (skills.MAX_ALWAYS_CHARS + 10), "always": True}
    kort = {"name": "kort", "body": "kort", "always": True}
    assert skills.always_warnings([kort]) == {}
    assert "afgekapt" in skills.always_warnings([lang])["lang"]

    huge = "Y" * (skills.MAX_ALWAYS_TOTAL + 100)
    warnings = skills.always_warnings(
        [
            {"name": name, "body": huge, "always": True}
            for name in ("a", "b", "c", "d")
        ]
    )
    # Twee skills van MAX_ALWAYS_CHARS plus een restje is het budget op; de
    # rest valt eruit.
    assert "afgekapt" in warnings["a"]
    assert "niet meegestuurd" in warnings["c"]


@pytest.mark.asyncio
async def test_skills_list_text_still_works_without_a_home(tmp_path):
    """`/help` en andere code blijven `skills_list_text()` gebruiken."""
    assert "Nog geen skills" in skills.skills_list_text(tmp_path / "leeg")
