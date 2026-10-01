"""De foto-omzetting: verhouding, transparantie en de randgevallen."""

from pathlib import Path

import pytest

from roan import photo


def test_square_image_stays_square():
    """Een vierkant van 24 kolommen breed hoort 12 rijen hoog te zijn."""
    assert photo.fit_cells(500, 500, 24) == (24, 12)


def test_landscape_gets_fewer_rows():
    cols, rows = photo.fit_cells(1000, 500, 24)
    assert cols == 24
    assert rows == 6


def test_portrait_gets_relative_height():
    cols, rows = photo.fit_cells(500, 1000, 24)
    assert cols == 24
    assert rows == 24


def test_max_rows_shrinks_the_width_instead_of_squashing():
    cols, rows = photo.fit_cells(500, 1000, 24, max_rows=10)
    assert rows == 10
    assert cols == 10  # 10 rijen → 10 kolommen bij een vierkant


def test_never_returns_zero():
    assert photo.fit_cells(0, 0, 24) == (24, 1)
    assert photo.fit_cells(500, 500, 0) == (1, 1)


@pytest.fixture
def square_png(tmp_path: Path) -> str:
    PIL = pytest.importorskip("PIL.Image")
    path = tmp_path / "square.png"
    PIL.new("RGBA", (200, 200), (255, 46, 136, 128)).save(path)
    return str(path)


def test_render_keeps_the_relationship(square_png):
    text = photo.render_photo(square_png, width=24)
    lines = text.plain.split("\n")
    assert len(lines) == 12, "een vierkant hoort de halve breedte aan rijen te hebben"
    assert len(lines[0]) == 24


def test_render_respects_max_height(square_png):
    text = photo.render_photo(square_png, width=40, max_height=8)
    assert len(text.plain.split("\n")) == 8


def test_render_of_a_missing_file_is_empty(tmp_path: Path):
    assert photo.render_photo(str(tmp_path / "nope.png")).plain == ""


def test_render_of_a_non_image_is_empty(tmp_path: Path):
    broken = tmp_path / "broken.png"
    broken.write_text("dit is geen png")
    assert photo.render_photo(str(broken)).plain == ""


def test_transparent_png_gets_the_dark_background(square_png):
    """Een halfdoorzichtige laag moet op de vaste achtergrond mengen."""
    text = photo.render_photo(square_png, width=4)
    assert "rgb(" in str(text.spans[0].style)


# ---------- welk rendermiddel voor de avatar ----------
def test_image_mode_override_picks_the_right_widget(monkeypatch):
    """ROAN_IMAGE mag de terminal-probe overstemmen.

    textual_image vraagt de terminal of het sixel of TGP aankan en *vertrouwt*
    dat antwoord. Een terminal die het protocol wel tekent maar niet aankondigt
    (Termius) zou daardoor op halve blokjes terugvallen; met de override
    kunnen we dat zelf overstemmen.
    """
    from roan import tui

    w = tui._image_widget
    monkeypatch.delenv("ROAN_IMAGE", raising=False)
    assert tui._image_widget_class("sixel") is w.SixelImage
    assert tui._image_widget_class("tgp") is w.TGPImage
    assert tui._image_widget_class("halfcell") is w.HalfcellImage
    assert tui._image_widget_class("unicode") is w.UnicodeImage

    # Een onbekende modus valt terug op de automatische keuze van de library.
    monkeypatch.setenv("ROAN_IMAGE", "onzin")
    assert tui._image_widget_class() is w.Image

    # De env var wint van de automatische keuze: dat is precies de noodzaak.
    monkeypatch.setenv("ROAN_IMAGE", "sixel")
    assert tui._image_widget_class() is w.SixelImage


def test_photo_is_composited_on_the_given_theme_background():
    """Anders blijft een doorzichtige PNG op een eigen kleur staan."""
    from PIL import Image

    p = Path(__file__).resolve().parents[1] / "roan" / "assets" / "avatar.png"
    if not p.exists():
        pytest.skip("geen avatar")
    img = photo._load_rgb(str(p), bg=(24, 24, 37))
    assert img is not None
    # De lege rand moet nu exact de meegegeven achtergrond zijn.
    assert img.getpixel((0, 0)) == (24, 24, 37)


def test_fitted_cells_matches_what_render_photo_draws():
    """De TUI rekent de widgetgrootte met fitted_cells; die moet kloppen.

    Anders rekent hij met een andere verhouding dan de tekst die
        render_photo maakt, en wordt het plaatje afgesneden of uitgerekt.
    """
    p = Path(__file__).resolve().parents[1] / "roan" / "assets" / "avatar.png"
    if not p.exists():
        pytest.skip("geen avatar")
    img = photo._load_rgb(str(p))
    cols, rows = photo.fitted_cells(str(p), 26, max_rows=16)
    assert (cols, rows) == photo.fit_cells(img.width, img.height, 26, 16)


def test_square_avatar_renders_as_a_square_block():
    """Het bestand is vierkant, dus het moet ook vierkant uit de tekening komen.

    Een terminalcel is twee keer zo hoog als breed: N kolommen vraagt N/2
    rijen. Krijgt het meer rijen, dan staat het portret er "taller dan breed".
    """
    p = Path(__file__).resolve().parents[1] / "roan" / "assets" / "avatar.png"
    if not p.exists():
        pytest.skip("geen avatar")
    img = photo._load_rgb(str(p))
    assert img.width == img.height, "de avatar is vierkant"
    for max_rows in (8, 10, 16):
        cols, rows = photo.fitted_cells(str(p), 26, max_rows=max_rows)
        assert cols == rows * 2, f"{cols}x{rows} is fysiek niet vierkant"


def test_transparent_margins_render_as_the_background_not_white():
    """Regression: de avatar stond als een witte vlak in het chatvenster.

    textual_image negeert bij halfcells het alfakanaal en zet doorzichtige
    pixels op wit. Daarom tekenen wij die route zelf, op de thema-achtergrond:
    de marge moet exact die kleur zijn, nooit wit.
    """
    from rich.console import Console
    from rich.segment import Segment

    p = Path(__file__).resolve().parents[1] / "roan" / "assets" / "avatar.png"
    if not p.exists():
        pytest.skip("geen avatar")
    theme_bg = (24, 24, 37)  # Catppuccin mocha
    text = photo.render_photo(str(p), width=26, max_height=16, bg=theme_bg)
    console = Console(force_terminal=True, color_system="truecolor", width=40)
    segs = [s for s in console.render(text, console.options.update_width(26))
            if isinstance(s, Segment)]
    triplets = {
        (s.style.color.triplet.red, s.style.color.triplet.green, s.style.color.triplet.blue)
        for s in segs[:10] if s.style.color
    }
    assert (255, 255, 255) not in triplets, "de marge mag niet wit zijn"
    assert theme_bg in triplets, f"de marge moet de thema-achtergrond zijn, kreeg {triplets}"


# ---------- de vooraf gerenderde ANSI-avatar ----------
# avatar.ans is eenmalig met chafa gegenereerd en staat als tekst in de repo:
#     chafa -f symbols -s 24x12 --stretch --colors full avatar.png > avatar.ans

ASSETS = Path(__file__).resolve().parents[1] / "roan" / "assets"
AVATAR_ANS = ASSETS / "avatar.ans"


@pytest.fixture
def ans_path() -> str:
    if not AVATAR_ANS.exists():
        pytest.skip("geen avatar.ans")
    return str(AVATAR_ANS)


def _render_ansi(text) -> str:
    """Teken `text` in een echte terminal en geef de ruwe uitvoer terug."""
    from rich.console import Console

    console = Console(force_terminal=True, color_system="truecolor", width=200)
    with console.capture() as cap:
        console.print(text)
    return cap.get()


def test_the_ans_avatar_has_twelve_rows(ans_path):
    """Het bestand is met -s 24x12 gemaakt: 24 kolommen, 12 rijen."""
    text = photo.load_ans(ans_path)
    assert text is not None
    assert len(text.plain.split("\n")) == 12
    assert photo.ANS_CELLS == (24, 12)


def test_ans_keeps_no_cursor_control(ans_path):
    """chafa zet de cursor uit en weer aan; dat hoort niet in een widget.

    Zo'n escape is geen teken. Blijft hij in de tekst staan, dan telt hij mee
    voor de celbreedte en stuurt Textual hem alsnog naar de terminal toe.
    """
    text = photo.load_ans(ans_path)
    assert text is not None
    for escape in ("\x1b[?25l", "\x1b[?25h", "\x1b[?1049h", "\x1b[?1049l", "\x1b[2J", "\x1b[H"):
        assert escape not in text.plain
        assert escape not in str(text), f"{escape!r} lekte de stijlen in"
    assert "\x1b" not in text.plain
    assert not [c for c in text.plain if ord(c) < 32 and c != "\n"]


def test_ans_cells_measures_the_characters_not_the_escapes(ans_path):
    """De escapes tellen niet mee; anders krijgt de widget een maat van 499."""
    assert photo.ans_cells(ans_path) == (24, 12)
    raw = Path(ans_path).read_text(encoding="utf-8")
    assert photo.ans_cells(ans_path) != (len(max(raw.split("\n"), key=len)), 12)


def test_the_ansi_text_keeps_its_truecolor(ans_path):
    """Het hele idee van het bestand: echte kleuren, geen 256 of 16 kleuren."""
    import re

    out = _render_ansi(photo.load_ans(ans_path))
    assert "\x1b[38;2;" in out, "geen truecolor voorgrond in de uitvoer"
    # chafa zet voor- en achtergrond in één SGR, dus niet op \x1b[48 beginnen.
    assert "48;2;" in out, "geen truecolor achtergrond in de uitvoer"
    assert "\x1b[?25l" not in out

    # Dezelfde kleuren als in het bestand, dus er is niets platgeslagen.
    src = re.findall(r"(?:38|48);2;(\d+;\d+;\d+)", Path(ans_path).read_text(encoding="utf-8"))
    assert set(re.findall(r"(?:38|48);2;(\d+;\d+;\d+)", out)) == set(src)


def test_ans_colours_survive_as_rich_styles(ans_path):
    """Niet alleen de uitvoer, maar de Text zelf moet kleurtripels dragen."""
    from rich.color import ColorType

    text = photo.load_ans(ans_path)
    kinds = {
        span.style.color.type
        for span in text.spans
        if span.style is not None and span.style.color is not None
    }
    assert ColorType.TRUECOLOR in kinds


def test_a_missing_ans_falls_back_to_none(tmp_path: Path):
    """None betekent "gebruik het PNG-pad"; het bestand mag ontbreken."""
    assert photo.load_ans(str(tmp_path / "nope.ans")) is None
    assert photo.ans_cells(str(tmp_path / "nope.ans")) is None
    # Ook als de caller meteen doorvalt moet dat een bruikbaar beeld geven.
    assert photo.render_avatar(
        ans_path=str(tmp_path / "nope.ans"), png_path=str(photo.PNG_AVATAR), width=24
    ).plain


def test_ans_strips_control_but_keeps_colour(tmp_path: Path):
    """Alleen cursorbesturing gaat eruit; \x1b[38;2;r;g;bm is het hele punt."""
    p = tmp_path / "a.ans"
    p.write_text(
        "\x1b[?25l\x1b[?1049h\x1b[2J\x1b[H\x1b[38;2;255;46;136m█\x1b[0m\x1b[?25h",
        encoding="utf-8",
    )
    text = photo.load_ans(str(p))
    assert text is not None
    assert text.plain == "█"
    assert "\x1b[38;2;255;46;136m" in _render_ansi(text)
    assert photo.ans_cells(str(p)) == (1, 1)


def test_an_empty_ans_falls_back_instead_of_drawing_nothing(tmp_path: Path):
    p = tmp_path / "leeg.ans"
    p.write_text("\x1b[?25l\x1b[2J\x1b[H\x1b[?25h", encoding="utf-8")
    assert photo.load_ans(str(p)) is None
    assert photo.ans_cells(str(p)) is None


def test_avatar_cells_prefers_the_ans_and_falls_back_to_the_png(tmp_path: Path):
    """De widgetgrootte moet bij de tekst passen die ook echt getekend wordt."""
    assert photo.avatar_cells() == photo.ANS_CELLS == photo.ans_cells(str(photo.ANS_AVATAR))

    alleen_png = photo.avatar_cells(
        ans_path=str(tmp_path / "nope.ans"), png_path=str(photo.PNG_AVATAR), max_cols=26, max_rows=16
    )
    assert alleen_png == photo.fitted_cells(str(photo.PNG_AVATAR), 26, 16)
