"""Thema's voor Roan.

Geen Catppuccin-familie meer: die vier smaken zaten zo dicht op elkaar dat het
kiezen ervan geen keuze was. In plaats daarvan losse thema's, zoals opencode ze
aanbiedt, met één eigen thema (`roan`) als default.

Roze blijft overal het accent. Dat is het merk, niet een eigenschap van één
palette: elk thema levert zijn eigen achtergrond/voorgrond/panelen, maar de
accentkleur (prompt, cursor, selectie, randen) komt van ons.
"""

from textual.color import Color
from textual.theme import BUILTIN_THEMES, Theme

# ---------- Roan's eigen palette ----------
ROAN = {
    "background": "#14161c",
    "surface": "#1b1e26",
    "panel": "#232733",
    "foreground": "#dfe3ec",
    "accent": "#ff2e88",
}

PINK_DARK = "#ff2e88"  # op donkere thema's
PINK_LIGHT = "#c2006b"  # dieper, anders valt hij weg op een licht thema
ON_PINK = "#14161c"  # tekst op een roze vlak

# Eigen thema eerst, daarna Textual's builtins — zonder catppuccin.
THEME_NAMES: tuple[str, ...] = (
    "roan",
    "tokyo-night",
    "gruvbox",
    "nord",
    "dracula",
    "monokai",
    "rose-pine",
    "rose-pine-moon",
    "rose-pine-dawn",
    "solarized-dark",
    "solarized-light",
    "atom-one-dark",
    "atom-one-light",
    "flexoki",
    "textual-dark",
    "textual-light",
    "ansi-dark",
    "ansi-light",
)

LABELS = {
    "roan": "Roan",
    "tokyo-night": "Tokyo Night",
    "gruvbox": "Gruvbox",
    "nord": "Nord",
    "dracula": "Dracula",
    "monokai": "Monokai",
    "rose-pine": "Rosé Pine",
    "rose-pine-moon": "Rosé Pine Moon",
    "rose-pine-dawn": "Rosé Pine Dawn",
    "solarized-dark": "Solarized Dark",
    "solarized-light": "Solarized Light",
    "atom-one-dark": "Atom One Dark",
    "atom-one-light": "Atom One Light",
    "flexoki": "Flexoki",
    "textual-dark": "Textual Dark",
    "textual-light": "Textual Light",
    "ansi-dark": "Terminal (donker)",
    "ansi-light": "Terminal (licht)",
}

DEFAULT_THEME = "roan"


def _colour(value, fallback: str) -> str:
    """Nooit `None` of "None" doorgeven aan `Color.parse`.

    Een paar Textual-thema's laten een kleur leeg omdat ze die van de
    terminal zelf overnemen (`textual-dark` heeft geen `background`,
    `textual-light` geen `foreground`). `str(None)` is de string "None", en
    `Color.parse("None")` gooit een ColorParseError: het hele programma
    startte daardoor niet meer.
    """
    if value is None:
        return fallback
    text = str(value).strip()
    if not text or text.lower() == "none":
        return fallback
    return text


def _is_light(background: str) -> bool:
    try:
        c = Color.parse(background)
    except Exception:
        return False
    return (c.r * 299 + c.g * 587 + c.b * 114) / 1000 > 128


def _accent_for(background: str) -> str:
    return PINK_LIGHT if _is_light(background) else PINK_DARK


def _variables(
    background: str, foreground: str, surface: str, accent: str, panel: str
) -> dict:
    """De variabelen die onze CSS gebruikt.

    Zonder deze valt Textual terug op zijn eigen blauw/groen en zie je door de
    thema-keuze heen nog steeds hetzelfde standaarduiterlijk.
    """
    return {
        "border": accent,
        "border-blurred": surface,
        "text-muted": foreground,
        "text-disabled": surface,
        "button-color-foreground": ON_PINK,
        "block-cursor-background": accent,
        "block-cursor-foreground": ON_PINK,
        "block-cursor-text-style": "bold",
        "block-hover-background": surface,
        "input-selection-background": accent,
        "input-selection-foreground": ON_PINK,
        "input-cursor-background": accent,
        "input-cursor-foreground": ON_PINK,
        "scrollbar": surface,
        "scrollbar-hover": accent,
        "scrollbar-active": accent,
        "footer-key-foreground": accent,
        "footer-description-foreground": foreground,
        # $panel moet echt de eigen paneelkleur zijn, niet $surface: anders
        # vallen invoervelden weg tegen het popupvlak.
        "panel": panel,
    }


def _build_roan() -> Theme:
    accent = ROAN["accent"]
    return Theme(
        name="roan",
        primary=accent,
        accent=accent,
        secondary=PINK_LIGHT,
        foreground=ROAN["foreground"],
        background=ROAN["background"],
        surface=ROAN["surface"],
        panel=ROAN["panel"],
        success="#3fbf7f",
        warning="#e0b64a",
        error="#ff5c5c",
        dark=True,
        luminosity_spread=0.15,
        text_alpha=0.95,
        variables=_variables(
            ROAN["background"],
            ROAN["foreground"],
            ROAN["surface"],
            accent,
            ROAN["panel"],
        ),
    )


def _build(name: str) -> Theme:
    """Een builtin van Textual, maar met onze roze accent."""
    if name == "roan":
        return _build_roan()

    base = BUILTIN_THEMES.get(name)
    if base is None:
        # Onbekende naam: val terug op ons eigen thema in plaats van te crashen.
        return _build_roan()

    # Elk veld kan None zijn bij thema's die de terminalkleur overnemen.
    background = _colour(base.background, ROAN["background"])
    foreground = _colour(base.foreground, ROAN["foreground"])
    accent = _accent_for(background)
    surface = _colour(base.surface, _colour(base.panel, background))
    panel = _colour(base.panel, _colour(base.surface, background))
    return Theme(
        name=name,
        primary=accent,
        accent=accent,
        secondary=_colour(base.secondary, accent),
        foreground=foreground,
        background=background,
        surface=surface,
        panel=panel,
        success=_colour(base.success, "#3fbf7f"),
        warning=_colour(base.warning, "#e0b64a"),
        error=_colour(base.error, "#ff5c5c"),
        dark=bool(base.dark),
        luminosity_spread=base.luminosity_spread,
        text_alpha=base.text_alpha,
        ansi=base.ansi,
        variables=_variables(background, foreground, surface, accent, panel),
    )


THEMES: list[Theme] = [_build(name) for name in THEME_NAMES]
THEME_BY_NAME = {theme.name: theme for theme in THEMES}

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
