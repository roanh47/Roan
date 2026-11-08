from pathlib import Path

from rich.style import Style
from rich.text import Text

# Achtergrond waarop transparante PNG's worden gecomposiet (donkere terminal).
_BG = (20, 22, 28)


def render_photo(path: str, width: int = 24, height: int = 10) -> Text:
    """Render een afbeelding als een raster van gekleurde half-blocks."""
    try:
        from PIL import Image
    except ImportError:
        return Text("(install Pillow om de foto te renderen)")

    p = Path(path).expanduser()
    if not p.exists():
        return Text("")

    try:
        img = Image.open(p)
    except Exception:
        return Text("")

    # Transparantie (RGBA/LA/P) → composite op een vaste achtergrond.
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        bg = Image.new("RGBA", img.size, (*_BG, 255))
        img = Image.alpha_composite(bg, img).convert("RGB")
    else:
        img = img.convert("RGB")

    img = img.resize((width, height * 2), Image.LANCZOS)
    px = img.load()

    text = Text()
    for y in range(0, height * 2, 2):
        for x in range(width):
            top = px[x, y]
            bot = px[x, y + 1]
            style = Style(
                color=f"rgb({top[0]},{top[1]},{top[2]})",
                bgcolor=f"rgb({bot[0]},{bot[1]},{bot[2]})",
            )
            text.append("▀", style)
        text.append("\n")
    return text
