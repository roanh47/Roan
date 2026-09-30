import asyncio
import json
from pathlib import Path

from textual import on, work
from textual.app import App, ComposeResult
from textual.containers import Horizontal, Vertical, VerticalScroll
from textual.events import Click
from textual.screen import ModalScreen
from textual.widgets import (
    Button,
    Input,
    Label,
    Markdown,
    OptionList,
    Select,
    Static,
)
from textual.widgets.option_list import Option

try:
    from textual_image.widget import Image as _HDImage

    _HAS_HD = True
except Exception:
    _HDImage = None
    _HAS_HD = False

from . import commands
from .agent import Agent
from .config import PROVIDER_PRESETS, ROAN_DIR, load_config, save_config
from .models import (
    fetch_provider_models,
    list_dev,
    list_free,
    list_models,
    list_providers,
    provider_meta,
)
from .i18n import t
from .photo import render_photo
from .themes import ACCENT, THEMES

BUNDLED_AVATAR = Path(__file__).parent / "assets" / "avatar.png"


def resolve_base_url(provider: str) -> str:
    """Base URL voor een provider: eerst onze presets, anders uit models.dev."""
    preset = PROVIDER_PRESETS.get(provider) or {}
    if preset.get("base_url"):
        return str(preset["base_url"])
    return str(provider_meta(provider).get("api") or "")


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
    """Setup-scherm: provider, api_key, model. Automatisch bij de eerste start."""

    CSS = """
    SetupScreen {
        align: center middle;
    }
    #setup-box {
        width: 70%;
        max-width: 90;
        height: auto;
        border: thick $accent;
        background: $panel;
        padding: 1 2;
    }
    #setup-box Label {
        margin-top: 1;
        color: $text-muted;
    }
    #setup-actions {
        margin-top: 2;
        height: auto;
        align-horizontal: right;
    }
    #setup-actions Button {
        margin-left: 2;
    }
    """

    def __init__(self, provider=None, model=None, base_url=None):
        super().__init__()
        cfg = load_config()
        self.provider = provider or cfg.get("provider") or ""
        self.model = model or cfg.get("model") or ""
        self.base_url = base_url or cfg.get("base_url") or ""

    def _provider_line(self) -> str:
        return self.provider or t("setup_none")

    def _model_line(self) -> str:
        return self.model or t("setup_none")

    def compose(self) -> ComposeResult:
        with Vertical(id="setup-box"):
            yield Static(t("setup_title"), classes="title")
            yield Label(t("setup_provider"))
            yield Static(self._provider_line(), id="cur-provider")
            yield Button(t("setup_choose_provider"), id="choose-provider")
            yield Label(t("setup_api_key"))
            yield Input(value="", password=True, placeholder="sk-…", id="api_key")
            yield Label(t("setup_model"))
            yield Static(self._model_line(), id="cur-model")
            yield Button(t("setup_choose_model"), id="choose-model")
            yield Label(t("setup_base_url"))
            yield Input(value=self.base_url, id="base_url")
            with Horizontal(id="setup-actions"):
                yield Button(t("setup_cancel"), id="cancel")
                yield Button(t("setup_save"), id="save", variant="primary")

    # ---------- provider / model kiezen ----------
    def _choose_provider(self) -> None:
        def picked(result) -> None:
            if not result:
                return
            provider, base_url = result
            self.provider = provider
            resolved = base_url or resolve_base_url(provider)
            if resolved:
                self.base_url = resolved
                self.query_one("#base_url", Input).value = resolved
            self.query_one("#cur-provider", Static).update(self._provider_line())

        self.app.push_screen(ProviderScreen(), picked)

    def _choose_model(self) -> None:
        self._load_models()

    @work(thread=True, exclusive=True)
    def _load_models(self) -> None:
        free, paid, custom = gather_models()
        self.app.call_from_thread(self._open_models, free, paid, custom)

    def _open_models(self, free, paid, custom) -> None:
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
        if bid == "cancel":
            self.dismiss(False)
            return
        if bid == "choose-provider":
            self._choose_provider()
            return
        if bid == "choose-model":
            self._choose_model()
            return

        api_key = self.query_one("#api_key", Input).value.strip()
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
    """Provider kiezen: Gratis / Betaald / Custom — live uit models.dev."""

    CSS = """
    ProviderScreen {
        align: center middle;
    }
    #provider-box {
        width: 80%;
        max-width: 110;
        height: 80%;
        border: thick $accent;
        background: $panel;
        padding: 1 2;
    }
    #provider-filters {
        height: auto;
        margin-bottom: 1;
    }
    #provider-filters Select {
        width: 1fr;
    }
    #provider-list {
        height: 1fr;
    }
    #provider-info {
        height: auto;
        color: $text-muted;
    }
    #provider-actions {
        margin-top: 1;
        height: auto;
        align-horizontal: right;
    }
    #provider-actions Button {
        margin-left: 2;
    }
    """

    def __init__(self, category: str = "free"):
        super().__init__()
        self.providers = {"free": [], "paid": []}
        self._chosen = ""
        self._category = category

    def compose(self) -> ComposeResult:
        with Vertical(id="provider-box"):
            yield Static(t("provider_title"), classes="title")
            with Horizontal(id="provider-filters"):
                yield Select(
                    [
                        (t("provider_cat_free"), "free"),
                        (t("provider_cat_paid"), "paid"),
                        (t("provider_cat_custom"), "custom"),
                    ],
                    value=self._category,
                    id="pcat",
                    allow_blank=False,
                )
            yield OptionList(id="provider-list")
            yield Label(t("provider_base_url"))
            yield Input(id="pbase", placeholder="https://api.example.com/v1")
            yield Static(id="provider-info")
            with Horizontal(id="provider-actions"):
                yield Button(t("provider_back"), id="pback")
                yield Button(t("provider_choose"), id="pchoose", variant="primary")

    def on_mount(self) -> None:
        self._rebuild()
        self._load()

    @work(thread=True, exclusive=True)
    def _load(self) -> None:
        free = list_providers("free")
        paid = list_providers("paid")
        self.app.call_from_thread(self._set_providers, free, paid)

    def _set_providers(self, free, paid) -> None:
        self.providers = {"free": free, "paid": paid}
        self._rebuild()

    def _cat(self) -> str:
        return self.query_one("#pcat", Select).value

    def _rebuild(self) -> None:
        cat = self._cat()
        custom = cat == "custom"
        listing = self.query_one("#provider-list", OptionList)
        listing.display = not custom
        self.query_one("#pbase", Input).display = custom
        if custom:
            return
        listing.clear_options()
        for pid, name in self.providers.get(cat, []):
            meta = provider_meta(pid)
            suffix = f"  ·  {t('provider_plan')}" if meta["plan"] else ""
            listing.add_option(Option(f"{name}  ·  {pid}{suffix}", id=pid))

    @on(Select.Changed)
    def _on_cat(self, event: Select.Changed) -> None:
        if event.select.id == "pcat":
            self._chosen = ""
            self.query_one("#provider-info", Static).update("")
            self._rebuild()

    def on_option_list_option_selected(self, event: OptionList.OptionSelected) -> None:
        self._chosen = str(event.option_id or "")
        meta = provider_meta(self._chosen)
        bits = []
        if meta["plan"]:
            bits.append("⚠ " + t("provider_plan_note", provider=meta["name"]))
        if meta["env"]:
            bits.append(f"{t('provider_env')}: {meta['env']}")
        if meta["doc"]:
            bits.append(f"{t('provider_doc')}: {meta['doc']}")
        self.query_one("#provider-info", Static).update("\n".join(bits))

    @on(Button.Pressed)
    def _on_button(self, event: Button.Pressed) -> None:
        if event.button.id == "pback":
            self.dismiss(None)
            return
        if self._cat() == "custom":
            self.dismiss(("custom", self.query_one("#pbase", Input).value.strip()))
            return
        if self._chosen:
            self.dismiss((self._chosen, resolve_base_url(self._chosen)))


class ModelsScreen(ModalScreen):
    """Model-browser: Free / Paid / Custom, gefilterd per provider."""

    CSS = """
    ModelsScreen {
        align: center middle;
    }
    #models-box {
        width: 80%;
        max-width: 110;
        height: 80%;
        border: thick $accent;
        background: $panel;
        padding: 1 2;
    }
    #models-filters {
        height: auto;
        margin-bottom: 1;
    }
    #models-filters Select {
        width: 1fr;
        margin-right: 1;
    }
    #models-list {
        height: 1fr;
    }
    """

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

    def compose(self) -> ComposeResult:
        with Vertical(id="models-box"):
            title = (
                t("models_for", provider=self.fixed_provider)
                if self.fixed_provider
                else t("models_title")
            )
            yield Static(title, classes="title")
            with Horizontal(id="models-filters"):
                yield Select(
                    [
                        (t("models_free"), "free"),
                        (t("models_paid"), "paid"),
                        (t("models_custom"), "custom"),
                    ],
                    value="free",
                    id="cat",
                    allow_blank=False,
                )
                yield Select(
                    [(t("models_all_providers"), "__all__")], value="__all__", id="prov", allow_blank=False
                )
            yield OptionList(id="models-list")

    def on_mount(self) -> None:
        if self.fixed_provider:
            self.query_one("#prov", Select).display = False
        self._refresh_providers()
        self._rebuild()

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

    def _rebuild(self) -> None:
        prov = self.query_one("#prov", Select).value
        items = [(p, m) for p, m in self._current() if prov in (None, "__all__", p)]
        listing = self.query_one("#models-list", OptionList)
        listing.clear_options()
        cap = 400
        for p, m in items[:cap]:
            listing.add_option(Option(f"{m}  ·  {p}", id=f"{p}|{m}"))
        if len(items) > cap:
            listing.add_option(Option(t("models_more", n=len(items) - cap), id=None))

    @on(Select.Changed)
    def _on_select(self, event: Select.Changed) -> None:
        if event.select.id == "cat":
            self._refresh_providers()
        self._rebuild()

    def on_option_list_option_selected(self, event: OptionList.OptionSelected) -> None:
        if not event.option_id or "|" not in event.option_id:
            return
        provider, model = event.option_id.split("|", 1)
        self.dismiss((provider, model))


class Messages(VerticalScroll):
    """Berichtenlijst. Muiswiel-snelheid volgt de `scroll_speed`-instelling."""

    def _speed(self) -> float:
        try:
            return float(load_config().get("scroll_speed") or 1)
        except (TypeError, ValueError):
            return 1.0

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
        return f"  [{ACCENT}]↳ {self.tool_name}[/{ACCENT}]\n{body}"

    def on_click(self) -> None:
        self.expanded = not self.expanded
        self.update(self._full() if self.expanded else self._collapsed())


class TuiPromptScreen(ModalScreen):
    """Startup-dialoog: nieuwe fullscreen-TUI gebruiken of niet."""

    CSS = """
    TuiPromptScreen {
        align: center middle;
    }
    #tui-prompt {
        width: 70%;
        max-width: 90;
        height: auto;
        border: thick $accent;
        background: $panel;
        padding: 1 2;
    }
    #tui-actions {
        margin-top: 2;
        height: auto;
        align-horizontal: right;
    }
    #tui-actions Button {
        margin-left: 2;
    }
    """

    def compose(self) -> ComposeResult:
        with Vertical(id="tui-prompt"):
            yield Static(t("tui_prompt_title"), classes="title")
            yield Static(t("tui_prompt_body"))
            with Horizontal(id="tui-actions"):
                yield Button(t("tui_notnow"), id="notnow")
                yield Button(t("tui_yes"), id="yes", variant="primary")

    @on(Button.Pressed)
    def _on_button(self, event: Button.Pressed) -> None:
        self.dismiss(event.button.id == "yes")


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

    CSS = """
    TranscriptScreen {
        align: center middle;
    }
    #transcript-box {
        width: 95%;
        max-width: 140;
        height: 95%;
        border: thick $accent;
        background: $panel;
        padding: 0 1;
    }
    #tbody {
        height: 1fr;
        padding: 0 1;
    }
    #thint {
        dock: bottom;
        height: 1;
        color: $text-muted;
    }
    #tsearch {
        display: none;
    }
    """

    def __init__(self, messages: list[dict]):
        super().__init__()
        self.entries = messages
        self.matches: list[int] = []
        self._pos = -1
        self._widgets: list = []

    def compose(self) -> ComposeResult:
        with Vertical(id="transcript-box"):
            yield Static(t("transcript_title"), classes="title")
            yield Input(placeholder=t("transcript_search"), id="tsearch")
            yield VerticalScroll(id="tbody")
            yield Static(t("transcript_hint"), id="thint")

    def on_mount(self) -> None:
        body = self.query_one("#tbody", VerticalScroll)
        self._widgets = []
        for msg in self.entries:
            role = msg.get("role")
            content = msg.get("content") or ""
            if role == "user":
                widget = Static(f"[bold {ACCENT}]❯ {content}[/bold {ACCENT}]")
            elif role == "assistant":
                widget = Markdown(content)
            elif role == "tool":
                widget = Static(f"  [dim]↳ {content}[/dim]")
            else:
                continue
            self._widgets.append(widget)
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
        for i, widget in enumerate(self._widgets):
            text = getattr(widget, "source", None) or str(widget.render())
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


class RoanApp(App):
    TITLE = "Roan"
    MIN_SIZE = (1, 1)

    BINDINGS = [
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
    #avatar {
        width: 25%;
        height: auto;
    }
    #messages {
        height: 1fr;
        padding: 1 2;
    }
    #status {
        dock: bottom;
        height: 1;
        background: $panel;
        color: $text-muted;
        padding: 0 2;
    }
    #jump {
        dock: bottom;
        height: 1;
        background: $accent;
        color: $background;
        text-align: right;
        padding: 0 2;
    }
    #input {
        dock: bottom;
        margin: 1 2;
    }
    .title {
        color: $accent;
        text-style: bold;
        padding: 0 2;
    }
    """

    def __init__(self, agent: Agent, avatar_path=None, renderer: str = "default"):
        super().__init__()
        self.agent = agent
        self.avatar_path = avatar_path
        self.renderer = renderer
        self._new_since_scroll = 0
        for theme in THEMES:
            self.register_theme(theme)
        self.theme = "mocha"

    # ---------- avatar ----------
    def _resolve_avatar(self):
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

    def _photo_width(self) -> int:
        width = self.size.width or 80
        if width < 40:
            return max(6, width - 6)
        return max(12, width // 4)

    # ---------- layout ----------
    def compose(self) -> ComposeResult:
        avatar = self._resolve_avatar()
        if avatar:
            if _HAS_HD:
                yield _HDImage(avatar, id="avatar")
            else:
                yield Static(render_photo(avatar, width=self._photo_width()))
        yield Static(f"Roan — {t('app_subtitle')}", classes="title")
        yield Messages(id="messages")
        yield Static(id="jump")
        yield Static(id="status")
        yield HistoryInput(placeholder=t("input_placeholder"), id="input")

    def on_mount(self) -> None:
        self.query_one("#input", Input).focus()
        self._update_status()
        self._render_history()
        from .config import has_config

        if not has_config():
            self._write(Markdown(t("onboarding")))
            self._open_setup()
            return
        cfg = load_config()
        self._sysline(f"model: {cfg['model']}  ·  provider: {cfg['provider']}")
        self._maybe_offer_fullscreen()

    def _maybe_offer_fullscreen(self) -> None:
        """Bied de nieuwe fullscreen-TUI aan (max 3x, niet na 'niet nu')."""
        from .config import should_offer_fullscreen

        if self.renderer != "default" or not should_offer_fullscreen():
            return
        save_config({"tui_prompts": int(load_config().get("tui_prompts") or 0) + 1})

        def answered(yes: bool | None) -> None:
            if yes:
                save_config({"tui": "fullscreen"})
                self.exit({"relaunch": "fullscreen"})
            else:
                save_config({"tui_declined": True})
                self._sysline(t("tui_current", mode="default"))

        self.push_screen(TuiPromptScreen(), answered)

    def _render_history(self) -> None:
        """Toon het herstelde gesprek zodat de context zichtbaar is."""
        for msg in getattr(self.agent, "messages", [])[1:]:
            role = msg.get("role")
            content = msg.get("content")
            if role == "user" and content:
                self._write(Static(f"[bold {ACCENT}]❯ {content}[/bold {ACCENT}]"))
            elif role == "assistant" and content:
                self._write(Markdown(content))
        if len(getattr(self.agent, "messages", [])) > 1:
            self._sysline(t("msg_restored", n=len(self.agent.messages) - 1))
        msgs = self._messages()
        msgs.scroll_end(animate=False)
        self._new_since_scroll = 0
        self._update_jump()

    def _update_status(self) -> None:
        cfg = load_config()
        key = t("status_key_set") if cfg.get("api_key") else t("status_no_key")
        self.query_one("#status", Static).update(
            f"{cfg['model']}  ·  {cfg['provider']}  ·  {key}  ·  {t('status_session')} {self.agent.session_id}"
        )

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
        if name == "free":
            self._cmd_free()
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
            import time

            self.agent.session_id = time.strftime("%Y%m%d-%H%M%S")
            self.agent.clear()
            self._messages().remove_children()
            self._update_status()
            self._sysline(t("msg_new_session", id=self.agent.session_id))
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
        if name == "tui":
            self._cmd_tui(args)
            return True
        if name == "setup":
            self._cmd_setup()
            return True

        self._sysline(t("msg_unknown_cmd", name=name))
        return True

    def _cmd_free(self) -> None:
        self._sysline(t("models_fetching"))
        self._write(Markdown(list_free()))

    def _cmd_provider(self, args) -> None:
        if args:
            name = args[0].lower()
            if name not in PROVIDER_PRESETS:
                self._sysline(t("msg_providers", names=", ".join(sorted(PROVIDER_PRESETS))))
                return
            save_config({"provider": name})
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
            provider, base_url = result
            updates: dict = {"provider": provider}
            resolved = base_url or resolve_base_url(provider)
            if resolved:
                updates["base_url"] = resolved
            save_config(updates)
            self.agent.reload()
            self._update_status()
            self._sysline(t("msg_provider_set", name=provider))
            self._fetch_models(fixed_provider=provider)

        self.push_screen(ProviderScreen(), picked)

    def _cmd_memory(self) -> None:
        from .memory import load_memory

        mem = load_memory().strip()
        self._write(Markdown(mem or t("msg_memory_empty")))

    def _cmd_skills(self) -> None:
        from .skills import skills_list_text

        self._write(Markdown(skills_list_text()))

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
        self._sysline(t("msg_language_set", lang=new_code))

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
        from .agent import SESSIONS_DIR

        if not SESSIONS_DIR.exists():
            self._sysline(t("msg_no_sessions"))
            return
        files = sorted(SESSIONS_DIR.glob("*.json"), reverse=True)
        if not files:
            self._sysline(t("msg_no_sessions"))
            return
        lines = [f"**{t('msg_sessions_title')}**", ""]
        for f in files[:20]:
            lines.append(f"- `{f.stem}`")
        self._write(Markdown("\n".join(lines)))

    def _cmd_theme(self, args) -> None:
        if not args:
            self._write(Markdown(commands.help_text()))
            return
        name = args[0].lower()
        if name not in [t_.name for t_ in THEMES]:
            self._sysline(t("msg_themes", names=", ".join(t_.name for t_ in THEMES)))
            return
        self.theme = name
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
        self._sysline(t("models_fetching"))
        self._fetch_models()

    @work(thread=True, exclusive=True)
    def _fetch_models(self, fixed_provider: str | None = None) -> None:
        free, paid, custom = gather_models()
        self.call_from_thread(self._open_models, free, paid, custom, fixed_provider)

    def _open_models(self, free, paid, custom, fixed_provider: str | None = None) -> None:
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
        def done(saved: bool | None) -> None:
            if not saved:
                return
            self.agent.reload()
            self._update_status()
            self._messages().remove_children()
            cfg = load_config()
            self._sysline(t("setup_saved", model=cfg["model"], provider=cfg["provider"]))

        self.push_screen(SetupScreen(), done)

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

    @on(Click, "#jump")
    def _jump_clicked(self) -> None:
        self.action_scroll_bottom()

    def action_clear_chat(self) -> None:
        self._messages().remove_children()
        self.agent.clear()

    def action_new_session(self) -> None:
        import time

        self.agent.session_id = time.strftime("%Y%m%d-%H%M%S")
        self.agent.clear()
        self._messages().remove_children()
        self._update_status()
        self._sysline(t("msg_new_session", id=self.agent.session_id))

    def action_setup(self) -> None:
        self._open_setup()

    # ---------- input ----------
    @on(Click)
    def _focus_input(self) -> None:
        self.query_one("#input", Input).focus()

    @on(Input.Submitted)
    def handle_submit(self, event: Input.Submitted) -> None:
        text = event.value.strip()
        if not text:
            return
        event.input.value = ""
        if isinstance(event.input, HistoryInput):
            event.input.add_history(text)

        if text.startswith("/"):
            self._run_command(text)
            return

        self._write(Static(f"[bold {ACCENT}]❯ {text}[/bold {ACCENT}]"))
        self._stream_response(text)

    @work(thread=True, exclusive=True)
    def _stream_response(self, text: str) -> None:
        inp = self.query_one("#input", Input)
        self.call_from_thread(setattr, inp, "disabled", True)
        md = Markdown("…")
        self.call_from_thread(self._write, md)
        buf: list[str] = []

        def on_event(ev: dict) -> None:
            self.call_from_thread(self._render_tool_event, ev)

        try:
            for delta in self.agent.send_stream(text, on_event=on_event):
                buf.append(delta)
                self.call_from_thread(md.update, "".join(buf))
        except Exception as e:
            self.call_from_thread(md.update, f"**Fout:** {e}")
        finally:
            self.call_from_thread(setattr, inp, "disabled", False)
            self.call_from_thread(inp.focus)

    def _render_tool_event(self, ev: dict) -> None:
        if ev.get("type") == "tool_call":
            summary = tool_summary(ev.get("name", "?"), ev.get("arguments") or {})
            self._write(Static(f"[{ACCENT}]●[/{ACCENT}] [b]{ev.get('name')}[/b] [dim]{summary}[/dim]"))
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
