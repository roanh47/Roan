#!/usr/bin/env python3
"""Build the app icon set from one square source photo.

The artwork is the user's own picture and it is the icon on every platform; this
script only produces the shapes the platforms expect:

  icon-square.png   1024x1024, the photo exactly as it is. Windows, Linux and
                    Android take this one; Android masks it per launcher.
  icon-macos.png    1024x1024, the photo placed on Apple's icon grid: 824x824 of
                    content centred in the canvas with the standard rounded
                    square (radius 185), corners transparent. The photo is
                    scaled to fit, never cropped.

Run:  python3 scripts/make-icons.py <source-image> [repo-root]
Then: npx tauri icon src-tauri/icons/icon-square.png
      npx tauri icon src-tauri/icons/icon-macos.png -o /tmp/roan-icons-macos
      cp /tmp/roan-icons-macos/icon.icns src-tauri/icons/icon.icns
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

CONTENT = 824  # Apple's macOS icon grid: content area inside a 1024 canvas
RADIUS = 185  # the corner radius Apple ships, at 1024
CANVAS = 1024
SS = 4  # supersampling for the rounded corners


def square(source: Image.Image) -> Image.Image:
    """The photo on a 1024 canvas, untouched: scaled only if it is not square."""
    if source.width != source.height:
        side = min(source.width, source.height)
        left = (source.width - side) // 2
        top = (source.height - side) // 2
        source = source.crop((left, top, left + side, top + side))
    return source.convert("RGBA").resize((CANVAS, CANVAS), Image.LANCZOS)


def macos(source: Image.Image) -> Image.Image:
    """The photo inside the standard rounded square, nothing cropped."""
    art = square(source).resize((CONTENT, CONTENT), Image.LANCZOS)
    mask = Image.new("L", (CONTENT * SS, CONTENT * SS), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, CONTENT * SS - 1, CONTENT * SS - 1), radius=RADIUS * SS, fill=255
    )
    mask = mask.resize((CONTENT, CONTENT), Image.LANCZOS)

    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    offset = (CANVAS - CONTENT) // 2
    canvas.paste(art, (offset, offset), mask)
    return canvas


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    source = Image.open(sys.argv[1])
    root = Path(sys.argv[2] if len(sys.argv) > 2 else ".").resolve()
    icons = root / "src-tauri" / "icons"
    icons.mkdir(parents=True, exist_ok=True)

    flat = square(source)
    flat.save(icons / "icon-square.png")
    flat.save(icons / "icon-1024.png")
    macos(source).save(icons / "icon-macos.png")
    # 512 for the Linux packaging path that still looks for a plain icon.png
    flat.resize((512, 512), Image.LANCZOS).save(icons / "icon.png")
    print(f"wrote {icons}/icon-square.png, icon-macos.png, icon-1024.png, icon.png")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
