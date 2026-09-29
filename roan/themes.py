from textual.theme import Theme

# Accentkleur is vast: fel roze. Alle Catppuccin-thema's gebruiken deze.
ACCENT = "#FF2E88"

MOCHA = Theme(
    name="mocha",
    primary=ACCENT,
    accent=ACCENT,
    secondary="#CBA6F7",
    background="#1E1E2E",
    surface="#313244",
    panel="#181825",
    foreground="#CDD6F4",
    warning="#F9E2AF",
    error="#F38BA8",
    success="#A6E3A1",
)

MACCHIATO = Theme(
    name="macchiato",
    primary=ACCENT,
    accent=ACCENT,
    secondary="#C6A0F6",
    background="#24273A",
    surface="#363A4F",
    panel="#1E2030",
    foreground="#CAD3F5",
    warning="#F5A97F",
    error="#ED8796",
    success="#A6DA95",
)

FRAPPE = Theme(
    name="frappe",
    primary=ACCENT,
    accent=ACCENT,
    secondary="#CA9EE6",
    background="#303446",
    surface="#414559",
    panel="#292C3C",
    foreground="#C6D0F5",
    warning="#E5C890",
    error="#E78284",
    success="#A6D189",
)

LATTE = Theme(
    name="latte",
    primary=ACCENT,
    accent=ACCENT,
    secondary="#8839EF",
    background="#EFF1F5",
    surface="#CCD0DA",
    panel="#E6E9EF",
    foreground="#4C4F69",
    warning="#DF8E1D",
    error="#D20F39",
    success="#40A02B",
)

THEMES = [MOCHA, MACCHIATO, FRAPPE, LATTE]
