import asyncio
import json
import os
import weakref
from pathlib import Path

from textual import on, work
from textual.app import App, ComposeResult
from textual.containers import Horizontal, Vertical, VerticalScroll
from textual.css.scalar import Scalar, Unit
from textual.events import Click
from textual.binding import Binding
from textual.geometry import Region
from textual.screen import ModalScreen
from textual.widgets import (
    Button,
    Input,
    Label,
    Markdown,
    OptionList,
    Rule,
    Select,
    Static,
)
from textual.widgets.option_list import Option

try:
    from textual_image import widget as _image_widget

    _HAS_HD = True
except Exception:
    _image_widget = None
    _HAS_HD = False

from . import commands
from .agent import Agent
from .config import (
    MODES,
    PERMISSIONS,
    PROVIDER_PRESETS,
    ROAN_DIR,
    THINKING_LEVELS,
    add_endpoint,
    get_endpoint,
    get_endpoints,
    is_configured,
    load_config,
    remove_endpoint,
    save_config,
)
from .models import (
    fetch_provider_models,
    list_dev,
    list_local,
    list_models,
    list_providers,
    local_endpoint,
    provider_meta,
    LOCAL_IDS,
)
from .i18n import provider_desc, t
from .photo import ANS_AVATAR, ANS_CELLS, avatar_cells, render_avatar
from .themes import (
    DEFAULT_THEME,
    PINK,
    THEME_BY_NAME,
    THEME_NAMES,
    THEMES,
    accent_color,
    is_valid,
    set_current,
)

BUNDLED_AVATAR = Path(__file__).parent / "assets" / "avatar.png"

# Kolommen waarin het portret past. De meegeleverde tekening is 24 kolommen
# breed en heeft die breedte niet uit zichzelf; de 26 is de grens waarin een
# raster uit de PNG mag schalen.
AVATAR_COLS = 26

# Lucht tussen het laatste teken van een berichtregel en de rand van het
# zwevende portret. Voor de rijen die het portret beslaat is zijn linkerrand de
# rechterrand van het scherm, dus de tekst breekt daarvoor af — met één kolom
# ertussen, want plakken tegen de ╭ van het kader leest als afgebroken.
# `styles.margin_right` zou hetzelfde doen, maar dat plakt in Textual 8.2.8:
# gemeten leest het terug als 0. Daarom zetten wij een breedte, `styles.width`.
AVATAR_WRAP_GAP = 1

# Hoeveel ronden `_wrap_ronde` maximaal achter elkaar loopt zonder dat er een
# nieuwe aanleiding komt. Nodig omdat één breedte de hoogtes verandert en dus
# de plek van de volgende berichten; twee ronden zijn normaal genoeg. Het
# plafond is er voor het geval dat een bericht echt hoogte 0 houdt (een lege
# `Static`), zodat er geen eindeloze lus ontstaat.
WRAP_RONDES = 3

# Pad waar nooit een vooraf gerenderde tekening staat. `render_avatar` en
# `avatar_cells` zoeken eerst het .ans-bestand en vallen anders terug op de
# PNG; wijst je hen hierheen, dan lezen ze een leeg apparaat, krijgen ze geen
# tekening en blijft dus alleen het PNG-pad over. Dat is nodig als wij de
# valback bewust kiezen: een te kort scherm of een eigen foto.
NO_AVATAR_ANS = Path(os.devnull)

CLOSE_GLYPH = "✕"

# Het teken dat beide kanten van het gesprek markeren. Hetzelfde teken, maar de
# kleur zegt wie er spreekt: de gebruiker in de pink van het thema (`$accent`),
# Roan in het gedempte grijs (`$text-muted`), zodat het als secondair leest.
# Beide kleuren staan in de CSS van `RoanApp`, dus ze volgen het thema mee en
# een theme-switch hoeft geen enkele plek in de code te raken.
PROMPT_MARK = "❯"

# Kolommen lege ruimte tussen het eind van een rij en de scrollbar ernaast.
#
# Waarom niet gewoon `margin-right` of `padding-right` op de lijst: die leggen de
# kolom aan de ANDERE kant van de scrollbar, dus tegen de rand van het popup.
# De gebruiker wil de lucht tussen de tekst en de scrollbar, zodat de
# gemarkeerde rij niet in de scrollbar lijkt te lopen. De scrollbar zit altijd
# tegen de rechterrand van de inwendige breedte (gemeten in 8.2.8, zie
# `Widget._arrange_scrollbars`), dus die kolom kan alleen uit de rij zelf komen:
# de rij is één kolom korter dan de lijst. `scrollbar-gutter: stable` reserveert
# de scrollbarkolommen ook als de scrollbar er nog niet is, zodat de breedte van
# de rij niet meer springt zodra de lijst over de drempel heen groeit.
SCROLLBAR_GAP = 1


def clip_cells(text: str, cells: int) -> str:
    """Kort `text` af tot `cells` kolommen, met een liggende streep erin.

    Past `text` al, dan komt hij onveranderd terug — anders zou een passende
    tekst alsnog een streep krijgen. Afkappen en nooit ombreken: een rij die
    ombreekt wordt twee regels en de tabelkolomen van de commandopalette zouden
    allemaal een regel opschuiven.
    """
    from rich.cells import cell_len

    if cell_len(text) <= cells:
        return text
    out: list[str] = []
    used = 0
    for char in text:
        wide = cell_len(char)
        if used + wide > cells - 1:
            break
        out.append(char)
        used += wide
    return "".join(out) + "…"


def user_line(content: str) -> Static:
    """De regel van de gebruiker: pink ❯ en pinke tekst.

    Eén plek voor alle drie de call sites (live, hersteld gesprek, transcript),
    zodat de kleur niet op de ene plek pink en op de andere niet kan zijn. De
    kleur komt uit de CSS-klasse `.user-line`, niet uit de markup: markup wint
    van CSS en zou het thema dus negeren.
    """
    return Static(f"{PROMPT_MARK} {content}", classes="user-line")


def roan_reply(content) -> Horizontal:
    """Roans antwoord: de grijze ❯ links, de markdown ernaast.

    Zonder teken leek elk antwoord op de volgende regel van de gebruiker. Het
    teken staat in een eigen kolom, zodat de tekst van beide kanten op dezelfde
    kolom begint. De kleur is `$text-muted`, dus dit is secondair en niet het
    accent.
    """
    return Horizontal(
        Static(PROMPT_MARK, classes="roan-mark"),
        Markdown(content),
        classes="roan-reply",
    )


def _compact_tokens(n: int) -> str:
    """12345 -> 12.3K, zoals opencode het in de balk zet."""
    if n < 1000:
        return str(n)
    if n < 1_000_000:
        return f"{n / 1000:.1f}K"
    return f"{n / 1_000_000:.1f}M"


def _cellen(scalar: Scalar | None) -> int | None:
    """Hoeveel cellen een `Scalar` waard is, of `None` als hij niets zegt.

    `None` betekent: er staat geen regel, of de regel is geen aantal cellen
    (`50%`, `1fr`). Wij zetten zelf alleen cellen of niets, en daarom willen we
    een breedte in `%` of `fr` niet als cells lezen en overschrijven.
    """
    if scalar is None or scalar.unit is not Unit.CELLS:
        return None
    return int(scalar.value)


IMAGE_MODES = ("auto", "sixel", "tgp", "halfcell", "unicode")

# Vanaf welke vensterbreedte een chip uit de statusbalk mag blijven staan.
#
# De drempels zijn gemeten, niet geschat: 4 kolomen balkpadding, ~30 kolomen
# voor `◆ model  ·  provider` links (dat is `◆ glm-5.3-flash  ·  lmstudio` = 28
# plus twee ruimte) en de clusterbreedte tot en met die chip. Elke chip kost zijn
# tekst plus 2 kolommen padding, en elke bullet 3 kolommen (`·  `, de spatie
# ervoor komt uit de padding van de vorige chip). Dus, met de langste waarden
# (`Think: medium`, `Mode: Build`, `Approvals: user`):
#
#   hints                     20
#   perm   20 + 20      = 40  ->  4 + 30 + 40  =  74
#   mode   40 + 15      = 55  ->  4 + 30 + 55  =  89, met marge 90
#   think  55 + 17      = 72  ->  4 + 30 + 72  = 106
#   tokens 72 + 14      = 86  ->  4 + 30 + 86  = 118, met marge 122
#
# Zo valt de 1fr-linkerkant nooit weg; ctrl+p staat buiten deze lijst en blijft
# dus op elke breedte staan (die chip is wel 20 kolommen breed, dus onder de 52
# kolommen gaat de provider als eerste in de knelp).
STATUS_FITS = (
    ("#status-perm", 74),
    ("#status-mode", 90),
    ("#status-thinking", 106),
    ("#status-tokens", 122),
)


def _image_widget_class(mode: str | None = None):
    """Kies de renderroutine voor de avatar.

    textual_image kiest zelf op basis van een probe: die stelt een vraag naar
    sixel/TGP en *vertrouwt* het antwoord van de terminal. Een terminal die het
    protocol wél tekent maar het niet aankondigt (Termius doet dat) valt daardoor
    terug op halve blokjes in plaats van een echt beeld. Daarom kun je het zelf
    overstemmen met ROAN_IMAGE=sixel/tgp/halfcell of de configkey `image`.
    """
    if _image_widget is None:
        return None
    mode = (mode or os.environ.get("ROAN_IMAGE") or "").strip().lower()
    if not mode:
        try:
            mode = str(load_config().get("image") or "auto").strip().lower()
        except Exception:
            mode = "auto"
    if mode == "sixel":
        return _image_widget.SixelImage
    if mode == "tgp":
        return getattr(_image_widget, "TGPImage", None) or _image_widget.Image
    if mode == "halfcell":
        return _image_widget.HalfcellImage
    if mode == "unicode":
        return _image_widget.UnicodeImage
    return _image_widget.Image


def _image_is_graphical(mode: str | None = None) -> bool:
    """Tekent de gekozen route echt een beeld (sixel/TGP), of valt hij terug?

    Dit onderscheid is belangrijk: de halfcell-renderable van textual_image
    negeert het alfakanaal en tekent doorzichtige pixels als wit. Op die
    manier staat je avatar dan als een witte vlak in het chatvenster. Bij die
    valback tekenen we het zelf, op de thema-achtergrond, zodat de marge
    wegvalt in de terminal.
    """
    widget = _image_widget_class(mode)
    if widget is None:
        return False
    renderable = getattr(widget, "_Renderable", None)
    module = getattr(renderable, "__module__", "")
    return module.endswith("sixel") or module.endswith("tgp")


def _titlebar(title: str, close_id: str | None = "close"):
    """Titel links, sluitknop (✕) rechtsboven (weglaten met close_id=None)."""
    with Horizontal(classes="titlebar"):
        yield Static(title, classes="title")
        if close_id:
            yield Button(CLOSE_GLYPH, id=close_id, classes="close")


# Opmaak die alle popups delen, zodat setup/provider/modellen/thema/commando's
# er hetzelfde uitzien: één rand uit het thema, vlakken in drie treden en het
# accent van het thema.
# De buitenste Vertical van een popup krijgt de class "popup".
POPUP_CSS = """
    .popup {
        height: auto;
        max-height: 100%;
        border: round $border;
        background: $surface;
        padding: 1 2;
    }
    .popup .titlebar {
        height: 1;
        margin-bottom: 1;
    }
    /* titel netjes boven de velden, niet er 2 kolommen naast */
    .popup .titlebar .title {
        padding: 0;
    }
    /* kopje van een veld */
    .popup .section {
        height: 1;
        color: $text-muted;
    }
    /* vet kopje: het gaat hier om (bijvoorbeeld 'Provider' in de setup) */
    .popup .section.strong {
        text-style: bold;
    }
    /* scheidingslijn tussen twee groepen velden. `Rule.sep` weegt zwaarder dan
       `Rule.-horizontal` uit de DEFAULT_CSS van Rule, dus de marge van Rule
       (margin: 1 0) valt weg en de lijn kost maar één regel. */
    Rule.sep {
        height: 1;
        width: 1fr;
        margin: 0;
        padding: 0;
        color: $border;
    }
    /* de huidige waarde naast een kies-knop */
    .popup .value {
        width: 1fr;
        height: 1;
        color: $foreground;
        text-overflow: ellipsis;
    }
    .popup .hint {
        height: 1;
        margin-top: 1;
        color: $text-muted;
        text-overflow: ellipsis;
    }
    .popup .row {
        height: 1;
    }
    .popup Input {
        height: 1;
        background: $panel;
        color: $foreground;
        padding: 0 1;
    }
    .popup Input:focus {
        background: $accent 30%;
    }
    .popup Select {
        height: 1;
        background: $panel;
    }
    /* waarde netjes links uitlijnen met de lijst eronder */
    .popup Select > SelectCurrent {
        padding: 0;
    }
    .popup OptionList {
        background: transparent;
        border: none;
        padding: 0;
    }
    .popup OptionList > .option-list--option {
        padding: 0;
    }
    .popup Button {
        height: 1;
        min-width: 6;
        background: $panel;
        color: $foreground;
        padding: 0 1;
    }
    /* De ✕ is overal 5 kolommen breed met het teken gecentreerd. Zonder deze
       regel wint `.popup Button` (specificiteit 0,2,0) van `.close` (0,1,0) en
       wordt de knop 6 kolommen: min-width 6 plus padding 0 1. */
    .popup Button.close {
        width: 5;
        min-width: 5;
        max-width: 5;
        padding: 0;
        content-align: center middle;
    }
    .popup Button.-primary {
        background: $accent;
        color: $background;
        text-style: bold;
    }
    .popup Button:hover,
    .popup Button:focus {
        background: $accent;
        color: $background;
        text-style: bold;
    }
    .popup .actions {
        height: 1;
        margin-top: 1;
        align-horizontal: right;
    }
    /* Twee kolomen lucht tussen twee knoppen. Textual neemt tussen twee
       naast elkaar liggende widgets de GROOTSTE van de rechter- en de
       linkermarge (geen som), dus `margin-right: 2` levert precies twee lege
       kolommen ertussen; de laatste knop krijgt geen marge, zodat de rij
       flush tegen de rand blijft staan. */
    .popup .actions Button {
        margin-right: 2;
    }
    .popup .actions Button:last-child {
        margin-right: 0;
    }
    /* In een rij staat de waarde links en de kies-knop rechts: 2 kolomen lucht. */
    .popup .row Button {
        margin-left: 2;
    }
"""


def resolve_base_url(provider: str) -> str:
    """Base URL voor een provider: eerst onze presets, anders uit models.dev."""
    preset = PROVIDER_PRESETS.get(provider) or {}
    if preset.get("base_url"):
        return str(preset["base_url"])
    return str(provider_meta(provider).get("api") or "")


def provider_description(provider: str) -> str:
    """Korte beschrijving van een provider voor in de lijst.

    Leeg als we de provider niet kennen en er geen modellen van weten — dan
    tonen we alleen de naam.
    """
    desc = provider_desc(provider)
    if desc:
        return desc
    meta = provider_meta(provider)
    count = len(meta.get("models") or [])
    if meta.get("plan"):
        return t("provider_desc_plan", n=count)
    if not count:
        return ""
    return t("provider_desc_models", n=count)


def gather_models() -> tuple[list, list, list]:
    """(free, paid, custom) model-lijsten voor de browsers."""
    cfg = load_config()
    return (
        list_dev("free"),
        list_dev("paid"),
        fetch_provider_models(cfg["base_url"], cfg["api_key"]),
    )


def tool_summary(name: str, args: dict) -> str:
    """Korte weergave van tool-argumenten voor in de TUI."""
    if name == "run_shell":
        return str(args.get("command", ""))[:120]
    for key in ("path", "pattern", "url", "query", "note"):
        if args.get(key):
            return str(args[key])[:120]
    if name == "write_file":
        return str(args.get("path", ""))[:120]
    return json.dumps(args, ensure_ascii=False)[:120] if args else ""


class HistoryInput(Input):
    """Input met geschiedenis: pijltje op/neer bladert door eerdere berichten."""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self._history: list[str] = []
        self._idx = 0

    def add_history(self, text: str) -> None:
        text = text.strip()
        if not text:
            return
        if not self._history or self._history[-1] != text:
            self._history.append(text)
        self._idx = len(self._history)

    def on_key(self, event) -> None:
        if event.key in ("tab", "shift+tab"):
            # Tab moet hier het commando aanvullen en niet de focus verplaatsen,
            # anders springt de focus naar de suggestielijst en doet Enter niets.
            accept = getattr(self.app, "_accept_slash", None)
            if accept is not None and accept(-1 if event.key == "shift+tab" else 0):
                event.stop()
                event.prevent_default()
                return
        if event.key == "up":
            if not self._history:
                return
            self._idx = max(0, self._idx - 1)
            self.value = self._history[self._idx]
            self.cursor_position = len(self.value)
            event.stop()
        elif event.key == "down":
            if not self._history:
                return
            self._idx = min(len(self._history), self._idx + 1)
            self.value = self._history[self._idx] if self._idx < len(self._history) else ""
            self.cursor_position = len(self.value)
            event.stop()


class SetupScreen(ModalScreen):
    """Setup-scherm: provider, api-sleutel, model. Automatisch bij de eerste start."""

    # Wat er in het api-key-veld staat zolang je er niet in klikt. Dit is géén
    # '(leeg = behouden)': het veld toont altijd iets, en de echte sleutel komt
    # tevoorschijn zodra je op het veld klikt.
    KEY_MASK = "sk-…"

    CSS = POPUP_CSS + """
    #setup-box {
        width: 92%;
        max-width: 74;
        /* Op een heel klein venster past de kist niet; dan scroll je naar de
           knoppen toe in plaats van dat Opslaan buiten beeld valt. */
        overflow-y: auto;
    }
    """

    def __init__(self, provider=None, model=None, base_url=None, required: bool = False):
        super().__init__()
        cfg = load_config()
        self.provider = provider or cfg.get("provider") or ""
        self.model = model or cfg.get("model") or ""
        self.base_url = base_url or cfg.get("base_url") or ""
        # Verplicht = er is nog niets ingesteld; dan kun je dit scherm niet wegklikken.
        self.required = required
        # De bewaarde sleutel; het veld toont KEY_MASK tot je erop klikt.
        self.api_key = cfg.get("api_key") or ""
        # Per keer dat het scherm opent staat het velw weer op de maskering.
        self._revealed = False
        self._unmasking = False
        # Er loopt al een modellenlaadbeurt (netwerk).
        self._loading_models = False

    BINDINGS = [("escape", "cancel", "terug")]

    def action_cancel(self) -> None:
        if self.required:
            self.query_one("#required-hint", Static).update(t("setup_required_nudge"))
            return
        self.dismiss(False)

    def _provider_line(self) -> str:
        return self.provider or t("setup_none")

    def _model_line(self) -> str:
        return self.model or t("setup_none")

    def on_mount(self) -> None:
        """Focus meteen op het api-key-veld, en verberg wat niet nodig is."""
        self.query_one("#api_key", Input).focus()
        custom = self.provider in ("", "custom")
        self.query_one("#lbl-base-url").display = custom
        self.query_one("#base_url").display = custom
        # Zonder base url is die groep leeg; dan hoort er ook geen lijn bij.
        self.query_one("#sep-base-url").display = custom

    def compose(self) -> ComposeResult:
        with Vertical(id="setup-box", classes="popup"):
            yield from _titlebar(t("setup_title"), close_id=None if self.required else "close")
            yield Label(t("setup_provider"), classes="section strong")
            with Horizontal(classes="row"):
                yield Static(self._provider_line(), id="cur-provider", classes="value")
                yield Button(t("setup_choose"), id="choose-provider")
            # Lijnen tussen de groepen: anders plakt provider, sleutel, model
            # en base url aan elkaar tot één blok.
            yield Rule(id="sep-api-key", classes="sep")
            yield Label(t("setup_api_key"), classes="section")
            yield Input(
                value=self.KEY_MASK if self.api_key else "",
                password=False,
                placeholder=self.KEY_MASK,
                id="api_key",
            )
            yield Rule(id="sep-model", classes="sep")
            yield Label(t("setup_model"), classes="section")
            with Horizontal(classes="row"):
                yield Static(self._model_line(), id="cur-model", classes="value")
                yield Button(t("setup_choose"), id="choose-model")
            # De base URL is alleen nodig als je er zelf een intikt; bij een
            # bekende provider weet Roan hem al (zie on_mount).
            yield Rule(id="sep-base-url", classes="sep")
            yield Label(t("setup_base_url"), id="lbl-base-url", classes="section")
            yield Input(value=self.base_url, id="base_url")
            if self.required:
                yield Static(t("setup_required"), id="required-hint", classes="hint")
            else:
                yield Static(t("setup_hint"), classes="hint")
            with Horizontal(classes="actions"):
                if not self.required:
                    yield Button(t("setup_cancel"), id="cancel")
                yield Button(t("setup_save"), id="save", variant="primary")

    # ---------- api key: gemaskeerd tot je erop klikt ----------
    def _set_key_value(self, value: str) -> None:
        """Zet het veld op `value` zonder de eigen Changed-handler te laten loopen."""
        box = self.query_one("#api_key", Input)
        self._unmasking = True
        try:
            box.value = value
            box.cursor_position = len(value)
        finally:
            self._unmasking = False

    @on(Click, "#api_key")
    def _reveal_key(self, event: Click) -> None:
        """Eén klik op het veld: de echte, opgeslagen sleutel komt tevoorschijn."""
        if self._revealed:
            return
        self._revealed = True
        self._set_key_value(self.api_key)

    @on(Input.Changed, "#api_key")
    def _on_key_typed(self, event: Input.Changed) -> None:
        """De eerste toets vervángt de maskering; daarna is het een gewoon veld.

        Let op: niet `KEY_MASK.startswith(...)` gebruiken om een gelekte
        maskering terug te zetten — 's' is een voorvoegsel van 'sk-…', dus dan
        zou de eerste letter van een nieuwe sleutel weer wegvallen.
        """
        if self._revealed or self._unmasking:
            return
        typed = event.value
        if typed == self.KEY_MASK:
            return
        self._revealed = True
        if typed.startswith(self.KEY_MASK):
            typed = typed[len(self.KEY_MASK) :]
        self._set_key_value(typed)

    # ---------- provider / model kiezen ----------
    def _choose_provider(self) -> None:
        def picked(result) -> None:
            if not result:
                return
            provider = result.get("provider") or ""
            base_url = result.get("base_url") or ""
            api_key = result.get("api_key") or ""
            self.provider = provider
            resolved = base_url or resolve_base_url(provider)
            if resolved:
                self.base_url = resolved
                self.query_one("#base_url", Input).value = resolved
            if api_key:
                # Een sleutel uit de providerkiezer is echt getypt werk: hij
                # moet opgeslagen worden, dus het velw toont hem meteen.
                self.api_key = api_key
                self._revealed = True
                self._set_key_value(api_key)
            self.query_one("#cur-provider", Static).update(self._provider_line())

        self.app.push_screen(ProviderScreen(), picked)

    def _choose_model(self) -> None:
        self._load_models()

    @work(thread=True, exclusive=True)
    def _load_models(self) -> None:
        # Zelfde vlag als in de app: twee klikken op 'Kies…' mogen geen twee
        # browsers bovenop elkaar zetten. `exclusive=True` houdt de worker
        # uniek, maar het SCHERM wordt elke keer opnieuw gepusht, dus de vlag
        # is wat er echt voor zorgt.
        if self._loading_models:
            return
        self._loading_models = True
        try:
            free, paid, custom = gather_models()
        except Exception:
            self.app.call_from_thread(self._loading_done)
            return
        self.app.call_from_thread(self._open_models, free, paid, custom)

    def _loading_done(self) -> None:
        self._loading_models = False

    def _open_models(self, free, paid, custom) -> None:
        self._loading_done()
        def picked(result) -> None:
            if not result:
                return
            provider, model = result
            if provider and provider != "custom":
                self.provider = provider
            self.model = model
            self.query_one("#cur-model", Static).update(self._model_line())
            self.query_one("#cur-provider", Static).update(self._provider_line())

        self.app.push_screen(
            ModelsScreen(free, paid, custom, fixed_provider=self.provider or None), picked
        )

    @on(Button.Pressed)
    def _on_button(self, event: Button.Pressed) -> None:
        bid = event.button.id
        if bid in ("close", "cancel"):
            self.dismiss(False)
            return
        if bid == "choose-provider":
            self._choose_provider()
            return
        if bid == "choose-model":
            self._choose_model()
            return
        if bid == "save":
            self._save()

    @on(Input.Submitted)
    def _on_submitted(self, event: Input.Submitted) -> None:
        """Enter in een veld = opslaan (je hoeft niet naar de knop te tabben)."""
        self._save()

    def _save(self) -> None:
        raw_key = self.query_one("#api_key", Input).value.strip()
        if self._revealed:
            # Het veld staat op de echte sleutel: wat erin staat is echt werk.
            api_key = raw_key
        elif raw_key and raw_key != self.KEY_MASK:
            api_key = raw_key
        else:
            # Nog gemaskeerd en niets getypt: de bewaarde sleutel blijft zoals hij is.
            api_key = ""
        base_url = self.query_one("#base_url", Input).value.strip()

        updates: dict = {}
        if self.provider:
            updates["provider"] = self.provider
        if api_key:
            updates["api_key"] = api_key
        if self.model:
            updates["model"] = self.model
        if base_url:
            updates["base_url"] = base_url

        save_config(updates)
        self.dismiss(True)


class ProviderScreen(ModalScreen):
    """Provider kiezen: Gratis / Betaald / Lokaal / Custom.

    Lokaal = servers op je eigen machine (standaard localhost-poorten).
    Custom = je eigen OpenAI-compatibele endpoints; je kunt er meerdere bewaren.
    """

    CSS = POPUP_CSS + """
    #provider-box {
        width: 92%;
        max-width: 104;
        height: 86%;
    }
    #provider-filters {
        height: 1;
        margin-top: 1;
    }
    #provider-filters Select {
        width: 1fr;
    }
    #psearch {
        margin-top: 1;
    }
    #provider-list {
        height: 1fr;
        margin-top: 1;
    }
    #provider-forms {
        height: auto;
    }
    #provider-info {
        height: auto;
        max-height: 3;
        color: $text-muted;
    }
    """

    BINDINGS = [("escape", "escape_pressed", "terug")]

    def action_escape_pressed(self) -> None:
        """Escape wist eerst de zoekopdracht, en sluit daarna pas."""
        search = self.query_one("#psearch", Input)
        if search.has_focus and search.value:
            search.value = ""
            return
        self.dismiss(None)

    def __init__(self, category: str = "free"):
        super().__init__()
        self.providers = {"free": [], "paid": []}
        self._chosen = ""
        self._category = category
        self._query = ""
        self._cache: dict[str, list] = {}

    # ---------- opbouw ----------
    def compose(self) -> ComposeResult:
        with Vertical(id="provider-box", classes="popup"):
            yield from _titlebar(t("provider_title"))
            with Horizontal(id="provider-filters"):
                yield Select(
                    [
                        (t("provider_cat_free"), "free"),
                        (t("provider_cat_paid"), "paid"),
                        (t("provider_cat_local"), "local"),
                        (t("provider_cat_custom"), "custom"),
                    ],
                    value=self._category,
                    id="pcat",
                    allow_blank=False,
                )
            yield Input(placeholder=t("search_hint"), id="psearch")
            yield OptionList(id="provider-list")
            with Vertical(id="provider-forms"):
                yield Label(t("provider_name"), id="lbl-name", classes="section")
                yield Input(id="pname", placeholder="thuis")
                yield Label(t("provider_base_url"), id="lbl-base", classes="section")
                yield Input(id="pbase", placeholder="https://api.example.com/v1")
                yield Label(t("provider_key"), id="lbl-key", classes="section")
                yield Input(id="pkey", password=True, placeholder="sk-...")
            yield Static(id="provider-info", classes="hint")
            with Horizontal(id="provider-actions", classes="actions"):
                yield Button(t("provider_add"), id="padd")
                yield Button(t("provider_delete"), id="pdel")
                yield Button(t("btn_back"), id="pback")
                yield Button(t("btn_choose"), id="pchoose", variant="primary")

    def on_mount(self) -> None:
        self._rebuild()
        self.query_one("#provider-list", OptionList).focus()
        self._load()

    @work(thread=True, exclusive=True)
    def _load(self) -> None:
        free = list_providers("free")
        paid = list_providers("paid")
        self.app.call_from_thread(self._set_providers, free, paid)

    def _set_providers(self, free, paid) -> None:
        self.providers = {"free": free, "paid": paid}
        self._cache.pop("free", None)
        self._cache.pop("paid", None)
        self._rebuild()

    def _cat(self) -> str:
        return self.query_one("#pcat", Select).value

    def _show(self, widget_id: str, visible: bool) -> None:
        self.query_one(widget_id).display = visible

    def _apply_visibility(self, cat: str) -> None:
        """Per categorie andere invoervelden."""
        custom = cat == "custom"
        hosted = cat in ("free", "paid")
        for widget_id in ("#lbl-name", "#pname", "#lbl-key", "#pkey"):
            self._show(widget_id, custom)
        for widget_id in ("#lbl-base", "#pbase"):
            self._show(widget_id, not hosted)
        self._show("#padd", custom)
        self._show("#pdel", custom and bool(self._chosen))

    def _rows_for(self, cat: str) -> list[tuple[str, str]]:
        """De (id, label)-regels van een categorie.

        Alleen gratis/betaald worden gecacht — dat zijn er honderden en het
        opbouwen kost een provider-lookup per stuk. Lokaal en custom zijn klein
        en moeten direct meelopen als je een endpoint toevoegt of weghaalt.
        """
        if cat in self._cache:
            return self._cache[cat]

        if cat == "local":
            rows = [(pid, f"{name}  ·  {base}") for pid, name, base in list_local()]
        elif cat == "custom":
            rows = [
                (e.get("name"), f"{e.get('name')}  ·  {e.get('base_url', '')}")
                for e in get_endpoints()
            ]
        else:
            rows = []
            for pid, name in self.providers.get(cat, []):
                desc = provider_description(pid)
                rows.append((pid, f"{name}  ·  {desc}" if desc else name))

        if cat in ("free", "paid"):
            self._cache[cat] = rows
        return rows

    def _matches(self, pid, label: str) -> bool:
        if not self._query:
            return True
        q = self._query.casefold()
        return q in str(pid).casefold() or q in label.casefold()

    def _fill(self) -> None:
        """De lijst vullen met de regels die op de zoekopdracht passen."""
        listing = self.query_one("#provider-list", OptionList)
        listing.clear_options()
        cat = self._cat()
        rows = [row for row in self._rows_for(cat) if self._matches(*row)]

        if not rows:
            if self._query:
                empty = t("search_no_results")
            elif cat == "custom":
                empty = t("provider_no_endpoints")
            else:
                empty = t("loading")
            listing.add_option(Option(empty, id=None, disabled=True))
            return

        for pid, label in rows:
            listing.add_option(Option(label, id=pid))
        listing.highlighted = 0

    def _rebuild(self) -> None:
        self._apply_visibility(self._cat())
        self._fill()

    @on(Input.Changed, "#psearch")
    def _on_search(self, event: Input.Changed) -> None:
        self._query = event.value.strip()
        self._fill()

    @on(Input.Submitted, "#psearch")
    def _on_search_submit(self, event: Input.Submitted) -> None:
        """Enter in het zoekveld = de bovenste treffer kiezen."""
        listing = self.query_one("#provider-list", OptionList)
        if not listing.option_count:
            return
        option = listing.get_option_at_index(0)
        if option.id is None:
            return
        self._chosen = str(option.id)
        self._choose()

    # ---------- selectie ----------
    @on(Select.Changed)
    def _on_cat(self, event: Select.Changed) -> None:
        if event.select.id == "pcat":
            self._chosen = ""
            self.query_one("#provider-info", Static).update("")
            self._rebuild()

    def on_option_list_option_selected(self, event: OptionList.OptionSelected) -> None:
        self._chosen = str(event.option_id or "")
        cat = self._cat()
        self._show("#pdel", cat == "custom" and bool(self._chosen))
        info = ""

        if cat == "local":
            endpoint = local_endpoint(self._chosen) or {}
            self.query_one("#pbase", Input).value = endpoint.get("base_url", "")
            info = t("provider_local_hint")
        elif cat == "custom":
            endpoint = get_endpoint(self._chosen) or {}
            self.query_one("#pbase", Input).value = endpoint.get("base_url", "")
            self.query_one("#pkey", Input).value = endpoint.get("api_key", "")
        else:
            meta = provider_meta(self._chosen)
            bits = [f"{t('provider_id')}: {self._chosen}"]
            if meta["plan"]:
                bits.append("! " + t("provider_plan_note", provider=meta["name"]))
            if meta["env"]:
                bits.append(f"{t('provider_env')}: {meta['env']}")
            if meta["doc"]:
                bits.append(f"{t('provider_doc')}: {meta['doc']}")
            info = "\n".join(bits)

        self.query_one("#provider-info", Static).update(info)

    # ---------- eigen endpoints ----------
    def _add_endpoint(self) -> None:
        name = self.query_one("#pname", Input).value.strip()
        base = self.query_one("#pbase", Input).value.strip()
        key = self.query_one("#pkey", Input).value.strip()
        if not name or not base:
            self.query_one("#provider-info", Static).update(t("provider_add_hint"))
            return
        add_endpoint(name, base, key)
        self._chosen = name
        for widget_id in ("#pname", "#pbase", "#pkey"):
            self.query_one(widget_id, Input).value = ""
        self.query_one("#provider-info", Static).update(t("msg_endpoint_added", name=name))
        self._rebuild()

    def _delete_endpoint(self) -> None:
        if not self._chosen:
            return
        removed = self._chosen
        remove_endpoint(removed)
        self._chosen = ""
        self.query_one("#provider-info", Static).update(t("msg_endpoint_removed", name=removed))
        self._rebuild()

    @on(Button.Pressed)
    def _on_button(self, event: Button.Pressed) -> None:
        bid = event.button.id
        if bid == "close":
            self.dismiss(None)
            return
        if bid == "pback":
            self.dismiss(None)
            return
        if bid == "padd":
            self._add_endpoint()
            return
        if bid == "pdel":
            self._delete_endpoint()
            return
        if bid == "pchoose":
            self._choose()

    @on(Input.Submitted)
    def _on_submitted(self, event: Input.Submitted) -> None:
        """Enter in een veld: endpoint toevoegen als het ingevuld is, anders kiezen."""
        if event.input.id == "psearch":
            return  # apart afgehandeld
        cat = self._cat()
        if cat == "custom":
            name = self.query_one("#pname", Input).value.strip()
            base = self.query_one("#pbase", Input).value.strip()
            if name and base:
                self._add_endpoint()
            elif self._chosen:
                self._choose()
            return
        self._choose()

    def _choose(self) -> None:
        cat = self._cat()
        if cat == "local" and self._chosen:
            endpoint = local_endpoint(self._chosen) or {}
            base = self.query_one("#pbase", Input).value.strip() or endpoint.get("base_url", "")
            self.dismiss({"provider": self._chosen, "base_url": base, "api_key": ""})
            return
        if cat == "custom" and self._chosen:
            endpoint = get_endpoint(self._chosen) or {}
            self.dismiss(
                {
                    "provider": "custom",
                    "base_url": endpoint.get("base_url", ""),
                    "api_key": endpoint.get("api_key", ""),
                }
            )
            return
        if self._chosen:
            self.dismiss(
                {
                    "provider": self._chosen,
                    "base_url": resolve_base_url(self._chosen),
                    "api_key": "",
                }
            )


class ModelsScreen(ModalScreen):
    """Model-browser: Gratis / Betaald / Deze provider, met zoeken."""

    CSS = POPUP_CSS + """
    #models-box {
        width: 92%;
        max-width: 96;
        height: 88%;
    }
    #models-filters {
        height: 1;
        margin-top: 1;
    }
    #models-filters Select {
        width: 1fr;
        margin-right: 0;
    }
    /* Twee kolomen lucht tussen de categorie- en de providerkiezer, en nergens
       anders. De marge hoorde eerst op de hele rij, dus ook op de LAATSTE
       kiezer, en die eindigde daardoor twee kolommen voor de rand van het
       popup. */
    #models-filters #cat {
        margin-right: 2;
    }
    #msearch {
        margin-top: 1;
    }
    #models-list {
        height: 1fr;
        margin-top: 1;
        /* De scrollbarkolommen ook reserveren als de scrollbar er nog niet is,
           zodat de rijbreedte niet springt zodra de lijst over de drempel heen
           groeit. De lucht tussen rij en scrollbar komt uit de rij zelf, zie
           `SCROLLBAR_GAP`. */
        scrollbar-gutter: stable;
        /* Elke rij is precies zo breed als de lijst en eindigt rechts op de
           provider. Mocht een rij na een resize toch een kolom te breed zijn,
           dan breekt hij niet om: hij wordt op één regel aan de rechterkant
           afgekapt met een liggende streep. */
        text-wrap: nowrap;
        text-overflow: ellipsis;
    }
    /* De hint staat op de rij met de knoppen en neemt wat overblijft. Zo staat
       hij niet op een eigen regel (waar hij een regel wegpakkte en de knoppen
       naar beneden duwde) en hij kan de knoppen ook niet van een smalle
       terminal af duwen: `1fr` geeft hem de rest en `ellipsis` kap hem af.
       `margin-top: 0` is nodig omdat `.popup .hint` er 1 zet, en binnen een
       rij van hoogte 1 zou de hint dan buiten de rij vallen. */
    #models-hint {
        width: 1fr;
        height: 1;
        margin-top: 0;
        color: $text-muted;
        text-overflow: ellipsis;
    }
    """

    BINDINGS = [("escape", "escape_pressed", "terug")]

    def action_escape_pressed(self) -> None:
        search = self.query_one("#msearch", Input)
        if search.has_focus and search.value:
            search.value = ""
            return
        self.dismiss(None)

    def __init__(
        self,
        free: list[tuple[str, str]],
        paid: list[tuple[str, str]],
        custom: list[str],
        fixed_provider: str | None = None,
    ):
        super().__init__()
        self.data = {"free": free, "paid": paid, "custom": custom}
        self.fixed_provider = fixed_provider
        self._query = ""
        self._built_width = -1

    def compose(self) -> ComposeResult:
        with Vertical(id="models-box", classes="popup"):
            title = (
                t("models_for", provider=self.fixed_provider)
                if self.fixed_provider
                else t("models_title")
            )
            yield from _titlebar(title)
            with Horizontal(id="models-filters"):
                yield Select(
                    [
                        (t("models_free"), "free"),
                        (t("models_paid"), "paid"),
                        (t("models_custom", provider=self._own_provider()), "custom"),
                    ],
                    value="free",
                    id="cat",
                    allow_blank=False,
                )
                yield Select(
                    [(t("models_all_providers"), "__all__")],
                    value="__all__",
                    id="prov",
                    allow_blank=False,
                )
            yield Input(placeholder=t("search_hint"), id="msearch")
            yield OptionList(id="models-list")
            # De hint deelt de rij met de knoppen: hij neemt de ruimte die
            # overblijft, de knoppen staan rechts met twee kolommen ertussen.
            with Horizontal(classes="actions"):
                yield Static(id="models-hint", classes="hint")
                yield Button(t("btn_back"), id="mback")
                yield Button(t("btn_choose"), id="mchoose", variant="primary")

    def on_mount(self) -> None:
        if self.fixed_provider:
            self.query_one("#prov", Select).display = False
        self._refresh_providers()
        self._rebuild()
        self.query_one("#models-list", OptionList).focus()

    def _own_provider(self) -> str:
        """De provider waar de derde categorie over gaat."""
        return str(self.fixed_provider or load_config().get("provider") or "")

    def _current(self) -> list[tuple[str, str]]:
        cat = self.query_one("#cat", Select).value
        if cat == "custom":
            items = [(load_config()["provider"], m) for m in self.data["custom"]]
        else:
            items = list(self.data.get(cat, []))
        if self.fixed_provider:
            items = [(p, m) for p, m in items if p == self.fixed_provider]
        return items

    def _refresh_providers(self) -> None:
        providers = sorted({p for p, _ in self._current()})
        sel = self.query_one("#prov", Select)
        sel.set_options([(t("models_all_providers"), "__all__")] + [(p, p) for p in providers])

    def _visible(self) -> list[tuple[str, str]]:
        prov = self.query_one("#prov", Select).value
        items = [(p, m) for p, m in self._current() if prov in (None, "__all__", p)]
        if self._query:
            q = self._query.casefold()
            items = [(p, m) for p, m in items if q in m.casefold() or q in str(p).casefold()]
        return items

    def _rebuild(self, keep_highlight: bool = False) -> None:
        items = self._visible()
        listing = self.query_one("#models-list", OptionList)
        width = self._list_width()
        keep = listing.highlighted if keep_highlight else None
        listing.clear_options()
        if not items:
            empty = t("search_no_results") if self._query else t("models_none")
            listing.add_option(Option(empty, id=None, disabled=True))
        else:
            cap = 400
            for p, m in items[:cap]:
                listing.add_option(Option(self._row(m, p, width), id=f"{p}|{m}"))
            if len(items) > cap:
                listing.add_option(Option(t("models_more", n=len(items) - cap), id=None))
            listing.highlighted = 0 if not keep else min(keep, listing.option_count - 1)
        self._built_width = width
        self.query_one("#models-hint", Static).update(t("models_hint", n=len(items)))

    def _list_width(self) -> int:
        """Inwendige breedte van de rijen, in kolommen.

        Eén kolom korter dan de lijst zelf: die kolom blijft leeg en scheidt de
        rij van de scrollbar (zie `SCROLLBAR_GAP`). De rij, en niet de lijst,
        is die kolom korter, want de scrollbar zit in Textual altijd tegen de
        rechterrand van de inwendige breedte — gemeten, niet aangenomen.
        """
        breedte = self.query_one("#models-list", OptionList).scrollable_content_region.width
        return max(breedte - SCROLLBAR_GAP, 1)

    @staticmethod
    def _clip(text: str, cells: int) -> str:
        """Kort `text` af tot `cells` kolommen, met een liggende streep erin."""
        return clip_cells(text, cells)

    def _row(self, model: str, provider: str, width: int):
        """Eén modelrij: de modelnaam links, de provider flush rechts.

        De provider eindigt op elke rij op dezelfde kolom, dus de modelnaam
        krijgt er opvulling achter tot de rij precies `width` kolommen breed is.
        Een modelnaam die te lang is wordt afgekapt in plaats van omgebroken, zodat
        de provider altijd in beeld blijft en de rij één regel blijft. De scheiding
        staat er nog steeds tussen, en de provider is gedimd. `width` 0 betekent:
        de lijst is nog niet uitgemeten (eerste build tijdens mount), dan blijft de
        rij onopgeschoond en repaint het scherm zichzelf via `on_resize`.

        `provider|model` blijft de `id` van de optie; de pick-handler splitst erop.
        """
        from rich.cells import cell_len
        from rich.text import Text

        tail = f"  ·  {provider}"
        if width > 0:
            if cell_len(tail) >= width:
                # Zelfs de provider past niet meer: dan sturen we alleen het
                # einde van de provider aan, zodat de rij nooit ombreekt.
                return Text(clip_cells(tail, width), style="dim")
            # Kolommen die over blijven voor de modelnaam, minstens één zodat de
            # scheiding nooit tegen de provider aan plakt.
            room = width - cell_len(tail)
            name = model if cell_len(model) <= room else clip_cells(model, room)
            head = name + " " * (room - cell_len(name))
        else:
            head = model
        row = Text(head)
        row.append(tail, "dim")
        return row

    def on_resize(self, event) -> None:
        """Het venster is breder of krapper geworden (`textual.events.Resize`).

        De opvulling in de rijen is op de breedte van toen gemaakt, dus die moet
        opnieuw zodra de lijst van breedte verandert. `Resize` zakt niet door, dus
        deze handler vuurt per scherm. In `on_resize` is de nieuwe maat nog niet
        binnen (App._on_resize zet 'm pas later), dus de eerste keer is de
        vergelijking een niet-doet en repaint de tweede de rijen.
        """
        self._realign()
        # En nog een keer nakijken na de volgende refresh, voor het geval de
        # eerste resize nog de oude opzet van de lijst zag.
        self.call_after_refresh(self._realign)

    def _realign(self) -> None:
        """Herbouw de rijen alleen als de lijst een andere breedte kreeg."""
        if self._list_width() != self._built_width:
            self._rebuild(keep_highlight=True)

    @on(Input.Changed, "#msearch")
    def _on_search(self, event: Input.Changed) -> None:
        self._query = event.value.strip()
        self._rebuild()

    @on(Input.Submitted, "#msearch")
    def _on_search_submit(self, event: Input.Submitted) -> None:
        """Enter in het zoekveld = de bovenste treffer kiezen."""
        self._choose_highlighted()

    @on(Select.Changed)
    def _on_select(self, event: Select.Changed) -> None:
        if event.select.id == "cat":
            self._refresh_providers()
        self._rebuild()

    def on_option_list_option_selected(self, event: OptionList.OptionSelected) -> None:
        self._pick(event.option_id)

    def _choose_highlighted(self) -> None:
        listing = self.query_one("#models-list", OptionList)
        if not listing.option_count:
            return
        self._pick(listing.get_option_at_index(listing.highlighted or 0).id)

    def _pick(self, option_id) -> None:
        if not option_id or "|" not in str(option_id):
            return
        provider, model = str(option_id).split("|", 1)
        self.dismiss((provider, model))

    @on(Button.Pressed)
    def _on_button(self, event: Button.Pressed) -> None:
        bid = event.button.id
        if bid in ("close", "mback"):
            self.dismiss(None)
            return
        if bid == "mchoose":
            self._choose_highlighted()


class ThemeScreen(ModalScreen):
    """Thema kiezen: een lijst losse thema's, zoals opencode."""

    CSS = POPUP_CSS + """
    #theme-box {
        width: 62%;
        max-width: 46;
    }
    #theme-list {
        height: auto;
        max-height: 100%;
        margin-top: 1;
    }
    """

    def compose(self) -> ComposeResult:
        with Vertical(id="theme-box", classes="popup"):
            yield from _titlebar(t("theme_title"))
            yield OptionList(id="theme-list")

    def on_mount(self) -> None:
        from rich.text import Text

        listing = self.query_one("#theme-list", OptionList)
        current = getattr(self.app, "theme", DEFAULT_THEME)
        for name in THEME_NAMES:
            bullet = "●" if name == current else "○"
            # De stip in de eigen pink van die smaak.
            label = Text.from_markup(f"[{PINK[name]}]{bullet}[/] {name}")
            listing.add_option(Option(label, id=name))
        listing.focus()

    def on_option_list_option_selected(self, event: OptionList.OptionSelected) -> None:
        if event.option_id:
            self.dismiss(str(event.option_id))

    @on(Button.Pressed)
    def _on_button(self, event: Button.Pressed) -> None:
        if event.button.id == "close":
            self.dismiss(None)


class CommandScreen(ModalScreen):
    """Commandopalette: alles wat met / kan, doorzoekbaar. Zoals opencode's ctrl+p."""

    CSS = POPUP_CSS + """
    #commands-box {
        width: 84%;
        max-width: 84;
        height: 72%;
    }
    #csearch {
        margin-top: 1;
    }
    #command-list {
        height: 1fr;
        margin-top: 1;
        /* Zelfde luchtkolom als de modellenlijst: de rij stopt één kolom vóór
           de scrollbar, en de scrollbarkolommen liggen er altijd. */
        scrollbar-gutter: stable;
        text-wrap: nowrap;
        text-overflow: ellipsis;
    }
    """

    # Boven/onder verplaatsen de selectie in de lijst in plaats van de cursor:
    # dit is een palette, je typt om te zoeken en Enter voert uit.
    BINDINGS = [
        ("escape", "escape_pressed", "terug"),
        ("down", "move(1)", ""),
        ("up", "move(-1)", ""),
    ]

    def action_escape_pressed(self) -> None:
        search = self.query_one("#csearch", Input)
        if search.value:
            search.value = ""
            return
        self.dismiss(None)

    def action_move(self, delta: int) -> None:
        listing = self.query_one("#command-list", OptionList)
        count = listing.option_count
        if not count:
            return
        current = listing.highlighted if listing.highlighted is not None else -1
        listing.highlighted = max(0, min(count - 1, current + delta))

    def __init__(self) -> None:
        super().__init__()
        self._query = ""
        self._built_width = -1

    # Twee kolommen lucht tussen het commando en zijn beschrijving.
    COLUMNS_GAP = 2
    # Een commando is nooit langer dan dit; op een smalle terminal wordt de
    # linkerkolom op maat gekapt in plaats van dat de rij ombreekt.
    LEFT_MAX = 34

    def compose(self) -> ComposeResult:
        with Vertical(id="commands-box", classes="popup"):
            yield from _titlebar(t("commands_title"))
            yield Input(placeholder=t("search_hint"), id="csearch")
            yield OptionList(id="command-list")
            yield Static(id="commands-hint", classes="hint")

    def on_mount(self) -> None:
        self._rebuild()
        self.query_one("#csearch", Input).focus()

    def _visible(self) -> list[tuple[str, commands.Command]]:
        items = [(name, commands.COMMANDS[name]) for name in commands.names()]
        if self._query:
            q = self._query.casefold().lstrip("/")
            items = [
                (name, cmd)
                for name, cmd in items
                if q in name.casefold() or q in t(cmd.description).casefold()
            ]
        return items

    def _list_width(self) -> int:
        """Breedte waar een rij in past, in kolommen (zelfde regel als modellen)."""
        breedte = self.query_one("#command-list", OptionList).scrollable_content_region.width
        return max(breedte - SCROLLBAR_GAP, 1)

    @staticmethod
    def _left(name: str) -> str:
        """De linkerkolom: `/commando` met zijn argumenthint erachter."""
        hint = commands.arg_hint(name)
        return f"/{name}  {hint}" if hint else f"/{name}"

    def _row(self, left: str, description: str, left_width: int):
        """Eén regel van de tabel: commando links, beschrijving op één kolom.

        `left_width` is de breedste linkerkolom van de ZICHTBARE regels, dus
        elke beschrijving begint op dezelfde kolom. Wat niet past wordt
        afgekapt en nooit omgebroken: een omgebroken rij is er twee, en dan
        schuift de tabel omlaag. Past de linkerkolom niet, dan gaat de helft
        van de breedte naar de beschrijving en wordt de linkerkolom op maat
        gekapt — allebei voor alle rijen tegelijk, dus de kolom blijft staan.

        De linkerkolom is vet (de sleutelkolom van de tabel) en heeft géén
        eigen kleur: een kleur in de tekst zou de kleur van de gemarkeerde rij
        overschrijven, en dan is de rij onleesbaar.
        """
        from rich.cells import cell_len
        from rich.text import Text

        available = self._list_width()
        if available <= 0:
            # Nog niet uitgemeten (eerste build tijdens mount): onopgeschoond,
            # en `on_resize` bouwt de rij opnieuw zodra de breedte bekend is.
            return Text(f"{left}  ·  {description}")
        desc_room = max(available // 2, 8)
        left_room = available - desc_room - self.COLUMNS_GAP
        if left_room < 4:
            # Te smal voor twee kolommen: dan toch een bruikbaar stuk links.
            left_room = max(available - 12, 1)
        left_width = min(left_width, left_room, self.LEFT_MAX)
        left = clip_cells(left, left_width)
        right_room = max(available - left_width - self.COLUMNS_GAP, 1)
        right = clip_cells(description, right_room)
        row = Text(left, style="bold")
        # De opvulling zit in de rij en niet in de stijl: zo begint elke
        # beschrijving op dezelfde kolom en blijft de rij één stuk tekst.
        row.append(" " * (left_width - cell_len(left) + self.COLUMNS_GAP))
        row.append(right)
        # En de rij loopt door tot de luchtkolom: ook een korte beschrijving
        # eindigt dan op dezelfde kolom als een lange, één kolom vóór de
        # scrollbar. Dus één rij is één blok, en de lijst is een tabel.
        row.pad_right(max(0, available - row.cell_len))
        return row

    def _rebuild(self) -> None:
        from rich.cells import cell_len

        listing = self.query_one("#command-list", OptionList)
        listing.clear_options()
        items = self._visible()
        if not items:
            listing.add_option(Option(t("search_no_results"), id=None, disabled=True))
        else:
            # De breedste linkerkolom van wat er nu zichtbaar is; zo staat elke
            # beschrijving op dezelfde kolom, en verandert die kolom mee met de
            # zoekopdracht.
            lefts = [self._left(name) for name, _ in items]
            left_width = max(cell_len(left) for left in lefts)
            for (name, cmd), left in zip(items, lefts):
                # De `id` blijft de naam: `_pick_highlighted` en het gesproken
                # commando hangen eraan.
                listing.add_option(
                    Option(self._row(left, t(cmd.description), left_width), id=name)
                )
            listing.highlighted = 0
        self._built_width = self._list_width()
        self.query_one("#commands-hint", Static).update(t("commands_hint", n=len(items)))

    def on_resize(self, event) -> None:
        """Een andere vensterbreedte: de tabelkolom moet mee.

        Zelfde patroon als `ModelsScreen`: de rijen zijn op de breedte van toen
        gemaakt, dus na een resize worden ze opnieuw opgebouwd.
        """
        self._realign()
        self.call_after_refresh(self._realign)

    def _realign(self) -> None:
        """Herbouw de rijen alleen als de lijst een andere breedte kreeg."""
        if self._list_width() != self._built_width:
            self._rebuild()

    def _pick_highlighted(self) -> None:
        listing = self.query_one("#command-list", OptionList)
        if listing.highlighted is not None and listing.option_count:
            option = listing.get_option_at_index(listing.highlighted)
            if option.id:
                self.dismiss(str(option.id))
                return
        items = self._visible()
        if items:
            self.dismiss(items[0][0])

    @on(Input.Changed, "#csearch")
    def _on_search(self, event: Input.Changed) -> None:
        self._query = event.value.strip()
        self._rebuild()

    @on(Input.Submitted, "#csearch")
    def _on_submitted(self) -> None:
        self._pick_highlighted()

    def on_option_list_option_selected(self, event: OptionList.OptionSelected) -> None:
        if event.option_id:
            self.dismiss(str(event.option_id))

    @on(Button.Pressed)
    def _on_button(self, event: Button.Pressed) -> None:
        if event.button.id == "close":
            self.dismiss(None)


def _session_entries(directory: Path | None = None) -> list[dict]:
    """Elk sessiebestand als één regel van het menu, nieuwste eerst.

    Eén leesbeurt per bestand levert alles wat een rij nodig heeft: het aantal
    berichten, de eerste gebruikersboodschap en de naam die je zelf gaf. Die
    naam wint, want daar gaf je hem voor; zonder naam is de eerste boodschap de
    titel. Een lijst van bestandsnamen is geen menu — zes tijdstempels zeggen
    niet welk gesprek je zoekt.

    Gesorteerd op mtime, niet op naam: de naam is meestal een tijdstempel, maar
    "nieuwste" betekent hier wanneer Roan het bestand het laatst heeft
    aangeraakt. Bij gelijke mtime wint de naam, zodat de volgorde nooit
    willekeurig is. Een bestand dat niet leest telt als leeg in plaats van de
    lijst te breken.

    De `stamp` in de dict is de minuutversie van diezelfde mtime; dat is wat de
    rij laat zien.
    """
    import time as _time

    if directory is None:
        from .agent import SESSIONS_DIR

        directory = SESSIONS_DIR
    entries: list[dict] = []
    try:
        paden = sorted(directory.glob("*.json"))
    except OSError:
        return []
    for pad in paden:
        try:
            mtime = pad.stat().st_mtime
        except OSError:
            mtime = 0.0
        try:
            data = json.loads(pad.read_text())
        except (OSError, json.JSONDecodeError):
            data = {}
        berichten = data.get("messages") if isinstance(data, dict) else None
        berichten = berichten if isinstance(berichten, list) else []
        naam = " ".join(str(data.get("name") or "").split()) if isinstance(data, dict) else ""
        titel = ""
        for bericht in berichten:
            if isinstance(bericht, dict) and bericht.get("role") == "user" and bericht.get("content"):
                # Eén regel: een sessietitel die over de hoogte ombreekt maakt van
                # elke sessie drie regels, en dan is de lijst geen lijst meer.
                titel = " ".join(str(bericht["content"]).split())
                break
        entries.append(
            {
                "id": pad.stem,
                "count": len(berichten),
                # Een naam die je zelf gaf (`/new`, `r` in /sessions) wint van de
                # eerste boodschap: daar gaf je hem voor.
                "name": naam,
                "title": naam or titel,
                "mtime": mtime,
                "stamp": _time.strftime("%Y-%m-%d %H:%M", _time.localtime(mtime)) if mtime else "",
            }
        )
    entries.sort(key=lambda entry: (entry["mtime"], entry["id"]), reverse=True)
    return entries


class NewSessionScreen(ModalScreen):
    """`/new` als popup: eerst een naam, dan pas een leeg gesprek.

    Zonder naam is een nieuw gesprek in `/sessions` niets dan een tijdstempel,
    en juist een gesprek waar je nog niets in gezegd hebt is dan niet terug te
    vinden. Enter maakt het aan, Escape en ✕ laten alles zoals het was. Een lege
    naam doet niets en zegt dat ook: dit scherm bestaat om die naam.
    """

    CSS = POPUP_CSS + """
    #new-box {
        width: 70%;
        max-width: 56;
    }
    """

    BINDINGS = [("escape", "cancel", "terug")]

    def compose(self) -> ComposeResult:
        with Vertical(id="new-box", classes="popup"):
            yield from _titlebar(t("msg_new_session_title"))
            yield Label(t("new_session_label"), classes="section")
            yield Input(placeholder=t("new_session_placeholder"), id="new-name")
            yield Static(t("new_session_hint"), id="new-hint", classes="hint")
            with Horizontal(classes="actions"):
                yield Button(t("btn_back"), id="new-back")
                yield Button(t("btn_create"), id="new-create", variant="primary")

    def on_mount(self) -> None:
        self.query_one("#new-name", Input).focus()

    @on(Input.Submitted)
    def _submitted(self, event: Input.Submitted) -> None:
        self._create()

    @on(Button.Pressed)
    def _pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "new-create":
            self._create()
        else:
            # Zowel Terug als de ✕ in de titelbalk: niets doen en wegwezen.
            self.dismiss(None)

    def action_cancel(self) -> None:
        self.dismiss(None)

    def _create(self) -> None:
        naam = " ".join(self.query_one("#new-name", Input).value.split())
        if not naam:
            self.query_one("#new-hint", Static).update(t("new_session_needs_name"))
            return
        self.dismiss(naam)


class RenameScreen(ModalScreen):
    """Eén sessie een andere naam geven, vanuit het /sessions-scherm.

    Het veld begint met de naam die er al is, zodat je hem kunt aanvullen in
    plaats van opnieuw te typen. Enter slaat op, Escape laat alles zoals het
    was; een lege naam doet niets en zegt dat ook.
    """

    CSS = POPUP_CSS + """
    #rename-box {
        width: 70%;
        max-width: 56;
    }
    """

    BINDINGS = [("escape", "cancel", "terug")]

    def __init__(self, session_id: str = "", name: str = "") -> None:
        super().__init__()
        self.session_id = session_id
        self.session_name = name

    def compose(self) -> ComposeResult:
        with Vertical(id="rename-box", classes="popup"):
            yield from _titlebar(t("rename_title"))
            yield Label(t("rename_label"), classes="section")
            yield Input(value=self.session_name, id="rename-name")
            yield Static(t("rename_hint"), id="rename-hint", classes="hint")
            with Horizontal(classes="actions"):
                yield Button(t("btn_back"), id="rename-back")
                yield Button(t("btn_save"), id="rename-save", variant="primary")

    def on_mount(self) -> None:
        veld = self.query_one("#rename-name", Input)
        veld.focus()
        veld.cursor_position = len(veld.value)

    @on(Input.Submitted)
    def _submitted(self, event: Input.Submitted) -> None:
        self._save()

    @on(Button.Pressed)
    def _pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "rename-save":
            self._save()
        else:
            self.dismiss(None)

    def action_cancel(self) -> None:
        self.dismiss(None)

    def _save(self) -> None:
        naam = " ".join(self.query_one("#rename-name", Input).value.split())
        if not naam:
            self.query_one("#rename-hint", Static).update(t("rename_needs_name"))
            return
        self.dismiss(naam)


class SessionsScreen(ModalScreen):
    """Opgeslagen gesprekken kiezen, als popup boven het gesprek.

    Zelfde vorm als de andere browsers: `Vertical(classes="popup")`, een
    `_titlebar(...)` met ✕, `CSS = POPUP_CSS + "..."` met alleen de eigen ids, en
    een hint onderaan die zegt wat Enter en Escape doen. Het scherm staat als
    `ModalScreen` boven het gesprek in plaats van ervoor: `#messages` blijft
    staan, alleen verduimd eronder.

    Een rij is één regel: markering, titel (de eerste gebruikersboodschap, met de
    sessie-id als noodnaam) en rechts een gedempte kolom met datum en aantal
    berichten. De hoogte van het venster gaat vóór de hoeveelheid detail, dus wat
    er rechts staat past zich aan: op een breed venster de volledige tijdstempel,
    op 46 kolommen eerst zonder jaartal en dan zonder uur — een rij die ombreekt is
    een rij die niemand kan lezen. Het gesprek waar je nu in zit krijgt een `●`,
    de andere een `○`: hetzelfde tekenpaar als het themascherm.

    Enter herstelt het gekozen gesprek, `r` hernoemt het en Escape en ✕ sluiten
    de popup. De naam die je bij het hernoemen opgeeft staat daarna in het
    sessiebestand en wint in de lijst van de eerste boodschap.
    """

    CSS = POPUP_CSS + """
    #sessions-box {
        width: 92%;
        max-width: 92;
        /* 66% past boven het inputkader en de statusbalk, ook op een
           20-regels terminal: hoger dan dit en de popup overlapt de rand van
           het invoerveld, en dat leest als een kapotte render. */
        height: 66%;
    }
    #sessions-list {
        height: 1fr;
        margin-top: 1;
        scrollbar-gutter: stable;
        text-wrap: nowrap;
        text-overflow: ellipsis;
    }
    """

    BINDINGS = [("escape", "close", "terug"), ("q", "close", "terug"), ("r", "rename", "hernoem")]

    CURRENT_MARK = "●"
    OTHER_MARK = "○"
    # Korter dan dit is een titel niet meer te herkennen, dus dan sturen we liever
    # een deel van de rechterkolom weg dan dat de titel verdwijnt.
    MIN_TITLE = 10

    def __init__(
        self,
        entries: list[dict] | None = None,
        current: str = "",
        on_rename=None,
    ) -> None:
        super().__init__()
        # Eén dict per sessie, uit `_session_entries`, nieuwste eerst.
        self.entries = list(entries or [])
        # De sessie-id waar het gesprek nu in zit; die krijgt een andere markering.
        self.current = current or ""
        # Wordt aangeroepen als de sessie waar je in zit een andere naam krijgt,
        # zodat de agent die naam ook draagt (zie `RoanApp._session_renamed`).
        self.on_rename = on_rename
        # De rij die nu hernoemd wordt; None als er geen naamscherm open staat.
        self._renaming: dict | None = None
        # De breedte waar de rijen gebouwd zijn; zie `_realign`.
        self._built_width = -1

    def compose(self) -> ComposeResult:
        with Vertical(id="sessions-box", classes="popup"):
            yield from _titlebar(t("msg_sessions_title"))
            yield OptionList(id="sessions-list")
            yield Static(t("sessions_hint"), id="sessions-hint", classes="hint")

    def on_mount(self) -> None:
        self._rebuild()
        self.query_one("#sessions-list", OptionList).focus()

    def _list_width(self) -> int:
        """Breedte waar een rij in past, in kolommen.

        Zelfde regel als `ModelsScreen` en `CommandScreen`: de rij is één kolom
        korter dan de lijst, zodat er lucht tussen rij en scrollbar blijft en de
        gemarkeerde rij niet in de scrollbar lijkt te lopen (zie `SCROLLBAR_GAP`).
        """
        breedte = self.query_one("#sessions-list", OptionList).scrollable_content_region.width
        return max(breedte - SCROLLBAR_GAP, 1)

    def _meta_ladder(self, entry: dict) -> list[str]:
        """De rechterkolom, van breed naar smal: wat het venster het minste kan.

        Eén rij blijft één rij, dus in plaats van af te breken laten we delen van
        de rechterkolom vallen: eerst het jaartal, dan het uur, dan het woord bij
        het aantal. De datum en het aantal blijven er altijd, want dat is
        waarmee je kiest.

        De stukken komen van de ene `YYYY-MM-DD HH:MM` die `_session_entries`
        schrijft: `[5:]` is `MM-DD HH:MM` en `[5:10]` is `MM-DD`.
        """
        stamp = str(entry["stamp"] or "")
        count = t("sessions_messages", n=entry["count"])
        return [
            "  ·  ".join(bit for bit in bits if bit)
            for bits in (
                (stamp, count),
                (stamp[5:], count),
                (stamp[5:10], count),
                (stamp[5:10], f"×{entry['count']}"),
                ("", f"×{entry['count']}"),
            )
        ]

    def _meta(self, entry: dict, width: int) -> str:
        """De eerste variant uit de ladder die nog past, anders de smalste."""
        from rich.cells import cell_len

        ladder = self._meta_ladder(entry)
        for meta in ladder:
            # markering, één kolom lucht en nog `MIN_TITLE` kolommen titel.
            if cell_len(meta) + self.MIN_TITLE + 4 <= width:
                return meta
        return clip_cells(ladder[-1], max(width - self.MIN_TITLE - 4, 1))

    def _row(self, entry: dict, width: int):
        """Eén sessie: markering en titel links, datum en aantal rechts.

        De rechterkolom eindigt op elke rij op dezelfde kolom: de titel krijgt
        daar opvulling achter tot de rij precies `width` kolommen breed is. Wat
        niet past wordt afgekapt met een liggende streep, nooit omgebroken.

        `width` 0 betekent: de lijst is nog niet uitgemeten (eerste build tijdens
        mount). Dan blijft de rij onopgeschoond en repaint het scherm zichzelf
        via `on_resize`.
        """
        from rich.cells import cell_len
        from rich.text import Text

        huidig = entry["id"] == self.current
        mark = self.CURRENT_MARK if huidig else self.OTHER_MARK
        # De markering is het enige dat een eigen krijgt: de huidige sessie in de
        # pink van het thema, de andere gedempt. De titel is vet en heeft géén
        # kleur, want een kleur in de tekst wint van de stijl van de gemarkeerde
        # rij en dan is die rij onleesbaar.
        kop = (f"{mark} ", accent_color() if huidig else "dim")
        titel = entry["title"] or entry["id"]
        if width <= 0:
            row = Text.assemble(kop, (titel, "bold"))
            row.append(" " + self._meta_ladder(entry)[0], "dim")
            return row
        meta = self._meta(entry, width)
        ruimte = max(width - cell_len(mark) - 3 - cell_len(meta), 1)
        row = Text.assemble(kop, (clip_cells(titel, ruimte), "bold"))
        # De opvulling zit tussen titel en rechterkolom, zodat die kolom op elke
        # rij op dezelfde kolom eindigt. Eén kolom lucht blijft over.
        row.pad_right(max(0, width - row.cell_len - cell_len(meta) - 1))
        row.append(" " + meta, "dim")
        return row

    def on_resize(self, event) -> None:
        """Bij een andere vensterbreedte de rijen opnieuw op de breedte van toen.

        De rijen worden op maat gemaakt met de beschikbare kolommen, dus na een
        resize moeten ze opnieuw. Zelfde patroon als `ModelsScreen`: `Resize`
        zakt niet door, dus deze handler vuurt per scherm, en `on_resize` ziet de
        nieuwe maat nog niet — de tweede ronde repaint de rijen.
        """
        self._realign()
        self.call_after_refresh(self._realign)

    def _realign(self) -> None:
        """Herbouw de rijen alleen als de lijst een andere breedte kreeg."""
        if self._list_width() != self._built_width:
            self._rebuild()

    def _rebuild(self) -> None:
        listing = self.query_one("#sessions-list", OptionList)
        keep = listing.highlighted
        width = self._list_width()
        listing.clear_options()
        if not self.entries:
            listing.add_option(Option(t("msg_no_sessions"), id=None, disabled=True))
        for entry in self.entries:
            listing.add_option(Option(self._row(entry, width), id=entry["id"]))
        if listing.option_count:
            listing.highlighted = 0 if keep is None else min(keep, listing.option_count - 1)
        self._built_width = width

    def action_close(self) -> None:
        self.dismiss(None)

    def action_rename(self) -> None:
        """`r`: de gemarkeerde sessie een andere naam geven.

        Het naamscherm komt bóven deze popup; bij Escape komt er niets terug en
        blijft alles zoals het was. De rij houdt zijn markering, zodat je ziet
        welke je net hernoemd hebt.
        """
        listing = self.query_one("#sessions-list", OptionList)
        index = listing.highlighted
        if index is None or not (0 <= index < len(self.entries)):
            return
        self._renaming = self.entries[index]
        self.app.push_screen(
            RenameScreen(
                session_id=str(self._renaming["id"]),
                name=str(self._renaming.get("name") or ""),
            ),
            self._renamed,
        )

    def _renamed(self, name) -> None:
        """Schrijf de nieuwe naam weg en laat de rij meteen meeveranderen."""
        from .agent import set_session_name

        entry, self._renaming = self._renaming, None
        naam = " ".join(str(name or "").split())
        if not entry or not naam:
            return
        if not set_session_name(str(entry["id"]), naam):
            return
        entry["name"] = naam
        entry["title"] = naam
        self._rebuild()
        self.query_one("#sessions-list", OptionList).focus()
        if callable(self.on_rename):
            self.on_rename(str(entry["id"]), naam)

    def on_option_list_option_selected(self, event: OptionList.OptionSelected) -> None:
        if event.option_id:
            self.dismiss(str(event.option_id))

    @on(Button.Pressed)
    def _on_button(self, event: Button.Pressed) -> None:
        if event.button.id == "close":
            self.dismiss(None)


class Messages(VerticalScroll):
    """Berichtenlijst. Muiswiel-snelheid volgt de `scroll_speed`-instelling."""

    def _speed(self) -> float:
        try:
            return float(load_config().get("scroll_speed") or 1)
        except (TypeError, ValueError):
            return 1.0

    def mount(self, *widgets, **kwargs):
        """Een nieuw bericht vraagt de breedte van het portret op.

        De app rekent die in `_apply_avatar_wrap`: naast het zwevende portret
        is een bericht smaller, eronder weer vol. Deze ene plek dekt alles —
        `_write`, `_sysline` en `_render_history` mounten allebei via hier, dus
        geen enkele aanroepende plek hoeft iets te weten. De echte
        breedteberekening komt zodra het scherm is ingedeeld; zie
        `on_mount`.
        """
        await_mount = super().mount(*widgets, **kwargs)
        self._schedule_wrap()
        return await_mount

    def watch_scroll_y(self, old_value: float, new_value: float) -> None:
        """Scrollen wisselt berichten van breedte.

        Een bericht dat omhoog schuift de band van het portret in komt moet
        smaller worden en dat er weer uit komt weer breed; anders bleef de
        tekst afbreken op de plek waar hij toevallig stond toen het scherm
        in beeld kwam.

        Direct, en niet uitgesteld tot na de volgende refresh: de rollen
        veranderen mét de scroll, en een breedte die pas ná het tekenen
        verandert zou het scherm nog een keer opbouwen. Dat kostte bij 200
        berichten een halve frame per scrollslag (gemeten 100 ms tegenover
        68 ms). De stijlbreedtes hangen niet aan de scroll, dus de posities
        kloppen hier al: `arrange` geeft de rijen van de lijst zelf.
        """
        super().watch_scroll_y(old_value, new_value)
        if self.is_mounted:
            self.app._apply_avatar_wrap()

    def _schedule_wrap(self) -> None:
        if self.is_mounted:
            self.app._schedule_avatar_wrap()

    def on_mouse_scroll_down(self, event) -> None:
        speed = self._speed()
        if speed != 1.0:
            event.stop()
            self.scroll_down(amount=max(1, int(3 * speed)), animate=False)

    def on_mouse_scroll_up(self, event) -> None:
        speed = self._speed()
        if speed != 1.0:
            event.stop()
            self.scroll_up(amount=max(1, int(3 * speed)), animate=False)


class ToolResult(Static):
    """Tool-resultaat: één regel, klik om volledig uit te klappen (zoals Claude Code)."""

    def __init__(self, tool_name: str, result: str, **kwargs) -> None:
        self.tool_name = tool_name
        self.result = result or ""
        self.expanded = False
        super().__init__(self._collapsed(), **kwargs)

    def _collapsed(self) -> str:
        lines = self.result.strip().splitlines()
        first = lines[0][:120] if lines else ""
        bad = first.lower().startswith("error")
        marker = "✗" if bad else "↳"
        extra = f"  (+{len(lines) - 1} regels)" if len(lines) > 1 else ""
        return f"  [dim]{marker} {first}{extra}[/dim]"

    def _full(self) -> str:
        body = "\n".join(f"  [dim]{line}[/dim]" for line in self.result.strip().splitlines())
        return f"  [{accent_color()}]↳ {self.tool_name}[/{accent_color()}]\n{body}"

    def on_click(self) -> None:
        self.expanded = not self.expanded
        self.update(self._full() if self.expanded else self._collapsed())


class TranscriptScreen(ModalScreen):
    """Ctrl+O: volledig transcript met less-achtige navigatie en zoeken."""

    BINDINGS = [
        ("escape", "close", "terug"),
        ("q", "close", "terug"),
        ("ctrl+o", "close", "terug"),
        ("g", "top", "top"),
        ("G", "bottom", "einde"),
        ("n", "next_match", "volgende"),
        ("N", "prev_match", "vorige"),
        ("slash", "search", "zoek"),
    ]

    CSS = POPUP_CSS + """
    #transcript-box {
        width: 95%;
        max-width: 140;
        height: 95%;
        padding: 0 1;
    }
    #tbody {
        height: 1fr;
        padding: 0 1;
    }
    #thint {
        height: 1;
        color: $text-muted;
    }
    #tsearch {
        display: none;
        margin-top: 1;
    }
    """

    def __init__(self, messages: list[dict]):
        super().__init__()
        self.entries = messages
        self.matches: list[int] = []
        self._pos = -1
        self._widgets: list = []
        self._texts: list[str] = []

    def compose(self) -> ComposeResult:
        with Vertical(id="transcript-box", classes="popup"):
            yield from _titlebar(t("transcript_title"))
            yield Input(placeholder=t("transcript_search"), id="tsearch")
            yield VerticalScroll(id="tbody")
            yield Static(t("transcript_hint"), id="thint")

    def on_mount(self) -> None:
        body = self.query_one("#tbody", VerticalScroll)
        self._widgets = []
        self._texts = []
        for msg in self.entries:
            role = msg.get("role")
            content = msg.get("content") or ""
            if role == "user":
                widget = user_line(content)
            elif role == "assistant":
                widget = roan_reply(content)
            elif role == "tool":
                widget = Static(f"  [dim]↳ {content}[/dim]")
            else:
                continue
            self._widgets.append(widget)
            # De tekst waarin het transcript zoekt. Niet `widget.source`: een
            # `.roan-reply` is een rij, en die heeft geen `source`.
            self._texts.append(content)
            body.mount(widget)
        body.scroll_end(animate=False)

    # ---------- zoeken ----------
    def action_search(self) -> None:
        box = self.query_one("#tsearch", Input)
        box.display = True
        box.focus()

    def on_input_changed(self, event: Input.Changed) -> None:
        query = (event.value or "").strip().lower()
        self.matches = []
        self._pos = -1
        if not query:
            return
        for i, text in enumerate(self._texts):
            if query in str(text).lower():
                self.matches.append(i)
        hint = self.query_one("#thint", Static)
        if self.matches:
            hint.update(t("transcript_matches", n=len(self.matches)) + "  ·  " + t("transcript_hint"))
        else:
            hint.update(t("transcript_no_match") + "  ·  " + t("transcript_hint"))

    @on(Input.Submitted)
    def _on_search_submit(self, event: Input.Submitted) -> None:
        self.query_one("#tsearch", Input).display = False
        self.query_one("#tbody", VerticalScroll).focus()
        self.action_next_match()

    def _goto(self, index: int) -> None:
        if 0 <= index < len(self._widgets):
            self._widgets[index].scroll_visible(animate=False)

    def action_next_match(self) -> None:
        if not self.matches:
            return
        self._pos = (self._pos + 1) % len(self.matches)
        self._goto(self.matches[self._pos])

    def action_prev_match(self) -> None:
        if not self.matches:
            return
        self._pos = (self._pos - 1) % len(self.matches)
        self._goto(self.matches[self._pos])

    def action_top(self) -> None:
        self.query_one("#tbody", VerticalScroll).scroll_home(animate=False)

    def action_bottom(self) -> None:
        self.query_one("#tbody", VerticalScroll).scroll_end(animate=False)

    def action_close(self) -> None:
        self.dismiss(None)

    @on(Button.Pressed)
    def _on_close_button(self, event: Button.Pressed) -> None:
        if event.button.id == "close":
            self.dismiss(None)


class SkillsScreen(ModalScreen):
    """/skills als menu: welke skills er zijn, welke altijd meegaan, en de body.

    Eerst zette dit commando de lijst als markdown in de chat, en die bleef daar
    staan tot je het gesprek clears. De chat hoort bij het gesprek; een verwijzing
    naar bestanden op schijf is een blad met informatie, geen bericht.

    De vorm is die van de andere browsers: een `Vertical(classes="popup")` met
    `_titlebar(...)` erin, en `CSS = POPUP_CSS + "..."` voor de eigen ids. Links
    (boven, op smalle schermen) de lijst met naam, beschrijving en een zichtbare
    markering voor always-skills; daaronder de volledige body van de gekozen
    skill, in een `VerticalScroll` zodat een lange body scrollt.

    Een always-skill die boven `skills.MAX_ALWAYS_CHARS` uitkomt, of waarvan het
    deel boven `skills.MAX_ALWAYS_TOTAL` valt, zegt dat hier zichtbaar. De prompt
    zegt het tegen het model, dit tegen de gebruiker.

    De tekst is Nederlands. `t()` zou de key zelf tonen zolang de string niet in
    `i18n.py` staat, dus deze schermteksten zijn letterlijk; de keys horen hier
    later bij: `skills_empty` en `skills_hint`.
    """

    CSS = POPUP_CSS + """
    #skills-box {
        width: 88%;
        max-width: 96;
        height: 84%;
    }
    #skills-list {
        height: auto;
        /* Een lijst die het hele popup eet is geen lijst meer. Acht regels
           laten de body nog leesbaar, en de lijst scrollt zelf verder. */
        max-height: 8;
        margin-top: 1;
        scrollbar-gutter: stable;
        text-wrap: nowrap;
        text-overflow: ellipsis;
    }
    #skills-doc {
        height: 1fr;
        margin-top: 1;
        scrollbar-gutter: stable;
    }
    #skills-doc Markdown {
        margin: 0;
    }
    """

    BINDINGS = [
        ("escape", "close", "terug"),
        ("q", "close", "terug"),
        ("tab", "focus_doc", "tekst"),
    ]

    # De markering staat vooraan, zodat afkappen hem nooit wegneemt.
    ALWAYS_MARK = "★"  # `always: true`: de hele body gaat mee in elke aanvraag
    LOOSE_MARK = "○"  # alleen naam + beschrijving, body op verzoek via read_skill

    def __init__(self, entries: list[dict] | None = None) -> None:
        super().__init__()
        if entries is None:
            from .skills import load_skills

            entries = load_skills()
        self.entries = list(entries)
        from .skills import always_warnings

        # Zichtbaar maken wat er níet volledig meegaat in elke aanvraag.
        self.warnings = always_warnings([s for s in self.entries if s["always"]])

    def compose(self) -> ComposeResult:
        with Vertical(id="skills-box", classes="popup"):
            yield from _titlebar(f"Skills ({len(self.entries)})")
            yield OptionList(id="skills-list")
            yield VerticalScroll(Markdown(id="skills-md"), id="skills-doc")
            yield Static(
                f"{self.ALWAYS_MARK} = altijd aan  ·  Esc = terug",
                id="skills-hint",
                classes="hint",
            )

    def on_mount(self) -> None:
        listing = self.query_one("#skills-list", OptionList)
        for index, skill in enumerate(self.entries):
            # Id per index, niet per naam: twee skills met dezelfde naam zouden
            # anders dezelfde id krijgen en de tweede overslaan.
            listing.add_option(Option(self._label(skill), id=str(index)))
        if self.entries:
            listing.highlighted = 0
        self._show(listing.highlighted)
        listing.focus()

    def _label(self, skill: dict):
        """Eén regel per skill: markering, naam, beschrijving."""
        from rich.text import Text

        mark = self.ALWAYS_MARK if skill["always"] else self.LOOSE_MARK
        return Text.assemble(
            (f"{mark} ", accent_color()),
            (str(skill["name"]), "bold"),
            "  ·  ",
            str(skill["description"] or ""),
        )

    def _show(self, index: int | None) -> None:
        """De body van de gekozen skill (of de lege-melding) in het tekstpaneel."""
        doc = self.query_one("#skills-md", Markdown)
        pane = self.query_one("#skills-doc", VerticalScroll)
        if index is None or not 0 <= index < len(self.entries):
            from .skills import skills_dir

            doc.update(
                f"Nog geen skills. Zet een `.md`-bestand in `{skills_dir()}`, "
                "of een map met een `SKILL.md` erin."
            )
            pane.scroll_home(animate=False)
            return
        skill = self.entries[index]
        mark = self.ALWAYS_MARK if skill["always"] else self.LOOSE_MARK
        # Vet, géén `#`: een markdown-kop eet vier regels marge, en dan staat de
        # body op een 24-regels scherm onder de vouw terwijl er niets te lezen is.
        # De beschrijving staat al in de lijstregel erboven; herhalen zou een
        # derde van het tekstpaneel kosten.
        parts = [f"**{mark} {skill['name']}**"]
        warning = self.warnings.get(skill["name"])
        if warning:
            parts += ["", f"**{warning}**"]
        parts += ["", str(skill["body"] or "")]
        doc.update("\n".join(parts))
        pane.scroll_home(animate=False)

    def on_option_list_option_highlighted(
        self, event: OptionList.OptionHighlighted
    ) -> None:
        self._show(event.option_index)

    def action_focus_doc(self) -> None:
        self.query_one("#skills-doc", VerticalScroll).focus()

    def action_close(self) -> None:
        self.dismiss(None)

    @on(Button.Pressed)
    def _on_close_button(self, event: Button.Pressed) -> None:
        if event.button.id == "close":
            self.dismiss(None)


class MemoryScreen(ModalScreen):
    """/memory als scherm: elke notitie zien, er een toevoegen, er een weghalen.

    Eerst zette dit commando de hele `~/.Roan/memory.md` als markdown in de
    chat. Die bleef daar staan tot je het gesprek clears, en — dat is het
    ergste — je kon er niets mee: geen notitie erbij, en zeker geen eruit.
    Roans eigen `remember` was de enige schrijver en dat blijft zo, maar de
    gebruiker moet het bestand ook zelf kunnen lezen en corrigeren. De chat
    hoort bij het gesprek; een bestand op schijf heeft een scherm nodig.

    De vorm is die van `SkillsScreen`: een `Vertical(classes="popup")` met
    `_titlebar(...)` erin en `CSS = POPUP_CSS + "..."` voor de eigen ids. Eén
    notitie per regel in de lijst. De lijst kap af met een liggende streep
    (`text-overflow: ellipsis`, net als bij /skills en /sessions) en de volledige
    tekst van de gemarkeerde notitie staat eronder in een balkje van maximaal
    vier regels dat zelf scrollt — het transcript doet het met `ToolResult`
    op dezelfde manier: kort in de lijst, volledig te lezen.

    `~/.Roan/memory.md` is de enige waarheid: `_reload` leest het bestand van
    schijf, nooit een lijstje in dit object, zodat "weg" ook echt weg is.
    """

    CSS = POPUP_CSS + """
    #memory-box {
        width: 92%;
        max-width: 84;
        height: 84%;
    }
    #memory-list {
        height: 1fr;
        margin-top: 1;
        scrollbar-gutter: stable;
        text-wrap: nowrap;
        text-overflow: ellipsis;
    }
    /* lege staat: staat IN het scherm, niet als chatregel */
    #memory-empty {
        height: auto;
        margin-top: 1;
        color: $text-muted;
    }
    #memory-detail {
        display: none;
        height: auto;
        max-height: 4;
        margin-top: 1;
    }
    #memory-full {
        height: auto;
    }
    #memory-add-row,
    #memory-remove-row {
        margin-top: 1;
    }
    /* `Input` is standaard `width: 100%`, en in een rij duwt dat de knop
       buiten het kader. `1fr` laat de knop netjes rechts staan. */
    #memory-input {
        width: 1fr;
    }
    /* Twee regels toetsen, dus geen vaste hoogte van 1 zoals de andere hints. */
    #memory-hint {
        height: auto;
    }
    """

    BINDINGS = [
        ("escape", "close", "terug"),
        ("q", "close", "terug"),
        ("d", "remove", "verwijder"),
        ("delete", "remove", "verwijder"),
    ]

    def __init__(self) -> None:
        super().__init__()
        from .memory import entries

        self.entries = entries()

    def compose(self) -> ComposeResult:
        from rich.text import Text

        with Vertical(id="memory-box", classes="popup"):
            yield from _titlebar(f"{t('memory_title')} ({len(self.entries)})")
            yield OptionList(id="memory-list")
            yield Static(t("memory_empty"), id="memory-empty")
            yield VerticalScroll(Static(Text(""), id="memory-full"), id="memory-detail")
            with Horizontal(classes="row", id="memory-add-row"):
                yield Input(placeholder=t("memory_new"), id="memory-input")
                yield Button(t("memory_add"), id="memory-add", variant="primary")
            with Horizontal(classes="row", id="memory-remove-row"):
                yield Static(
                    t("memory_count", n=len(self.entries)),
                    id="memory-status",
                    classes="value",
                )
                yield Button(t("memory_remove"), id="memory-remove")
            yield Static(t("memory_hint"), id="memory-hint", classes="hint")

    def on_mount(self) -> None:
        self._reload()
        self.query_one("#memory-input", Input).focus()

    # ---------- lezen ----------
    def _reload(self) -> None:
        """Lees memory.md opnieuw en teken de lijst (of de lege staat)."""
        from rich.text import Text

        from .memory import entries

        self.entries = entries()
        listing = self.query_one("#memory-list", OptionList)
        # Na een verwijdering blijft de markering waar je was, als die nog bestaat.
        keep = listing.highlighted if listing.highlighted is not None else 0
        listing.clear_options()
        for index, note in enumerate(self.entries):
            # `Text`, geen markup: een notitie is tekst van de gebruiker en mag
            # gerust `[iets]` bevatten zonder dat het een opmaakcommando wordt.
            listing.add_option(Option(Text(note), id=str(index)))
        self.query_one("#memory-box .title", Static).update(
            f"{t('memory_title')} ({len(self.entries)})"
        )
        listing.display = bool(self.entries)
        self.query_one("#memory-empty", Static).display = not self.entries
        self._status(t("memory_count", n=len(self.entries)))
        if self.entries:
            listing.highlighted = min(keep, len(self.entries) - 1)
        else:
            self._show(None)

    def _show(self, index: int | None) -> None:
        """De volledige tekst van de gemarkeerde notitie (of verberg het balkje)."""
        from rich.text import Text

        detail = self.query_one("#memory-detail", VerticalScroll)
        if index is None or not 0 <= index < len(self.entries):
            detail.display = False
            return
        self.query_one("#memory-full", Static).update(Text(self.entries[index]))
        detail.display = True
        detail.scroll_home(animate=False)

    def _status(self, text: str) -> None:
        self.query_one("#memory-status", Static).update(text)

    # ---------- schrijven ----------
    def _add(self) -> None:
        from .memory import remember

        box = self.query_one("#memory-input", Input)
        note = box.value.strip()
        if not note:
            return
        remember(note)
        box.value = ""
        self._reload()
        box.focus()
        self._status(t("memory_added"))

    def _remove(self) -> None:
        from .memory import forget

        listing = self.query_one("#memory-list", OptionList)
        index = listing.highlighted
        if index is None or not 0 <= index < len(self.entries):
            return
        # Eerst uit het bestand, dan pas de lijst: anders zou een schrijffout
        # alleen in het scherm zichtbaar zijn.
        forget(self.entries[index])
        self._reload()
        self._status(t("memory_removed"))

    def action_remove(self) -> None:
        self._remove()

    # ---------- gebeurtenissen ----------
    def on_option_list_option_highlighted(
        self, event: OptionList.OptionHighlighted
    ) -> None:
        self._show(event.option_index)

    def on_option_list_option_selected(
        self, event: OptionList.OptionSelected
    ) -> None:
        self._show(event.option_index)

    @on(Input.Submitted)
    def _on_submit(self, event: Input.Submitted) -> None:
        self._add()

    @on(Button.Pressed)
    def _on_button(self, event: Button.Pressed) -> None:
        bid = event.button.id
        if bid == "close":
            self.dismiss(None)
        elif bid == "memory-add":
            self._add()
        elif bid == "memory-remove":
            self._remove()

    def action_close(self) -> None:
        self.dismiss(None)


class RoanApp(App):
    TITLE = "Roan"
    MIN_SIZE = (1, 1)

    BINDINGS = [
        Binding("ctrl+c", "stop_or_quit", "stop", priority=True),
        Binding("ctrl+q", "quit_app", "quit"),
        ("ctrl+p", "commands", "commando's"),
        ("ctrl+l", "clear_chat", "clear"),
        ("ctrl+n", "new_session", "nieuw"),
        ("f2", "setup", "setup"),
        ("ctrl+o", "transcript", "transcript"),
        ("ctrl+end", "scroll_bottom", "naar beneden"),
        ("ctrl+home", "scroll_top", "naar boven"),
        ("pageup", "page_up", "pagina op"),
        ("pagedown", "page_down", "pagina neer"),
    ]

    CSS = """
    /* Het portret zweeft in de rechterbovenhoek, over het gesprek heen.
       `position: absolute` haalt hem uit de flow: de widget neemt geen rijen
       in, dus #messages begint op rij 0 en vult de hele hoogte tot de footer.
       `layer: overlay` tekent hem boven het gesprek in plaats van eronder.
       De `offset` zet hem tegen de rechterrand; `position: absolute` kent geen
       'right', dus dat rekent `_place_avatar` uit (schermbreedte min de
       buitenbreedte van het portret). Zonder die berekening zou hij na een
       resize één terminal achterlopen, want `on_resize` ziet nog de oude maat.
       GEEN horizontale padding: dat zou de bruikbare breedte verkleinen, zodat
       de 24 kolommen niet passen en Rich elke regel op de volgende regel laat
       doorlopen (losse streepjes tussen de regels door). */
    /* Kader om het portret, zelfde tekenvorm als het invoerveld. Textual rekent
       met border-box, dus de breedte/hoogte hieronder zijn de buitenste; de 2
       cells van de rand gaan eraan af en de 24x12-tekening past erin. */
    #avatar {
        position: absolute;
        layer: overlay;
        width: auto;
        height: auto;
        padding: 0;
        border: round $border;
    }
    /* De titelbalk en de ✕ gelden voor álle schermen in de app, ook voor de
       popups: die leunen op deze regels, dus niet per scherm herhalen. */
    .title {
        color: $accent;
        text-style: bold;
        padding: 0 2;
    }
    .titlebar {
        height: auto;
    }
    .titlebar .title {
        width: 1fr;
    }
    .close {
        width: 5;
        min-width: 5;
        max-width: 5;
        height: 1;
        border: none;
        background: $panel;
        color: $text-muted;
        content-align: center middle;
        padding: 0;
    }
    .close:hover,
    .close:focus {
        background: $error;
        color: $background;
    }
    /* indicator dat er nieuwe berichten onderaan staan */
    #jump {
        height: 1;
        margin: 0 2;
        background: $accent;
        color: $background;
        text-align: right;
        padding: 0 2;
    }
    /* slash-suggesties boven de input, alleen zichtbaar tijdens het typen */
    #slash {
        display: none;
        height: auto;
        max-height: 10;
        margin: 0 2;
        border: round $border;
        background: $panel;
    }
    #slash.visible {
        display: block;
    }
    #slash > .option-list--option {
        padding: 0 1;
    }
    #slash > .option-list--option-highlighted {
        background: $accent;
        color: $background;
        text-style: bold;
    }
    #footer {
        dock: bottom;
        height: auto;
    }
    /* De wachtrij boven het invoerveld: alleen zichtbaar als er iets wacht.
       Eén regel, in de footer, dus hij duwt het gesprek nooit weg. */
    #queue {
        display: none;
        height: 1;
        margin: 0 2;
        color: $text-muted;
        text-overflow: ellipsis;
    }
    #queue.visible {
        display: block;
    }
    /* De twee kanten van het gesprek. De kleur staat hier en niet in de markup:
       markup wint van CSS, dus een kleur in de tekst zou een theme-switch
       negeren. `$accent` is de Catppuccin-pink van de actieve smaak, dus de
       regel van de gebruiker blijft precies wat hij was. */
    .user-line {
        color: $accent;
        text-style: bold;
    }
    .roan-reply {
        height: auto;
    }
    .roan-reply > Markdown {
        width: 1fr;
        /* Standaard heeft Markdown twee kolommen padding, en met het teken
           ervoor schuift de tekst dan een kolom naar rechts ten opzichte van de
           tekst van de gebruiker. Eén kolom padding zet beide kanten weer
           gelijk. */
        padding: 0 1;
    }
    /* Het teken van Roan: gedempt, dus het leest als secondair naast de pink
       van de gebruiker. */
    .roan-mark {
        width: 1;
        height: 1;
        color: $text-muted;
    }
    #messages {
        height: 1fr;
        padding: 0 2;
    }
    #status-bar {
        height: 1;
        background: transparent;
        padding: 0 2;
    }
    /* Rechts het rijtje met tokens, denkniveau, modus en toestemming, met een
       ` · ` ertussen; de ctrl+p-hint staat helemaal rechts en is klikbaar. */
    #status-right {
        width: auto;
        height: 1;
        layout: horizontal;
    }
    /* Het verbruik is een getal, geen knopje: dus niet in de accentkleur. */
    #status-tokens {
        width: auto;
        height: 1;
        color: $text-muted;
        padding: 0 1;
    }
    /* Denkniveau, modus en toestemming zijn alle drie hetzelfde soort chip:
       één kleur (het accent), één hover. Anders las `chat` wel als actief en
       `auto` als uitlegtekst, terwijl ze allebei even klikbaar zijn. */
    /* Alles in de onderbalk is grijs, ook de roze. De helft roze en de helft
       grijs zag er onlogisch uit; en een vlak oplichten is juist wat de gebruiker
       niet wil. */
    #status-thinking,
    #status-mode,
    #status-perm,
    #status-hints {
        width: auto;
        height: 1;
        color: $text-muted;
        padding: 0 1;
    }
    /* Bij hover gaat alleen de tekst roze: geen achtergrond, geen vlak. */
    #status:hover,
    #status-thinking:hover,
    #status-mode:hover,
    #status-perm:hover,
    #status-hints:hover {
        color: $accent;
        text-style: bold;
        background: transparent;
    }
    /* Kader om de input, met de ╹ als linkerbovenhoek — zoals opencode.
       Hoogte 3 = 2 randen + 1 tekstregel; bij height 1 blijft de content-hoogte
       0 en is getypte tekst onzichtbaar. */
    #prompt-row {
        height: 3;
        margin: 0 2;
        border: round $border;
        background: transparent;
    }
    #prompt-row:focus-within {
        border: round $accent;
        background: transparent;
    }
    #input {
        width: 1fr;
        height: 1;
        background: transparent;
        border: none;
        padding: 0 1;
    }
    #status {
        width: 1fr;
        height: 1;
        color: $text-muted;
    }
    Input#input {
        color: $foreground;
        background: $surface;
    }
    Input#input:focus {
        color: $foreground;
        background: $surface;
    }
    Input#input .input--placeholder {
        color: $text-muted;
    }
    Screen {
        background: $background;
        /* Het zwevende portret moet boven het gesprek getekend worden. Een
           `layer` telt pas mee als de laag ook bestaat; zonder deze regel
           valt `layer: overlay` op #avatar terug op de laag `default`, en
           #messages (dat later in compose komt) tekent dan over het portret heen. */
        layers: default overlay;
    }
    ModalScreen {
        align: center middle;
        background: $background 70%;
    }
    Input,
    Select,
    OptionList,
    Button {
        border: none;
    }
    Input {
        height: 1;
        background: $panel;
        color: $foreground;
        padding: 0 1;
    }
    Input:focus {
        background: $accent 30%;
    }
    Select {
        height: 1;
        background: $panel;
    }
    Select > SelectCurrent {
        border: none;
        background: $panel;
        color: $foreground;
        padding: 0 1;
    }
    Select:focus > SelectCurrent {
        background: $accent 30%;
    }
    Select > SelectOverlay {
        border: none;
        background: $surface;
    }
    Select > SelectOverlay > .option-list--option-highlighted {
        background: $accent;
        color: $background;
    }
    OptionList {
        background: $surface;
        padding: 0 1;
    }
    OptionList > .option-list--option-highlighted {
        background: $accent;
        color: $background;
        text-style: bold;
    }
    Button {
        height: 1;
        min-width: 6;
        background: $panel;
        color: $foreground;
        padding: 0 1;
    }
    Button.-primary {
        background: $accent;
        color: $background;
    }
    Button:hover,
    Button:focus {
        background: $accent;
        color: $background;
        text-style: bold;
    }
    """

    def __init__(self, agent: Agent, avatar_path=None, renderer: str = "default"):
        super().__init__()
        self.agent = agent
        self.avatar_path = avatar_path
        self.renderer = renderer
        self._new_since_scroll = 0
        # Er loopt een modellenlaadbeurt (netwerk): klikken en /models doen dan
        # niets, zodat er niet meerdere browsers tegelijk open gaan.
        self._models_busy = False
        # Wachtrij voor berichten die je intypt terwijl Roan nog antwoordt. Het
        # veld blijft dus bruikbaar tijdens een antwoord.
        self._queue: list[str] = []
        self._streaming = False
        # Ctrl+C (of een ander signaal) zegt de worker: hou op met lezen.
        self._stop = False
        # Voor de wrapping om het portret heen: of er al een ronde onderweg is
        # (meerdere aanleidingen per frame delen dan één), hoeveel ronden er
        # gelopen zijn (plafond) en hoeveel berichten er smal staan (want
        # zonder portret hoeft er niets gereset te worden).
        self._wrap_pending = False
        self._wrap_rondes = 0
        self._wrap_smal: weakref.WeakSet = weakref.WeakSet()
        for theme in THEMES:
            self.register_theme(theme)
        cfg_theme = load_config().get("theme") or DEFAULT_THEME
        self.theme = cfg_theme if is_valid(cfg_theme) else DEFAULT_THEME
        set_current(self.theme)

    # ---------- avatar ----------
    def _resolve_avatar(self):
        """Het pad van de afbeelding: eigen foto, uit de config, of de meegeleverde.

        Blijft altijd een afbeelding. De vooraf gerenderde tekening staat er
        los van, want dat is geen foto maar een tekening van bloktekens (zie
        `_avatar_paths`).
        """
        if self.avatar_path and Path(self.avatar_path).expanduser().exists():
            return str(Path(self.avatar_path).expanduser())
        cfg_path = ROAN_DIR / "config.json"
        if cfg_path.exists():
            import json

            try:
                cfg = json.loads(cfg_path.read_text())
                if cfg.get("avatar") and Path(cfg["avatar"]).expanduser().exists():
                    return str(Path(cfg["avatar"]).expanduser())
            except Exception:
                pass
        if BUNDLED_AVATAR.exists():
            return str(BUNDLED_AVATAR)
        return None

    def _avatar_uses_ansi(self, png: str) -> bool:
        """Teken de vooraf gerenderde tekening, of raster de PNG?

        De tekening in `assets/avatar.ans` is met chafa geschilderd en daardoor
        scherper dan een raster dat wij zelf uit de PNG maken. Zij is echter
        een vast raster van ANS_CELLS: krimpen zou de cellen 2:1-verhouding
        doorbreken. Past die niet, dan nemen we het PNG-pad, dat wél schaalt.

        `png` is het al opgeloste pad (uit `_resolve_avatar`): de tekening hoort
        bij de meegeleverde avatar, niet bij een foto van de gebruiker.
        """
        return (
            ANS_AVATAR.exists()
            and Path(png) == BUNDLED_AVATAR
            and not (_HAS_HD and _image_is_graphical())
            and self._avatar_rows() >= ANS_CELLS[1]
        )

    def _avatar_paths(self) -> tuple[str, str]:
        """(ansi, png) voor `render_avatar` en `avatar_cells`.

        De eerste is de vooraf gerenderde tekening als wij die willen gebruiken
        en anders NO_AVATAR_ANS, zodat alleen het PNG-pad overblijft. De twee
        functies in photo.py kiezen zelf eerst het .ans-bestand en vallen pas
        dan terug; wij moeten dus hetzelfde pad aan beide geven, anders rekent
        de widget met een andere verhouding dan de tekst die er staat.
        """
        png = self._resolve_avatar() or str(BUNDLED_AVATAR)
        ans = ANS_AVATAR if self._avatar_uses_ansi(png) else NO_AVATAR_ANS
        return str(ans), png

    def _avatar_text(self):
        """De avatar als tekst, precies in het formaat dat `_size_avatar` meet."""
        ans, png = self._avatar_paths()
        return render_avatar(
            ans_path=ans,
            png_path=png,
            width=AVATAR_COLS,
            max_height=self._avatar_rows(),
            bg=self._theme_bg(),
        )

    # ---------- layout ----------
    def compose(self) -> ComposeResult:
        avatar = self._resolve_avatar()
        # Het portret zweeft: een DIRECT kind van de App, dus van het scherm.
        # In een rij of container zou het rijen uit de flow nemen en het gesprek
        # eronder beginnen; met `position: absolute` (zie de CSS) neemt het niets
        # in, zodat #messages op rij 0 begint en de chat onder het portret
        # doorloopt — precies zoals bij een zwevend portret hoort.
        if avatar:
            # Alleen bij een echt beeldprotocol (sixel/TGP) nemen we de
            # widget van textual_image; die zet doorzichtige pixels anders
            # op wit.
            if _HAS_HD and _image_is_graphical():
                yield _image_widget_class()(avatar, id="avatar")
            else:
                yield Static(self._avatar_text(), id="avatar")
        yield Messages(id="messages")
        # Vastgezet aan de onderkant als één blok, anders landen de status en
        # het invoerveld allebei op dezelfde rij en schrijven ze over elkaar.
        with Vertical(id="footer"):
            yield Static(id="jump")
            # Slash-suggesties, verscholen tot je "/" typt (zoals opencode).
            yield OptionList(id="slash")
            # Wachtrij, alleen zichtbaar als er berichten wachten.
            yield Static(id="queue")
            # Input als kader; geen ╹ ernaast, die oogde als een los teken.
            with Horizontal(id="prompt-row"):
                yield HistoryInput(placeholder=t("input_placeholder"), id="input")
            # Onderste balk, zoals opencode: model links, rechts de status.
            with Horizontal(id="status-bar"):
                yield Static(id="status")
                with Horizontal(id="status-right"):
                    yield Static(id="status-tokens")
                    yield Static(id="status-thinking")
                    yield Static(id="status-mode")
                    yield Static(id="status-perm")
                    yield Static(t("hint_commands"), id="status-hints")

    def _theme_bg(self) -> tuple[int, int, int]:
        """RGB van de thema-achtergrond, om de avatar-op en tekenen.

        Zonder dit blijft een doorzichtige PNG op een eigen donkere kleur
        staan en zie je een rechthoek waar de terminal doorheen schijnt.
        """
        theme = THEME_BY_NAME.get(getattr(self, "theme", DEFAULT_THEME), THEME_BY_NAME[DEFAULT_THEME])
        value = str(getattr(theme, "background", "") or "").lstrip("#")
        if len(value) == 6:
            try:
                return (int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16))
            except ValueError:
                pass
        return (24, 24, 37)

    def _avatar_rows(self) -> int:
        """Hoeveel rijen de avatar mag krijgen, afhankelijk van het scherm.

        De vooraf gerenderde tekening is een vast raster van ANS_CELLS: 24
        kolommen breed en 12 rijen hoog. Krimpen zou de cellen 2:1-verhouding
        doorbreken, dus hij gaat alleen als een helft van het scherm of meer
        overblijft voor het gesprek en het invoerveld. Op een kleiner scherm
        nemen we het PNG-pad, dat wél schaalt; op een normaal scherm is het
        dus gewoon de eigen maat van de tekening.
        """
        height = self.size.height or 24
        if ANS_CELLS[1] * 2 < height:
            return ANS_CELLS[1]
        return max(6, min(18, height // 3))

    def _avatar_outer(self) -> tuple[int, int]:
        """(breedte, hoogte) van het portret INclusief de rand.

        Eén meting voor twee doeleinden: de maat van de widget én de offset
        waarmee hij tegen de rechterrand staat. Zijn die twee uit verschillende
        berekeningen afkomstig, dan wijkt de doos één cel van de rand af of
        overlapt de rand; daarom delen ze deze ene.
        """
        ans, png = self._avatar_paths()
        cols, rows = avatar_cells(
            ans_path=ans,
            png_path=png,
            max_cols=AVATAR_COLS,
            max_rows=self._avatar_rows(),
        )
        # `styles.width/height` is bij Textual de buitenste maat (border-box).
        # Alleen de rand telt mee: geen lucht ertussen, het portret vult het vlak.
        # Een cel is twee keer zo hoog als breed, dus 26 x 14 cellen oogt
        # bijna vierkant; met +4 kreeg je een wél vierkante doos maar met twee
        # lege kolommen ernaast, en dat wilde de gebruiker niet.
        return cols + 2, rows + 2

    def _size_avatar(self) -> None:
        """Zet de avatar op het aantal cellen dat zijn verhouding respecteert.

        `self.size` in `on_resize` is nog de OUDE maat (`App._on_resize` zet pas
        later de nieuwe grootte en stuurt de Resize naar het scherm), dus de maat
        wordt pas na de volgende refresh gezet; anders rekent hij met het scherm
        van vóór de resize.
        """
        self.call_after_refresh(self._size_avatar_now)

    def _place_avatar(self) -> None:
        """Zet het zwevende portret tegen de rechterrand van het scherm.

        Ook uitgesteld tot na de volgende refresh, om dezelfde reden als
        `_size_avatar`: in `on_resize` is `self.size` nog de oude maat, dus een
        directe berekening zou het portret één resize achterlopen.
        """
        self.call_after_refresh(self._place_avatar_now)

    def _place_avatar_now(self) -> None:
        """De offset van het portret: schermbreedte min zijn buitenbreedte.

        `position: absolute` kent geen `right`, dus de rand berekenen wij
        zelf. De breedte komt uit `_avatar_outer`, dezelfde meting als waarmee
        de widget op maat wordt gezet, dus de doos en de offset kunnen niet
        uit elkaar lopen.
        """
        nodes = self.query("#avatar")
        if not nodes:
            return
        breedte, _ = self._avatar_outer()
        # `max(0, ...)`: op een terminal die smaller is dan het portret zou een
        # negatieve offset het portret buiten beeld duwen.
        nodes.first().styles.offset = (max(0, self.size.width - breedte), 0)

    def _size_avatar_now(self) -> None:
        """Meet de tekst van de avatar en geef de widget precies die maat.

        Een portret dat in een te korte widget wordt gezet, wordt uitgerekt; het
        widget krijgt daarom expliciet de cellen die bij de tekst horen.
        `avatar_cells` meet hetzelfde als `render_avatar` tekent, dus de twee
        lopen nooit uit de pas.

        Past de tekst er niet meer bij — het scherm is veranderd sinds compose,
        dus de keuze tussen tekening en PNG is om — dan tekenen we opnieuw;
        anders zou een 12-rijen tekening in een 6-rijen widget staan.
        """
        from rich.text import Text

        nodes = self.query("#avatar")
        if not nodes:
            return
        node = nodes.first()
        ans, png = self._avatar_paths()
        cols, rows = avatar_cells(
            ans_path=ans,
            png_path=png,
            max_cols=AVATAR_COLS,
            max_rows=self._avatar_rows(),
        )
        if isinstance(node, Static):
            # Wat er nu in de widget staat; wij meten het zelf, want de keuze
            # tussen de tekening en het PNG-pad hangt aan de schermhoogte.
            huidig = (0, 0)
            vorige = getattr(node, "content", None)
            if isinstance(vorige, Text):
                regels = vorige.split("\n")
                huidig = (max((r.cell_len for r in regels), default=0), len(regels))
            if huidig != (cols, rows):
                node.update(self._avatar_text())
        # Dezelfde meting als voor de offset, zodat maat en plaats altijd
        # bij elkaar passen.
        node.styles.width, node.styles.height = self._avatar_outer()

    # ---------- de tekst loopt om het portret heen ----------
    def _avatar_band(self) -> Region | None:
        """De schermrijen die het zwevende portret beslaat, of `None`.

        `None` betekent: er is geen portret (te smalle terminal of geen
        afbeelding), dus er valt niets te ontwijken.

        Wij lezen de stijl-offset en niet `avatar.region`. Bij een resize draait
        deze pass in dezelfde rij callbacks als `_place_avatar_now`, en de
        compositor heeft de nieuwe plaats dan nog niet verwerkt: `region` zou
        dan nog de oude plek geven. `_place_avatar_now` zet een offset in
        cells tegen de rechterrand en `_size_avatar_now` een maat in cells,
        dus deze twee stijlen zijn altijd actueel en komen uit dezelfde meting
        als de doos, zodat band en doos niet uit elkaar kunnen lopen.

        `query_one_optional` en niet `query`: `query` loopt de hele DOM af en
        kost met 200 berichten 4,7 ms per frame; `query_one_optional` heeft
        daarvoor een cache.
        """
        node = self.query_one_optional("#avatar")
        if node is None:
            return None
        breedte = _cellen(node.styles.width)
        hoogte = _cellen(node.styles.height)
        if not breedte or not hoogte:
            # Nog geen maat: `_size_avatar_now` meet de doos nu pas. Wij weten
            # dan nog niets en laten de berichten gewoon vol breed.
            return None
        offset = node.styles.offset
        links, boven = _cellen(offset.x), _cellen(offset.y)
        if links is None or boven is None:
            # Een offset in `%` of `fr` kan hier niet: `_place_avatar_now`
            # zet altijd cellen. Zekerheidshalve: liever geen band dan een
            # band op een onbekende plek.
            return None
        return Region(links, boven, breedte, hoogte)

    def _on_layout_refresh(self, screen=None) -> None:
        """Het scherm is opnieuw ingedeeld, dus de hoogtes zijn vers.

        Dit is de enige plek waar een pass altijd klopt: bij een mount, een
        scroll en een resize staat `call_after_refresh` namelijk soms te vroeg,
        omdat een net toegevoegd bericht dan nog hoogte 0 heeft. Het signaal
        vuurt nadat de indeling klaar is, en dus ook steeds opnieuw nadat wij
        zelf een breedte hebben gezet.
        """
        self._schedule_avatar_wrap()

    def _schedule_avatar_wrap(self) -> None:
        """Begin een nieuwe ronde breedtes nalopen.

        Elke `styles.width` vraagt om een nieuwe layout, dus meerdere passes in
        één frame zouden het scherm vaker opbouwen dan nodig. De vlag zorgt
        dat een mount, een resize en het inrichten van het scherm allemaal één
        pass delen; scrollen loopt synchroon via `Messages.watch_scroll_y`.
        """
        self._wrap_rondes = 0
        self._schedule_wrap_ronde()

    def _schedule_wrap_ronde(self) -> None:
        """Eén ronde aanmelden; het werk gebeurt na de volgende refresh."""
        if self._wrap_pending or self._wrap_rondes >= WRAP_RONDES:
            return
        self._wrap_pending = True
        self._wrap_pending = self.call_after_refresh(self._wrap_ronde)

    def _wrap_ronde(self) -> None:
        """Eén ronde, en daarna een volgende zolang dat zinvol is.

        Een nieuwe breedte verandert de hoogtes, en dus de plek van de erna
        volgende berichten; zonder nog een ronde te lopen kan er dus een
        verschil blijven staan tussen wat er staat en wat er hoort. De teller
        legt er een plafond op: `_wrap_rondes` wordt alleen door een echte
        aanleiding op nul gezet, niet door een volgende ronde zelf.
        """
        self._wrap_pending = False
        self._wrap_rondes += 1
        self._apply_avatar_wrap()

    def _apply_avatar_wrap(self) -> bool:
        """Laat het gesprek om het zwevende portret heen lopen.

        Voor de rijen die het portret beslaat is zijn linkerrand de rechterrand
        van het scherm: elk bericht dat die rijen raakt krijgt daarom een
        uitdrukkelijke `styles.width` en breekt vóór het kader af, met
        `AVATAR_WRAP_GAP` lucht ertussen. Onder het portret geldt de gewone
        volle breedte weer, dus `width = None` en daarmee `auto`.

        Er wordt per bericht maar één ding vergeleken: de breedte die er al
        staat. Alleen als die echt verandert schrijven wij hem, want elke
        schrijfactie is een layout. En de loop stopt bij het eerste bericht
        onder het portret: alles wat daaronder zit is per definitie niet smal.
        Zo blijft een pass tijdens het scrollen even goedkoop als het scherm
        hoog is, hoeveel berichten er ook onder staan.

        Geeft terug of er iets is veranderd; dat is wat de volgende ronde
        op gang brengt, want een nieuwe breedte verandert de hoogtes en dus de
        plek van de erna volgende berichten.

        BEGRENZING, en dit is het enige verschil met een tekstverwerker: een
        bericht dat boven het portret begint en eronder doorloopt wordt
        HELMAAL smal. Eén widget heeft één breedte, dus een blok dat over de
        bandgrens heen loopt kan niet boven smal en onder breed zijn. Splitsen
        zou `render_lines` en een herbouw van de Markdown uit losse regels
        vergen, en dat verliest links en klikhandlers. De onderste rijen van
        zo'n bericht blijven dus smal totdat het scrollt of een resize komt.
        """
        msgs = self.query_one_optional("#messages", VerticalScroll)
        if msgs is None:
            return False
        band = self._avatar_band()
        if band is None:
            # Zonder portret blijft niets smal staan: anders zou een bericht
            # nog smal zijn nadat het portret bij een ander schermformaat weg is.
            smal = self._wrap_smal
            self._wrap_smal = weakref.WeakSet()
            veranderd = False
            for kind in list(smal):
                veranderd |= self._set_width(kind, None)
            return veranderd
        # De posities komen uit de layout van de lijst zelf en niet uit de
        # compositor: `arrange` ligt in de cache van de container en kost
        # nagenoeg niets, terwijl `kind.region` ná een scroll de héle
        # compositor-map opnieuw opbouwt (gemeten 8,9 ms bij 200 berichten).
        # De lijst staat op rij 0, dus `content_region` is het nulpunt en
        # `scroll_offset` de verplaatsing van de inhoud.
        oorsprong = msgs.content_region.offset
        scrol = msgs.scroll_offset
        plaatsingen = msgs.arrange(msgs.scrollable_content_region.size).placements
        if any(not plaatsing.region.height for plaatsing in plaatsingen):
            # De lijst is nog niet ingedeeld: een bericht dat pas is toegevoegd
            # heeft hoogte 0 en telt niet mee, dus alle posities kloppen niet.
            # Wij doen dan niets en vragen een volgende ronde aan; het plafond
            # in `_schedule_wrap_ronde` begrenst dat.
            self._schedule_wrap_ronde()
            return False
        # De band, omgerekend naar de rijen van de lijst zelf: schermrij =
        # oorsprong + lijstrij - scroll, dus andersom. Zo hoeft de loop niet te
        # weten waar het scherm begint, alleen waar de inhoud begint.
        bovenband = band.y - oorsprong.y + scrol.y
        onderband = band.bottom - oorsprong.y + scrol.y
        smal: set = set()
        veranderd = False
        for plaatsing in plaatsingen:
            regio = plaatsing.region + plaatsing.offset
            if regio.y >= onderband:
                # De plaatsingen lopen van boven naar beneden, dus dit is het
                # eerste bericht dat helemaal onder het portret staat.
                break
            if regio.y + regio.height <= bovenband:
                # Helemaal erboven: onbereikbaar, want boven het scherm.
                continue
            kind = plaatsing.widget
            links = oorsprong.x + regio.x - scrol.x
            smal.add(kind)
            # `max(1, ...)`: een breedte van 0 levert een onzichtbaar bericht
            # en een negatieve mag niet, dus op een terminal die nauwelijks
            # breder is dan het portret blijft er in elk geval één kolom over.
            veranderd |= self._set_width(
                kind, max(1, band.x - AVATAR_WRAP_GAP - links)
            )
        # Wat vorige ronde smal stond en nu buiten de band valt, wordt weer
        # vol breed; de loop hierboven bereikt die berichten niet meer.
        for kind in list(self._wrap_smal):
            if kind not in smal:
                veranderd |= self._set_width(kind, None)
        # Een `WeakSet`, zodat een bericht dat uit het gesprek verdwijnt niet
        # in de weg staat en niet vastgehouden wordt door deze app.
        self._wrap_smal = weakref.WeakSet(smal)
        return veranderd

    @staticmethod
    def _set_width(kind, gewenst: int | None) -> bool:
        """Zet de breedte van een bericht, alleen als hij echt verandert.

        `styles.width = None` wist de eigen breedte en laat `auto` terug, dus de
        volle breedte van de container. Een breedte in `%` of `fr` komt uit de
        CSS van dat widget; die laten wij staan in plaats van hem te overschrijven
        of te wissen.
        """
        huidig = kind.styles.width
        if gewenst is None:
            if huidig is None or _cellen(huidig) is None:
                return False
            kind.styles.width = None
            return True
        if _cellen(huidig) == gewenst:
            return False
        kind.styles.width = gewenst
        return True

    def on_resize(self) -> None:
        self._size_avatar()
        self._place_avatar()
        # Na een resize staat het portret op een andere plek en dus ook de
        # breedte van de berichten ernaast; `_place_avatar` zet de nieuwe
        # offset eerder in deze rij callbacks, dus deze pass rekent met de
        # nieuwe maat mee.
        self._schedule_avatar_wrap()
        if self.is_running:
            # In `on_resize` staat `self.size` nog op de OUDE maat; pas na de
            # volgende refresh is de nieuwe breedte binnen. Zonder die uitstap
            # bleef de balk één resize achter en stonden de chips fout.
            self.call_after_refresh(self._fit_status_bar)

    def _style_note(self) -> None:
        """Zeg het als de schrijfstijl niet gecontroleerd is.

        De stijl gaat in elke aanvraag mee, dus een verouderde versie mag niet
        stil meelopen. Staat er niets, dan valt er niets te controleren: dan is
        dit geen waarschuwing maar een lege thuismap.
        """
        from . import style

        stand = style.status()
        if not stand["installed"] or not stand["stale"]:
            return
        if stand["checked_at"]:
            dagen = int(stand["age"] // 86400)
            self._sysline(t("style_stale", version=stand["version"], days=dagen))
        else:
            self._sysline(t("style_never_checked", version=stand["version"]))

    def on_mount(self) -> None:
        self.query_one("#input", Input).focus()
        # Het schemerscherm is de enige die weet WANNER de indeling klopt: pas
        # na zijn refresh zijn de hoogtes van net toegevoegde berichten bekend.
        # `call_after_refresh` is daarvoor te vroeg — gemeten: vlak na een
        # mount stonden alle nieuwe berichten nog op hoogte 0, waardoor de
        # breedteberekening niets deed en niets meer een pass kreeg. Dit
        # signaal vuurt na elke indeling (mount, scroll, resize) en dus ook
        # steeds opnieuw nadat wij zelf een breedte hebben gezet.
        self.screen.screen_layout_refresh_signal.subscribe(
            self, self._on_layout_refresh, immediate=True
        )
        self._size_avatar()
        self._place_avatar()
        self._update_status()
        self._style_note()
        self._render_history()
        if not is_configured():
            self._write(Markdown(t("onboarding")))
            self._open_setup()
            return
        cfg = load_config()

    def _render_history(self) -> None:
        """Toon het herstelde gesprek zodat de context zichtbaar is.

        Zelfde twee kanten als een live gesprek: `user_line` voor de gebruiker,
        `roan_reply` voor Roan. Anders las een hersteld gesprek anders dan een
        live gesprek.
        """
        for msg in getattr(self.agent, "messages", [])[1:]:
            role = msg.get("role")
            content = msg.get("content")
            if role == "user" and content:
                self._write(user_line(content))
            elif role == "assistant" and content:
                self._write(roan_reply(content))
        if len(getattr(self.agent, "messages", [])) > 1:
            self._sysline(t("msg_restored", n=len(self.agent.messages) - 1))
        msgs = self._messages()
        msgs.scroll_end(animate=False)
        self._new_since_scroll = 0
        self._update_jump()

    def _update_status(self) -> None:
        """Vult de onderste balk.

        Links alleen model en provider — de api-key-status ("key ingesteld")
        was nutteloos, want die staat al in de setup. Rechts de token-usage, het
        denkniveau, de modus en de toestemming, met een ` · ` ertussen en alle
        drie de knopjes in dezelfde accentkleur: zo leest het rijtje als één
        groep in plaats van als losse woorden. De drie chips zelf schildert
        `_fit_status_bar`, want hun bullets hangen aan de vensterbreedte.
        """
        cfg = load_config()
        # géén accent in de markup: de kleur komt uit de CSS, anders blijft de
        # balk roze en kan `:hover` hem niet grijs->roze sturen.
        self.query_one("#status", Static).update(
            f"[b]◆[/] {cfg.get('model') or '?'}  ·  {cfg.get('provider') or '?'}"
        )

        self.query_one("#status-tokens", Static).update(self._tokens_text())
        self.query_one("#status-hints", Static).update(
            f"{self._bullet()}{t('hint_commands')}"
        )
        self._fit_status_bar()

    def _bullet(self) -> str:
        """De ` · ` als scheider tussen twee chips, in een vaste gedempte kleur.

        Dit stond als `[dim]` in de markup, en dat is een RELATIEVE stijl: Textual
        dimt de kleur die het widget op dat moment heeft. Op `:hover` had de chip
        dan de pink en werd de bullet dim-pink mee — terwijl de gebruiker juist
        alleen de woorden roze wilde zien, met een scheider die grijs blijft.
        Daarom rekenen we de gedempte kleur zelf uit en zetten we die als
        absolute kleur (`[#rrggbb]`) in de markup; `:hover` en elke andere
        widget-CSS kunnen daar dan niet meer bij. `not bold` doet hetzelfde voor
        de `:hover { text-style: bold }` uit de CSS, zodat de bullet echt
        onveranderd blijft.

        Uitgangswaarden zijn de eigen CSS-regels van de chip, dus de bullet volgt
        het thema mee in plaats van een vastgespikkelde hex: de grijs-tint is
        `$text-muted` (`auto 60%` over de balkachtergrond, dus het contrast
        daarop) en `dim` is Textual's eigen `DIM_FACTOR`-blend richting die
        achtergrond. Op mocha komt daar #73737a uit, precies de kleur die de
        `[dim]`-variant gaf.
        """
        from textual.constants import DIM_FACTOR

        chip = self.query_one("#status-thinking", Static)
        achtergrond = chip.visual_style.background
        grijs = achtergrond.get_contrast_text(chip.styles.color.a)
        gedempt = grijs.blend(achtergrond, 1 - grijs.a).blend(
            achtergrond, 1 - DIM_FACTOR
        )
        return f"[not bold #{gedempt.r:02x}{gedempt.g:02x}{gedempt.b:02x}]·  [/]"

    def _fit_status_bar(self) -> None:
        """Schildert het rechter rijtje en verbergt wat er niet in past.

        Model en provider blijven altijd staan; daarna vallen de chips één voor
        één weg, in de volgorde van `STATUS_FITS`. Anders knijpt de
        1fr-linkerkant zijn tekst weg en verdwijnt de provider uit de balk.
        De ctrl+p-hint staat niet in die lijst en blijft dus altijd staan.

        De bullet zit in het stukje dat volgt, dus een chip die weggaat neemt
        zijn bullet mee; het eerste zichtbare stukje begint dus zonder bullet.
        Daarom schilderen we hier, en niet in `_update_status`: na een resize
        moet de bullet mee verschuiven.

        Zichtbaar is wat in `STATUS_FITS` past op deze breedte. De verbruik-chip
        heeft daarnaast tekst nodig: zonder api-venster is er niets te tonen en
        die kolommen zijn beter voor `model · provider`.
        """
        width = self.size.width or 80
        tokens = self._tokens_text()
        cfg = load_config()
        shown = {
            selector
            for selector, minimum in STATUS_FITS
            if width >= minimum and (selector != "#status-tokens" or bool(tokens))
        }
        for selector, _minimum in STATUS_FITS:
            for node in self.query(selector):
                node.display = selector in shown

        first = "#status-tokens" not in shown
        for selector, text in (
            (
                "#status-thinking",
                f"Think: {cfg.get('thinking') or THINKING_LEVELS[0]}",
            ),
            ("#status-mode", f"Mode: {str(cfg.get('mode') or MODES[0]).capitalize()}"),
            # Net als de modus, maar alleen voor het LEZEN: de config bewaart
            # `auto`/`user` in klein, zoals het commando het ook schrijft.
            (
                "#status-perm",
                f"Approvals: {str(cfg.get('permissions') or PERMISSIONS[0]).capitalize()}",
            ),
        ):
            bullet = "" if first or selector not in shown else self._bullet()
            self.query_one(selector, Static).update(f"{bullet}{text}")
            first = first and selector not in shown

    def _tokens_text(self) -> str:
        """Token-usage zoals opencode het toont: bijvoorbeeld `12.3K (4%)`.

        Zonder api-venster weten we niets, dan verbergen we het stukje liever
        dan een verzonnen nul tonen.
        """
        usage = getattr(self.agent, "usage", None) or {}
        prompt = int(usage.get("prompt") or 0)
        completion = int(usage.get("completion") or 0)
        total = prompt + completion
        if total <= 0:
            return ""
        window = int(load_config().get("context_window") or 0)
        if window > 0:
            pct = min(100, round(100 * prompt / window))
            return f"{_compact_tokens(prompt)} ({pct}%)"
        return _compact_tokens(total)

    @on(Click, "#status-hints")
    def _commands_clicked(self) -> None:
        """De ctrl+p-hint is een knopje, niet alleen een tekst."""
        self._cmd_commands()

    @on(Click, "#status")
    def _status_clicked(self) -> None:
        """Model · provider is een knopje: klikken doet hetzelfde als `/models`.

        Loopt er al een modellenlaadbeurt, dan negeert deze klik. Zonder die
        vlag zette een tweede klik tijdens het ophalen een tweede popup bovenop
        de eerste.
        """
        if self._models_busy:
            return
        self._run_command("/models")

    @on(Click, "#status-thinking")
    def _thinking_clicked(self) -> None:
        """Eén klik op het denkniveau = het volgende niveau
        (off → low → medium → high → off).

        Precies hetzelfde als `_mode_clicked` en `_perm_clicked`: de chip toont
        wat je krijgt, en een regel eronder bevestigt het. Zo is het niveau ook
        te wijzigen zonder het commando `/thinking` te kennen.
        """
        current = str(load_config().get("thinking") or THINKING_LEVELS[0])
        index = (
            THINKING_LEVELS.index(current) if current in THINKING_LEVELS else -1
        )
        new = THINKING_LEVELS[(index + 1) % len(THINKING_LEVELS)]
        save_config({"thinking": new})
        self._update_status()

    @on(Click, "#status-mode")
    def _mode_clicked(self) -> None:
        """Eén klik op de moduschip = de volgende modus (chat → plan → build → chat).

        De chip toont de huidige modus, dus je ziet meteen wat je krijgt; een
        regel eronder bevestigt het en zegt welke modus je nu hebt.
        """
        current = str(load_config().get("mode") or MODES[0])
        index = MODES.index(current) if current in MODES else -1
        new = MODES[(index + 1) % len(MODES)]
        save_config({"mode": new})
        self._update_status()

    @on(Click, "#status-perm")
    def _perm_clicked(self) -> None:
        """Zelfde idee als de modus: auto ⇄ user, net als het commando zonder
        argument, zodat de chip en de commandopalette hetzelfde doen."""
        current = str(load_config().get("permissions") or PERMISSIONS[0])
        index = PERMISSIONS.index(current) if current in PERMISSIONS else -1
        new = PERMISSIONS[(index + 1) % len(PERMISSIONS)]
        save_config({"permissions": new})
        self._update_status()

    # ---------- helpers ----------
    def _messages(self) -> VerticalScroll:
        return self.query_one("#messages", VerticalScroll)

    def _sysline(self, text: str) -> None:
        self._messages().mount(Static(f"[dim]{text}[/dim]"))

    def _write(self, renderable) -> None:
        """Mount een widget en volg het einde, tenzij de gebruiker omhoog scrollde."""
        msgs = self._messages()
        at_bottom = msgs.is_vertical_scroll_end
        follow = load_config().get("auto_follow", True)
        msgs.mount(renderable)
        if at_bottom and follow:
            msgs.scroll_end(animate=False)
            self._new_since_scroll = 0
        else:
            self._new_since_scroll += 1
        self._update_jump()

    def _update_jump(self) -> None:
        jump = self.query_one("#jump", Static)
        if self._new_since_scroll > 0:
            jump.update(t("new_messages", n=self._new_since_scroll))
            jump.display = True
        else:
            jump.display = False

    @on(Click, "#jump")
    def _jump_clicked(self) -> None:
        self.action_scroll_bottom()

    # ---------- commands ----------
    def _run_command(self, raw: str) -> bool:
        parts = raw[1:].split()
        name = parts[0].lower() if parts else ""
        args = parts[1:]

        if name in ("quit", "exit", "q"):
            self.exit()
            return True
        if name == "help":
            self._write(Markdown(commands.help_text()))
            return True
        if name == "clear":
            self._messages().remove_children()
            self.agent.clear()
            return True
        if name == "theme":
            self._cmd_theme(args)
            return True
        if name == "model":
            self._cmd_model(args)
            return True
        if name == "models":
            self._cmd_models()
            return True
        if name == "provider":
            self._cmd_provider(args)
            return True
        if name == "memory":
            self._cmd_memory()
            return True
        if name == "skills":
            self._cmd_skills()
            return True
        if name == "new":
            self._ask_new_session()
            return True
        if name == "sessions":
            self._cmd_sessions()
            return True
        if name == "compact":
            self._cmd_compact()
            return True
        if name == "language":
            self._cmd_language(args)
            return True
        if name == "mode":
            self._cmd_choice(args, "mode", MODES, "msg_modes", "msg_mode_set")
            return True
        if name == "permissions":
            self._cmd_choice(args, "permissions", PERMISSIONS, "msg_permissions", "msg_permissions_set")
            return True
        if name == "thinking":
            self._cmd_choice(args, "thinking", THINKING_LEVELS, "msg_thinking_levels", "msg_thinking_set")
            return True
        if name == "tui":
            self._cmd_tui(args)
            return True
        if name == "setup":
            self._cmd_setup()
            return True
        if name == "commands":
            self._cmd_commands()
            return True

        self._sysline(t("msg_unknown_cmd", name=name))
        return True

    def action_commands(self) -> None:
        self._cmd_commands()

    def _cmd_commands(self) -> None:
        """Commandopalette; het gekozen commando gaat gewoon door _run_command."""

        def picked(name) -> None:
            if name:
                self._run_command(f"/{name}")

        self.push_screen(CommandScreen(), picked)

    def _cmd_provider(self, args) -> None:
        if args:
            name = args[0].lower()
            known = name in PROVIDER_PRESETS or name in LOCAL_IDS
            if not known:
                names = sorted(set(PROVIDER_PRESETS) | LOCAL_IDS)
                self._sysline(t("msg_providers", names=", ".join(names)))
                return
            updates: dict = {"provider": name}
            endpoint = local_endpoint(name) if name in LOCAL_IDS else None
            base = (endpoint or {}).get("base_url") or resolve_base_url(name)
            if base:
                updates["base_url"] = base
            save_config(updates)
            self.agent.reload()
            self._update_status()
            self._sysline(t("msg_provider_set", name=name))
            return
        self._open_provider_picker()

    def _open_provider_picker(self) -> None:
        """Provider kiezen (Gratis/Betaald/Custom) en daarna meteen een model."""

        def picked(result) -> None:
            if not result:
                return
            provider = result.get("provider") or ""
            base_url = result.get("base_url") or ""
            api_key = result.get("api_key") or ""
            updates: dict = {"provider": provider}
            resolved = base_url or resolve_base_url(provider)
            if resolved:
                updates["base_url"] = resolved
            if api_key:
                updates["api_key"] = api_key
            save_config(updates)
            self.agent.reload()
            self._update_status()
            self._sysline(t("msg_provider_set", name=provider))
            self._fetch_models(fixed_provider=provider)

        self.push_screen(ProviderScreen(), picked)

    def _cmd_memory(self) -> None:
        """Geheugen in een popup; er komt niets meer in de chat te staan."""
        self.push_screen(MemoryScreen())

    def _cmd_skills(self) -> None:
        """Skills in een popup; er komt niets meer in de chat te staan."""
        self.push_screen(SkillsScreen())

    def _cmd_language(self, args) -> None:
        from .i18n import LANGUAGES

        if not args:
            self._sysline(t("msg_languages", langs=", ".join(LANGUAGES)))
            return
        code = args[0].lower()
        if code not in LANGUAGES:
            self._sysline(t("msg_languages", langs=", ".join(LANGUAGES)))
            return
        new_code = self.agent.set_language(code)
        self._update_status()

    def _cmd_choice(
        self, args, key: str, allowed: tuple[str, ...], list_key: str, set_key: str
    ) -> None:
        """Kort instelcommando voor een van een vaste lijst waarden.

        Zonder argument noemen we de opties; met een argument zetten we hem en
        vullen we de statusbalk meteen bij. Met één optie wisselen we om, zoals
        je van een knop verwacht.
        """
        current = str(load_config().get(key) or allowed[0])
        if not args:
            if len(allowed) == 1:
                args = [current]
            else:
                self._sysline(t(list_key, options=", ".join(allowed)))
                return
        value = args[0].lower()
        if value not in allowed:
            self._sysline(t(list_key, options=", ".join(allowed)))
            return
        save_config({key: value})
        self._update_status()
        self._sysline(t(set_key, name=value))

    def _cmd_compact(self) -> None:
        self._sysline(t("msg_summarizing"))
        self._compact_worker()

    @work(thread=True, exclusive=True)
    def _compact_worker(self) -> None:
        try:
            ok = self.agent.compact(force=True)
        except Exception:
            ok = False
        self.call_from_thread(
            self._sysline, t("msg_compacted") if ok else t("msg_nothing_to_compact")
        )

    def _cmd_sessions(self) -> None:
        """`/sessions`: een popup boven het gesprek met de opgeslagen gesprekken.

        Vóór stond hier een lijstje Markdown ín de chat, tussen de berichten
        door, en je kon er niets mee. Nu is het een `ModalScreen` boven het
        gesprek, zoals alle andere browsers, met Escape om weg te gaan en Enter
        om een gesprek te herstellen.

        Er wordt niets in `#messages` geschreven, ook niet als er nog geen
        sessies zijn: dan opent de popup met de lege-melding in de lijst in
        plaats van met een regel in het gesprek. Een verwijzing naar iets op
        schijf hoort in het venster dat daarvoor gemaakt is, niet tussen de
        berichten.
        """
        entries = _session_entries()

        def chosen(session_id) -> None:
            if session_id:
                self._restore_session(str(session_id))

        self.push_screen(
            SessionsScreen(
                entries,
                current=str(getattr(self.agent, "session_id", "") or ""),
                on_rename=self._session_renamed,
            ),
            chosen,
        )

    def _restore_session(self, session_id: str) -> None:
        """Herstel een opgeslagen gesprek (id = naam van het bestand).

        `Agent.clear()` wordt hier bewust NIET gebruikt: die schrijft meteen een
        leeg gesprek weg en zou dus het bestand overschrijven dat we net gaan
        herstellen. Wij zetten alleen het systeembericht terug en laten
        `Agent._restore()` de berichten er weer bij zetten.

        `save()` komt pas ná het herstel en alleen als er echt iets in het bestand
        stond. Zonder die voorwaarde zou een kapot of leeg bestand door het
        herstelpad alsnog leeggemaakt worden — dan is het weg, en daar kon je
        niks meer mee.
        """
        systeem = (
            self.agent.messages[0]
            if getattr(self.agent, "messages", None)
            else {"role": "system", "content": ""}
        )
        self.agent.session_id = session_id
        self.agent.messages = [systeem]
        self.agent._restore()
        if len(self.agent.messages) > 1:
            self.agent.save()
        reload_ = getattr(self.agent, "reload", None)
        if callable(reload_):
            # Zodat de request-headers de nieuwe sessie-id dragen.
            reload_()
        self._messages().remove_children()
        self._update_status()
        self._render_history()

    def _cmd_theme(self, args) -> None:
        if args:
            self._set_theme(args[0].lower())
            return

        def picked(result) -> None:
            if result:
                self._set_theme(str(result))

        self.push_screen(ThemeScreen(), picked)

    def _set_theme(self, name: str) -> None:
        if not is_valid(name):
            self._sysline(t("msg_themes", names=", ".join(THEME_NAMES)))
            return
        self.theme = name
        set_current(name)
        save_config({"theme": name})
        self._sysline(t("msg_theme_set", name=name))

    def _cmd_model(self, args) -> None:
        if not args:
            cfg = load_config()
            self._sysline(t("msg_model_current", model=cfg["model"]))
            return
        cfg = save_config({"model": args[0]})
        self.agent.reload()
        self._sysline(t("msg_model_set", model=cfg["model"]))
        self._update_status()

    def _cmd_models(self) -> None:
        """`/models`: één browser per keer.

        Zit er al een lopende laadbeurt, dan doet deze klik niets — zonder die
        vlag zette elke klik tijdens het ophalen een tweede (en derde)
        ModelsScreen bovenop de eerste, want het scherm wordt bij elke
        aanroep opnieuw gepusht, niet alleen als de lijst klaar is.
        """
        if self._models_busy:
            return
        self._sysline(t("models_fetching"))
        self._fetch_models()

    def _models_claim(self) -> bool:
        """Vlag 'er loopt een modellenlaadbeurt'; False als dat al zo was."""
        if self._models_busy:
            return False
        self._models_busy = True
        return True

    def _models_release(self, failed: bool = False) -> None:
        """De laadbeurt is klaar (of mislukt): de volgende klik mag weer."""
        self._models_busy = False
        if failed:
            self._sysline(t("models_failed"))

    def _fetch_models(self, fixed_provider: str | None = None) -> bool:
        """Start het ophalen, als er nog geen laadbeurt loopt. Geeft True terug
        als hij daadwerkelijk gestart is.

        De vlag wordt hier gezet en niet in de worker: die draait in een
        thread, dus een vlag die daar staat is te laat of komt er helemaal niet
        als de volgende klik al binnenkomt.
        """
        if not self._models_claim():
            return False
        self._fetch_models_worker(fixed_provider)
        return True

    @work(thread=True, exclusive=True)
    def _fetch_models_worker(self, fixed_provider: str | None = None) -> None:
        try:
            free, paid, custom = gather_models()
        except Exception:
            self.call_from_thread(self._models_release, True)
            return
        self.call_from_thread(self._open_models, free, paid, custom, fixed_provider)

    def _open_models(self, free, paid, custom, fixed_provider: str | None = None) -> None:
        # De lijst liggen er: de laadbeurt is klaar, dus de volgende klik mag
        # weer een browser openen (de huidige staat als modal bovenop).
        self._models_release()
        def chosen(result) -> None:
            if not result:
                return
            provider, model = result
            updates: dict = {"model": model}
            if provider and provider != "custom" and provider in PROVIDER_PRESETS:
                updates["provider"] = provider
            save_config(updates)
            self.agent.reload()
            self._update_status()
            cfg = load_config()
            if provider and provider not in PROVIDER_PRESETS and provider != "custom":
                self._sysline(t("models_unknown_provider", model=model, provider=provider))
            else:
                self._sysline(t("msg_model_set", model=model) + f"  ·  provider → {cfg['provider']}")

        self.push_screen(ModelsScreen(free, paid, custom, fixed_provider=fixed_provider), chosen)

    def _cmd_setup(self) -> None:
        self._open_setup()

    def _open_setup(self) -> None:
        # Verplicht zolang er niets werkt: dan kun je dit scherm niet wegklikken.
        required = not is_configured()

        def done(saved: bool | None) -> None:
            if not saved:
                if required and not is_configured() and self.is_running:
                    self._sysline(t("setup_required_nudge"))
                    self.call_after_refresh(self._open_setup)
                return
            self.agent.reload()
            self._update_status()
            self._messages().remove_children()
            cfg = load_config()
            self._sysline(t("setup_saved", model=cfg["model"], provider=cfg["provider"]))

        self.push_screen(SetupScreen(required=required), done)

    def _cmd_tui(self, args) -> None:
        """Wissel tussen de fullscreen- en de klassieke renderer (herstart de TUI)."""
        from .config import RENDERERS

        if not args:
            self._sysline(t("tui_current", mode=self.renderer))
            return
        mode = args[0].lower()
        if mode not in RENDERERS:
            self._sysline(t("tui_names"))
            return
        save_config({"tui": mode})
        self._sysline(t("tui_set", mode=mode))
        self.exit({"relaunch": mode})

    # ---------- acties (sneltoetsen) ----------
    def action_transcript(self) -> None:
        self.push_screen(TranscriptScreen(list(getattr(self.agent, "messages", []))))

    def action_scroll_bottom(self) -> None:
        msgs = self._messages()
        msgs.scroll_end(animate=False)
        self._new_since_scroll = 0
        self._update_jump()
        self.query_one("#input", Input).focus()

    def action_scroll_top(self) -> None:
        self._messages().scroll_home(animate=False)

    def action_page_up(self) -> None:
        self._messages().scroll_page_up(animate=False)

    def action_page_down(self) -> None:
        self._messages().scroll_page_down(animate=False)

    def action_quit_app(self) -> None:
        """Ctrl+Q (of Ctrl+C als er niets antwoordt).

        De zwevende ✕ rechtsboven is weg: die hoort nu bij het portret.
        Sluiten kan dus alleen met een toets, of met de ✕ van een popup.
        """
        # Wat er nog in de wachtrij ligt wordt niet meer verstuurd: de app gaat
        # toch dicht, en een half afgehandelde wachtrij is onzin.
        self._queue.clear()
        self._stop = True
        self.exit()

    def action_clear_chat(self) -> None:
        self._messages().remove_children()
        self.agent.clear()

    def action_new_session(self) -> None:
        self._ask_new_session()

    def _ask_new_session(self) -> None:
        """`/new` (en Ctrl+N): eerst een naam, dan pas een leeg gesprek.

        Zonder naam is een nieuw gesprek in `/sessions` niets dan een
        tijdstempel, en juist een gesprek waar je nog niets gezegd hebt is dan
        niet terug te vinden. De popup vraagt er een; Escape laat alles zoals
        het was.
        """
        self.push_screen(NewSessionScreen(), self._start_session)

    def _start_session(self, name) -> None:
        """Begin het nieuwe gesprek onder de naam uit de popup."""
        naam = " ".join(str(name or "").split())
        if not naam:
            return
        from .agent import new_session_id

        self.agent.session_id = new_session_id()
        # De naam staat meteen in het bestand: `clear()` schrijft het weg en
        # `Agent.save()` neemt `session_name` mee.
        self.agent.session_name = naam
        self.agent.clear()
        self._messages().remove_children()
        self._update_status()
        self._sysline(t("msg_new_session", name=naam))

    def _session_renamed(self, session_id: str, name: str) -> None:
        """Een hernoeming uit /sessions, als het om het huidige gesprek gaat.

        De agent moet die naam ook dragen, anders zet de volgende `save()` het
        bestand terug op de oude naam.
        """
        if session_id != str(getattr(self.agent, "session_id", "") or ""):
            return
        self.agent.session_name = name
        self._update_status()
        self._sysline(t("msg_session_renamed", name=name))

    def action_setup(self) -> None:
        self._open_setup()

    # ---------- input ----------
    @on(Click)
    def _focus_input(self) -> None:
        self.query_one("#input", Input).focus()

    # ---------- slash-suggesties (zoals opencode / claude code) ----------
    def _slash_matches(self, text: str) -> list[str]:
        """Commando's die bij een half getypte `/` horen.

        Alleen zolang er nog geen spatie is: zodra er argumenten volgen is het
        commando al gekozen en vullen we niets meer aan. Een exacte treffer
        sluit de langere varianten niet uit: bij `/model` moet `/models` er
        nog steeds bijstaan, anders is die onbereikbaar zodra je het eerste
        commando volledig hebt getypt.
        """
        if not text.startswith("/") or " " in text:
            return []
        prefix = text[1:].casefold()
        return [
            n for n in commands.names() if n == prefix or n.startswith(prefix)
        ]

    def _update_slash(self) -> None:
        listing = self.query_one("#slash", OptionList)
        matches = self._slash_matches(self.query_one("#input", Input).value)
        listing.clear_options()
        if not matches:
            listing.remove_class("visible")
            return
        for name in matches:
            cmd = commands.COMMANDS[name]
            hint = commands.arg_hint(name)
            usage = f" {hint}" if hint else ""
            listing.add_option(
                Option(f"/{name}{usage}  ·  {t(cmd.description)}", id=name)
            )
        listing.highlighted = 0
        listing.add_class("visible")

    def _accept_slash(self, delta: int = 0) -> bool:
        """Beweeg in de suggestielijst en vul het commando aan. True als er iets te doen was."""
        listing = self.query_one("#slash", OptionList)
        if not listing.has_class("visible") or not listing.option_count:
            return False
        if delta:
            current = listing.highlighted if listing.highlighted is not None else 0
            listing.highlighted = max(0, min(listing.option_count - 1, current + delta))
        option = listing.get_option_at_index(listing.highlighted or 0)
        if option is None or not option.id:
            return False
        return self._accept_name(str(option.id))

    def _accept_name(self, name: str) -> bool:
        """Zet de tekst in het veld op het gekozen commando."""
        cmd = commands.COMMANDS.get(name)
        if cmd is None:
            return False
        # Met een spatie erin, want het commando heeft vaak een argument nodig.
        text = f"/{name} " if cmd.usage else f"/{name}"
        box = self.query_one("#input", Input)
        box.value = text
        box.cursor_position = len(text)
        self._update_slash()
        return True

    def _slash_incomplete(self, text: str) -> bool:
        """Of de tekst nog een half getyped commando is.

        Een volledig uitgetypt commando moet op Enter gewoon draaien; alleen een
        afkorting zoals `/cl` vullen we aan.
        """
        stripped = text.strip()
        if not stripped.startswith("/") or " " in stripped:
            return False
        return stripped[1:].casefold() not in commands.COMMANDS

    @on(Input.Changed, "#input")
    def _on_input_changed(self, event: Input.Changed) -> None:
        self._update_slash()

    @on(OptionList.OptionSelected, "#slash")
    def _on_slash_picked(self, event: OptionList.OptionSelected) -> None:
        """Een commando met de muis kiezen werkt hetzelfde als tab."""
        if event.option_id:
            self._accept_name(str(event.option_id))

    @on(Input.Submitted)
    def handle_submit(self, event: Input.Submitted) -> None:
        text = event.value.strip()
        if not text:
            return
        # Een afkorting accepteren we; een heel commando laten we gewoon draaien.
        if self._slash_incomplete(text) and self._accept_slash():
            return
        event.input.value = ""
        self.query_one("#slash", OptionList).remove_class("visible")
        if isinstance(event.input, HistoryInput):
            event.input.add_history(text)

        if text.startswith("/"):
            self._run_command(text)
            return

        # De regel van de gebruiker gaat meteen in het gesprek, ook als er nog
        # een antwoord onderweg is: je moet terug kunnen lezen wat je stuurde.
        self._write(user_line(text))
        if self._streaming:
            # Er antwoordt nog iemand. Het veld blijft gewoon bruikbaar, dus
            # je kunt alvast de volgende vraag intypen; die gaat in de
            # wachtrij en vertrekt zodra het huidige antwoord klaar is.
            self._queue.append(text)
            self._update_queue()
            return
        self._send_now(text)

    # ---------- wachtrij ----------
    def _send_now(self, text: str) -> None:
        """Zet één bericht op de agent en stream het antwoord."""
        self._streaming = True
        self._stop = False
        self._update_queue()
        self._stream_reply(text)

    @work(thread=True)
    def _stream_reply(self, text: str) -> None:
        """Eén antwoord binnenhalen, in een thread.

        De wachtrij draait hier omheen: dit werkt één bericht en roept
        `_reply_done`, en dát pakt het volgende bericht uit de wachtrij. Zo
        draait er nooit meer dan één stream tegelijk en kan een bericht nooit
        twee keer verstuurd worden.

        Het veld wordt NIET disabled: je mag alvast door typen. De wachtrij
        staat in de footer (`_update_queue`).
        """
        reply = roan_reply("…")
        self.call_from_thread(self._write, reply)
        md = reply.query_one(Markdown)
        buf: list[str] = []

        def on_event(ev: dict) -> None:
            self.call_from_thread(self._render_tool_event, ev)

        try:
            for delta in self.agent.send_stream(text, on_event=on_event):
                if self._stop:
                    break
                buf.append(delta)
                self.call_from_thread(md.update, "".join(buf))
        except Exception as e:
            self.call_from_thread(md.update, f"**Fout:** {e}")
        finally:
            self.call_from_thread(self._reply_done)

    def _reply_done(self) -> None:
        """Eén antwoord is klaar: de volgende uit de wachtrij, of niets meer."""
        if self._queue:
            # Poppen vóór het versturen: een bericht dat hier weg is, is
            # verstuurd en kan niet dubbel in de wachtrij terechtkomen.
            self._send_now(self._queue.pop(0))
            return
        self._streaming = False
        self._update_queue()

    def _update_queue(self) -> None:
        """Het rijtje boven het invoerveld: hoeveel berichten er nog wachten."""
        queue = self.query_one("#queue", Static)
        wacht = len(self._queue)
        if not wacht:
            queue.remove_class("visible")
            return
        queue.add_class("visible")
        eerst = clip_cells(self._queue[0], 48)
        queue.update(f"{t('queue_pending', n=wacht)}  ·  {eerst}")

    def _stop_reply(self) -> None:
        """Ctrl+C tijdens een antwoord: stop de stream en leeg de wachtrij."""
        self._stop = True
        self._queue.clear()
        self._update_queue()
        self._sysline(t("msg_aborted"))

    def action_stop_or_quit(self) -> None:
        """Ctrl+C: eerst het lopende antwoord stoppen, sluiten daarna pas."""
        if self._streaming:
            self._stop_reply()
            return
        self.exit()

    def _render_tool_event(self, ev: dict) -> None:
        if ev.get("type") == "tool_call":
            summary = tool_summary(ev.get("name", "?"), ev.get("arguments") or {})
            self._write(Static(f"[{accent_color()}]●[/{accent_color()}] [b]{ev.get('name')}[/b] [dim]{summary}[/dim]"))
            return
        self._write(ToolResult(str(ev.get("name") or "?"), ev.get("result") or ""))


def run_tui(avatar_path=None):
    """Start de TUI; herstart bij een renderer-wissel en val terug bij een crash."""
    from .config import (
        migrate_legacy_dir,
        note_fullscreen_failure,
        resolve_renderer,
    )
    from .home import ensure_home
    from .i18n import init_from_config

    migrate_legacy_dir()
    ensure_home()
    init_from_config()
    agent = Agent()
    try:
        while True:
            mode = resolve_renderer()
            app = RoanApp(agent, avatar_path, renderer=mode)
            try:
                result = app.run(inline=(mode == "default"))
            except Exception as exc:  # fullscreen start mislukt -> klassiek
                if mode == "fullscreen":
                    note_fullscreen_failure()
                    print(f"Fullscreen renderer startte niet ({exc}); klassieke renderer.")
                    continue
                raise
            if isinstance(result, dict) and result.get("relaunch"):
                continue
            break
    finally:
        agent.stop()
