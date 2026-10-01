"""Afbeelding → raster van halve blokken, met behoud van de verhouding.

Een tekenkaart is ongeveer twee keer zo hoog als breed, dus een vierkante
afbeelding van N kolommen breed hoort N/2 rijen hoog te zijn. Zonder die
correctie wordt een vierkant portret platgedrukt of uitgerekt.

Daarnaast staat hier de lezer voor de vooraf gerenderde ANSI-tekening van de
avatar (`assets/avatar.ans`): die bevat echte truecolor-escapes en tekent dus
zonder Pillow, chafa of terminal-protocollen.
"""

import re
from pathlib import Path

from rich.cells import cell_len
from rich.style import Style
from rich.text import Text

# Achtergrond waarop transparante PNG's worden gecomposite (donkere terminal).
_BG = (20, 22, 28)

# Hoogte/breedte van één tekenkaart, in dezelfde eenheid als de afbeelding.
CELL_RATIO = 0.5


def fit_cells(
    width: int,
    height: int,
    max_cols: int,
    max_rows: int | None = None,
) -> tuple[int, int]:
    """Aantal (kolommen, rijen) waarin een afbeelding past zonder vervorming."""
    if width <= 0 or height <= 0:
        return max(1, int(max_cols)), 1
    cols = max(1, int(max_cols))
    rows = max(1, round(cols * (height / width) * CELL_RATIO))
    if max_rows is not None and rows > max_rows:
        rows = max(1, int(max_rows))
        cols = max(1, round(rows / ((height / width) * CELL_RATIO)))
    return cols, rows


def _load_rgb(path: str, bg: tuple[int, int, int] | None = None):
    """Open de afbeelding als RGB, met de doorzichtige delen op de themabackgrond.

    We knippen niets van de afbeelding: het bestand is vierkant en zo tekenen we
    het ook vierkant. Een terminalcel is twee keer zo hoog als breed, dus een
    vierkant beeld van N kolommen hoort N/2 rijen te zijn (zie CELL_RATIO).
    """
    try:
        from PIL import Image
    except ImportError:
        return None

    p = Path(path).expanduser()
    if not p.exists():
        return None
    try:
        img = Image.open(p)
        img.load()
    except Exception:
        return None

    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        flat = Image.new("RGBA", img.size, (*(bg or _BG), 255))
        img = Image.alpha_composite(flat, img).convert("RGB")
    else:
        img = img.convert("RGB")
    return img



def fitted_cells(
    path: str, max_cols: int, max_rows: int | None = None
) -> tuple[int, int]:
    """Kolommen/rijen waarin `path` getekend wordt.

    De TUI heeft deze getallen nodig om het widget precies zo groot te maken als
    de tekst die `render_photo` produceert; anders rekent hij met een andere
    verhouding en wordt het plaatje afgesneden of uitgerekt.
    """
    img = _load_rgb(path)
    if img is None:
        return (max(1, max_cols), 1)
    return fit_cells(img.width, img.height, max_cols, max_rows)


def render_photo(
    path: str,
    width: int = 24,
    max_height: int | None = None,
    bg: tuple[int, int, int] | None = None,
) -> Text:
    """Render een afbeelding als een raster van gekleurde half-blocks."""
    try:
        from PIL import Image  # noqa: F401
    except ImportError:
        return Text("(install Pillow om de foto te renderen)")

    img = _load_rgb(path, bg=bg)
    if img is None:
        return Text("")

    cols, rows = fit_cells(img.width, img.height, width, max_height)
    img = img.resize((cols, rows * 2), Image.LANCZOS)
    px = img.load()

    text = Text()
    for y in range(0, rows * 2, 2):
        for x in range(cols):
            top = px[x, y]
            bot = px[x, y + 1] if y + 1 < rows * 2 else top
            style = Style(
                color=f"rgb({top[0]},{top[1]},{top[2]})",
                bgcolor=f"rgb({bot[0]},{bot[1]},{bot[2]})",
            )
            text.append("▀", style)
        if y + 2 < rows * 2:
            text.append("\n")
    return text


# ---------- vooraf gerenderde ANSI-avatar ----------
# Eénmalig gegenereerd met:
#     chafa -f symbols -s 24x12 --stretch --colors full avatar.png > avatar.ans
# Het resultaat staat als tekst in de repo. Daardoor is er geen chafa en geen
# Pillow nodig om de avatar te tekenen, en geen sixel/TGP-ondersteuning: het
# zijn gewone bloktekens met een truecolor-stijl, dus iedere terminal kan het.

ANS_AVATAR = Path(__file__).parent / "assets" / "avatar.ans"
PNG_AVATAR = Path(__file__).parent / "assets" / "avatar.png"

# Celformaat van de meegeleverde tekening (de -s 24x12 hierboven). Ook bruikbaar
# als het bestand ontbreekt, zodat de widget toch een passende grootte krijgt
# in plaats van te schatten.
ANS_CELLS = (24, 12)

# Elke CSI-escape (ESC [ params afsluitletter) behalve SGR: cursor en scherm.
# SGR is de enige escape die kleur draagt en eindigt altijd op 'm'. chafa
# omsluit de tekening met \x1b[?25l (cursor uit) en \x1b[?25h (cursor aan);
# die horen er niet in, want ze zouden als bytes blijven meetellen voor de
# celbreedte. Deze regexp raakt \x1b[0m en \x1b[38;2;r;g;bm dus niet.
_CONTROL_ESC_RE = re.compile(r"\x1b\[[0-9;?]*[a-ln-zA-Z]")
_SGR_RE = re.compile(r"\x1b\[([0-9;:]*)m")


def _strip_controls(raw: str) -> str:
    """Haal cursor- en schermbesturing eruit; laat alle kleur-SGR's staan."""
    return _CONTROL_ESC_RE.sub("", raw)


def _plain(raw: str) -> str:
    """Alle escapes weg, alleen de zichtbare tekens over.

    Voor het meten: een escape is geen teken en telt niet mee in de
    celbreedte. `load_ans` wil ze juist wél houden.
    """
    return _SGR_RE.sub("", _strip_controls(raw))


def _sgr(style: Style, params: list[int]) -> Style:
    """Pas één SGR-lijst toe op `style` (handmatige variant van from_ansi).

    Let op bij 38/48;2;r;g;b: de vijf getallen worden één keer gelezen en daarna
    overgeslagen. Anders zou `2` als "dim" en `31` als "rood" gelden.
    """
    i = 0
    while i < len(params):
        p = params[i]
        skip = 0
        if p == 0:
            style = Style.null()
        elif p == 1:
            style = style + Style(bold=True)
        elif p == 2:
            style = style + Style(dim=True)
        elif p == 3:
            style = style + Style(italic=True)
        elif p == 4:
            style = style + Style(underline=True)
        elif p == 7:
            style = style + Style(reverse=True)
        elif p == 22:
            style = style + Style(bold=False, dim=False)
        elif p == 23:
            style = style + Style(italic=False)
        elif p == 24:
            style = style + Style(underline=False)
        elif p == 27:
            style = style + Style(reverse=False)
        elif 30 <= p <= 37:
            style = style + Style(color=f"color({p - 30})")
        elif p == 39:
            style = style + Style(color=None)
        elif 40 <= p <= 47:
            style = style + Style(bgcolor=f"color({p - 40})")
        elif p == 49:
            style = style + Style(bgcolor=None)
        elif 90 <= p <= 97:
            style = style + Style(color=f"color({p - 90 + 8})")
        elif 100 <= p <= 107:
            style = style + Style(bgcolor=f"color({p - 100 + 8})")
        elif p in (38, 48) and i + 1 < len(params):
            # 38/48 = voor- of achtergrond; daarop volgt 2 (truecolor) of 5 (256).
            slot = "color" if p == 38 else "bgcolor"
            kind = params[i + 1]
            if kind == 2 and i + 4 < len(params):
                r, g, b = params[i + 2], params[i + 3], params[i + 4]
                style = style + Style(**{slot: f"rgb({r},{g},{b})"})
                skip = 4
            elif kind == 5 and i + 2 < len(params):
                style = style + Style(**{slot: f"color({params[i + 2]})"})
                skip = 2
        i += 1 + skip
    return style


def _text_from_ansi(raw: str) -> Text:
    """Zet ANSI naar Text met echte stijlen per teken.

    Nodig als `Text.from_ansi` ontbreekt; de uitkomst moet er hetzelfde uitzien
    omdat beide de escapes in stijlen omzetten in plaats van ze letterlijk in
    de tekst te laten staan.
    """
    text = Text()
    style = Style.null()
    pos = 0
    for match in _SGR_RE.finditer(raw):
        chunk = raw[pos : match.start()]
        if chunk:
            text.append(chunk, style)
        body = match.group(1)
        params = [int(p) for p in re.split(r"[;:]", body) if p] if body else [0]
        style = _sgr(style, params)
        pos = match.end()
    tail = raw[pos:]
    if tail:
        text.append(tail, style)
    return text


def load_ans(path: str | Path) -> Text | None:
    """Lees een vooraf gerenderde ANSI-tekening; None als die er niet is.

    De kleurovergangen worden echte Rich-stijlen, zodat Textual ze als
    truecolor doorgeeft aan de terminal. De cursor-besturing eromheen wordt
    weggehaald: die is bedoeld voor een losse chafa-run en zou in de widget
    onzichtbaar meetellen voor de celbreedte.

    None betekent "gebruik het terugvalpad" (de PNG via `render_photo`); het
    bestand kan ontbreken, niet leesbaar zijn, of geen ANSI zijn.
    """
    try:
        raw = Path(path).expanduser().read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None

    clean = _strip_controls(raw).strip("\n")
    # Niets zichtbaars (een leeg bestand, of alleen cursorbesturing eromheen):
    # dan is terugvallen op de PNG duidelijk beter dan een leeg widget.
    if not _plain(clean).strip():
        return None

    from_ansi = getattr(Text, "from_ansi", None)
    if from_ansi is not None:
        try:
            text = from_ansi(clean)
        except Exception:
            text = None
        if text is not None and text.spans:
            return text
    return _text_from_ansi(clean)


def ans_cells(path: str | Path) -> tuple[int, int] | None:
    """(kolommen, rijen) van een ANSI-tekening, of None als die er niet is.

    Gemeten op de breedste regel ná het weghalen van álle escapes, want een
    escape is geen teken en telt niet mee in de celbreedte.
    """
    try:
        raw = Path(path).expanduser().read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None

    lines = _plain(raw).strip("\n").split("\n")
    cols = max((cell_len(line) for line in lines), default=0)
    if not cols:
        return None
    return cols, len(lines)


def render_avatar(
    ans_path: str | Path | None = None,
    png_path: str | Path | None = None,
    width: int = 26,
    max_height: int | None = None,
    bg: tuple[int, int, int] | None = None,
) -> Text:
    """De avatar als tekst: eerst het .ans-bestand, anders de PNG.

    De .ans-route is exact dezelfde tekening als `render_photo` zou geven, maar
    dan al als bloktekens met truecolor in het bestand. Zonder dat bestand
    valt hij terug op het PNG-pad, zodat de avatar nooit verdwijnt.
    """
    text = load_ans(ANS_AVATAR if ans_path is None else ans_path)
    if text is not None:
        return text
    return render_photo(
        str(PNG_AVATAR if png_path is None else png_path),
        width=width,
        max_height=max_height,
        bg=bg,
    )


def avatar_cells(
    ans_path: str | Path | None = None,
    png_path: str | Path | None = None,
    max_cols: int = 26,
    max_rows: int | None = None,
) -> tuple[int, int]:
    """Cellen voor de avatar-widget; het .formaat als het er is, anders de PNG.

    De widget moet precies zo groot zijn als de tekst die `render_avatar`
    produceert, anders rekent hij met een andere verhouding en wordt het
    portret uitgerekt of afgesneden. Daarom dezelfde bron, in dezelfde volgorde.
    """
    cells = ans_cells(ANS_AVATAR if ans_path is None else ans_path)
    if cells is not None:
        return cells
    return fitted_cells(
        str(PNG_AVATAR if png_path is None else png_path), max_cols, max_rows
    )
