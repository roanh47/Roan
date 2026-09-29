from pathlib import Path

from rich.style import Style
from rich.text import Text


def render_photo(path: str, width: int = 24, height: int = 10) -> Text:
    """Render an image as a grid of colored half-blocks (works in every terminal)."""
    try:
        from PIL import Image
    except ImportError:
        return Text("(install Pillow om de foto te renderen)")

    p = Path(path).expanduser()
    if not p.exists():
        return Text("")

    try:
        img = Image.open(p).convert("RGB")
    except Exception:
        return Text("")

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
