"""Thema's voor Roan: de vier Catppuccin-smaken, altijd roze als accent.

Elk thema is een clone van Textual's ingebouwde `catppuccin-<flavour>` met
roze als primary/accent en lavender als rand. Zie `palette.md` en
`pink-accent.md` voor de redenen.
"""

from textual.theme import BUILTIN_THEMES, Theme

PINK = {
    "latte": "#EA76CB",
    "frappe": "#F4B8E4",
    "macchiato": "#F5BDE6",
    "mocha": "#F5C2E7",
}

LAVENDER = {
    "latte": "#7287FD",
    "frappe": "#BABBF1",
    "macchiato": "#B7BDF8",
    "mocha": "#B4BEFE",
}

ON_PINK = {
    "latte": "#4C4F69",
    "frappe": "#232634",
    "macchiato": "#181926",
    "mocha": "#11111B",
}

SOURCE = {
    "latte": "catppuccin-latte",
    "frappe": "catppuccin-frappe",
    "macchiato": "catppuccin-macchiato",
    "mocha": "catppuccin-mocha",
}

THEME_NAMES: tuple[str, ...] = ("latte", "frappe", "macchiato", "mocha")


def _build(name: str) -> Theme:
    base = BUILTIN_THEMES[SOURCE[name]]
    pink = PINK[name]
    on_pink = ON_PINK[name]
    panel = base.panel if base.panel else base.surface
    return Theme(
        name=name,
        primary=pink,
        accent=pink,
        secondary=LAVENDER[name],
        foreground=base.foreground,
        background=base.background,
        surface=base.surface,
        panel=panel,
        success=base.success,
        warning=base.warning,
        error=base.error,
        dark=base.dark,
        luminosity_spread=base.luminosity_spread,
        text_alpha=base.text_alpha,
        ansi=base.ansi,
        variables={
            "border": LAVENDER[name],
            "border-blurred": base.surface,
            "text-muted": str(base.foreground),
            "button-color-foreground": on_pink,
            "block-cursor-background": pink,
            "block-cursor-foreground": on_pink,
            "block-cursor-text-style": "bold",
            "block-hover-background": str(base.surface),
            "input-selection-background": pink,
            "input-selection-foreground": on_pink,
            "input-cursor-background": pink,
            "input-cursor-foreground": on_pink,
            "scrollbar": str(base.surface),
            "scrollbar-hover": pink,
            "scrollbar-active": pink,
            "scrollbar-background": str(base.background),
        },
    )


THEMES: list[Theme] = [_build(n) for n in THEME_NAMES]
THEME_BY_NAME = {theme.name: theme for theme in THEMES}

LABELS = {
    "latte": "Latte",
    "frappe": "Frappé",
    "macchiato": "Macchiato",
    "mocha": "Mocha",
}

DEFAULT_THEME = "mocha"

ACCENTS = {theme.name: str(theme.primary) for theme in THEMES}
ACCENT = ACCENTS[DEFAULT_THEME]

_current = DEFAULT_THEME


def set_current(name: str) -> str:
    global _current
    if name in THEME_BY_NAME:
        _current = name
    return _current


def accent_of(name: str) -> str:
    """De accentkleur van een thema, of van het actieve thema zonder argument."""
    return ACCENTS.get(name, ACCENT)


def accent_color() -> str:
    """De accentkleur die nu actief is."""
    return accent_of(_current)


def is_valid(name: str) -> bool:
    return name in THEME_BY_NAME
