"""Afbeelding → raster van halve blokken, met behoud van de verhouding.

Een tekenkaart is ongeveer twee keer zo hoog als breed, dus een vierkante
afbeelding van N kolommen breed hoort N/2 rijen hoog te zijn. Zonder die
correctie wordt een vierkant portret platgedrukt of uitgerekt.
"""

from pathlib import Path

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
