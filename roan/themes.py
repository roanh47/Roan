"""Catppuccin-thema's voor Roan.

De vier smaken van de officiële Catppuccin-palette (https://catppuccin.com/palette).
Textual levert ze zelf al compleet (met alle afgeleide kleuren goed ingesteld);
wij nemen die als basis en zetten per smaak **de Catppuccin-pink** als accent.

Pink per smaak:
    latte      #EA76CB
    frappe     #F4B8E4
    macchiato  #F5BDE6
    mocha      #F5C2E7

De rest van de palette komt ongewijzigd uit de ingebouwde thema's, dus er kan
nooit per ongeluk een groen of blauw accent opduiken.
"""

from textual.theme import BUILTIN_THEMES, Theme

# De pink van elke Catppuccin-smaak.
PINK = {
    "latte": "#EA76CB",
    "frappe": "#F4B8E4",
    "macchiato": "#F5BDE6",
    "mocha": "#F5C2E7",
}

# Catppuccin gebruikt lavender voor randen; per smaak, zodat alle vier smaken
# dezelfde opbouw hebben (de ingebouwde latte had er geen).
LAVENDER = {
    "latte": "#7287FD",
    "frappe": "#BABBF1",
    "macchiato": "#B7BDF8",
    "mocha": "#B4BEFE",
}

# Leesbare tekst op de pink: de donkerste tint van elke smaak.
ON_PINK = {
    "latte": "#4C4F69",
    "frappe": "#232634",
    "macchiato": "#181926",
    "mocha": "#11111B",
}

# Eén trede lichter dan het popupvlak: invoervelden, knoppen, hover.
SURFACE1 = {
    "latte": "#BCC0CC",
    "frappe": "#51576D",
    "macchiato": "#494D64",
    "mocha": "#45475A",
}

# De scrollbalk: rustig, niet schreeuwerig.
SCROLLBAR = {
    "latte": "#BCC0CC",
    "frappe": "#51576D",
    "macchiato": "#494D64",
    "mocha": "#45475A",
}

THEME_NAMES = ("latte", "frappe", "macchiato", "mocha")
DEFAULT_THEME = "mocha"


def _build(flavor: str) -> Theme:
    """Een Catppuccin-smaak met de eigen pink als accent."""
    builtin = BUILTIN_THEMES[f"catppuccin-{flavor}"]
    pink = PINK[flavor]
    on_pink = ON_PINK[flavor]
    # De randen en de footer komen uit het ingebouwde thema; alleen accent en
    # primary worden pink, plus de knoptekst die op dat vlak leesbaar moet zijn.
    variables = dict(builtin.variables)
    variables["button-color-foreground"] = on_pink
    variables["border"] = LAVENDER[flavor]
    variables["border-blurred"] = builtin.panel
    # Selectie (lijstjes, tekst) gebruikt overal de pink, nooit het blauw van
    # Textual's standaardthema.
    variables["block-cursor-background"] = pink
    variables["block-cursor-foreground"] = on_pink
    variables["block-cursor-text-style"] = "bold"
    variables["block-hover-background"] = SURFACE1[flavor]
    variables["input-selection-background"] = pink
    variables["input-selection-foreground"] = on_pink
    variables["input-cursor-background"] = pink
    variables["input-cursor-foreground"] = on_pink
    variables["scrollbar"] = SCROLLBAR[flavor]
    variables["scrollbar-hover"] = pink
    variables["scrollbar-active"] = pink
    variables["scrollbar-background"] = builtin.surface
    return Theme(
        name=flavor,
        primary=pink,
        accent=pink,
        secondary=builtin.secondary,
        warning=builtin.warning,
        error=builtin.error,
        success=builtin.success,
        foreground=builtin.foreground,
        background=builtin.background,
        surface=builtin.surface,
        panel=builtin.panel,
        dark=builtin.dark,
        luminosity_spread=builtin.luminosity_spread,
        text_alpha=builtin.text_alpha,
        variables=variables,
    )


THEMES = [_build(name) for name in THEME_NAMES]
THEME_BY_NAME = {theme.name: theme for theme in THEMES}

# Vaste pink voor de paar plekken die een letterlijke kleur nodig hebben
# (Markdown/Static-opmaak kan geen $accent gebruiken).
ACCENT = PINK[DEFAULT_THEME]

_current = DEFAULT_THEME


def set_current(name: str) -> str:
    """Onthoud welke smaak actief is, voor letterlijke kleurgebruik."""
    global _current
    if name in PINK:
        _current = name
    return _current


def accent_color() -> str:
    """De pink van de nu actieve smaak."""
    return PINK.get(_current, ACCENT)


def is_valid(name: str) -> bool:
    return name in PINK
