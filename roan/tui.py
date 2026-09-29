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
from .models import fetch_provider_models, list_dev, list_free, list_models
from .photo import render_photo
from .themes import ACCENT, THEMES

BUNDLED_AVATAR = Path(__file__).parent / "assets" / "avatar.png"


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

    def compose(self) -> ComposeResult:
        cfg = load_config()
        provider = cfg.get("provider", "lmstudio")
        with Vertical(id="setup-box"):
            yield Static("Setup", classes="title")
            yield Label("Provider")
            yield Select(
                [(name, name) for name in sorted(PROVIDER_PRESETS)],
                value=provider if provider in PROVIDER_PRESETS else "lmstudio",
                id="provider",
                allow_blank=False,
            )
            yield Label("API key (leeg = bestaande behouden)")
            yield Input(value="", password=True, placeholder="sk-…", id="api_key")
            yield Label("Model")
            yield Input(value=cfg.get("model", ""), id="model")
            yield Label("Base URL (alleen bij provider = custom)")
            yield Input(value=cfg.get("base_url") or "", id="base_url")
            with Horizontal(id="setup-actions"):
                yield Button("Annuleren", id="cancel")
                yield Button("Opslaan", id="save", variant="primary")

    @on(Button.Pressed)
    def _on_button(self, event: Button.Pressed) -> None:
        if event.button.id == "cancel":
            self.dismiss(False)
            return

        provider = self.query_one("#provider", Select).value
        api_key = self.query_one("#api_key", Input).value.strip()
        model = self.query_one("#model", Input).value.strip()
        base_url = self.query_one("#base_url", Input).value.strip()

        updates: dict = {"provider": provider}
        if api_key:
            updates["api_key"] = api_key
        if model:
            updates["model"] = model
        if provider == "custom" and base_url:
            updates["base_url"] = base_url

        save_config(updates)
        self.dismiss(True)


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

    def __init__(self, free: list[tuple[str, str]], paid: list[tuple[str, str]], custom: list[str]):
        super().__init__()
        self.data = {"free": free, "paid": paid, "custom": custom}

    def compose(self) -> ComposeResult:
        with Vertical(id="models-box"):
            yield Static("Modellen", classes="title")
            with Horizontal(id="models-filters"):
                yield Select(
                    [("Gratis", "free"), ("Betaald", "paid"), ("Deze provider", "custom")],
                    value="free",
                    id="cat",
                    allow_blank=False,
                )
                yield Select([("alle providers", "__all__")], value="__all__", id="prov", allow_blank=False)
            yield OptionList(id="models-list")

    def on_mount(self) -> None:
        self._refresh_providers()
        self._rebuild()

    def _current(self) -> list[tuple[str, str]]:
        cat = self.query_one("#cat", Select).value
        if cat == "custom":
            return [(load_config()["provider"], m) for m in self.data["custom"]]
        return self.data.get(cat, [])

    def _refresh_providers(self) -> None:
        providers = sorted({p for p, _ in self._current()})
        sel = self.query_one("#prov", Select)
        sel.set_options([("alle providers", "__all__")] + [(p, p) for p in providers])

    def _rebuild(self) -> None:
        prov = self.query_one("#prov", Select).value
        items = [(p, m) for p, m in self._current() if prov in (None, "__all__", p)]
        listing = self.query_one("#models-list", OptionList)
        listing.clear_options()
        cap = 400
        for p, m in items[:cap]:
            listing.add_option(Option(f"{m}  ·  {p}", id=f"{p}|{m}"))
        if len(items) > cap:
            listing.add_option(Option(f"… en nog {len(items) - cap} modellen (filter op provider)", id=None))

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


class RoanApp(App):
    TITLE = "Roan"
    MIN_SIZE = (1, 1)

    BINDINGS = [
        ("ctrl+l", "clear_chat", "clear"),
        ("ctrl+n", "new_session", "nieuw"),
        ("f2", "setup", "setup"),
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

    def __init__(self, agent: Agent, avatar_path=None):
        super().__init__()
        self.agent = agent
        self.avatar_path = avatar_path
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
        yield Static("Roan — je agent harness", classes="title")
        yield VerticalScroll(id="messages")
        yield Static(id="status")
        yield HistoryInput(placeholder="Message Roan…  (/help)", id="input")

    def on_mount(self) -> None:
        self.query_one("#input", Input).focus()
        self._update_status()
        self._render_history()
        from .config import has_config

        if not has_config():
            self._write(
                Markdown(
                    "**Nog geen model geconfigureerd.**\n\n"
                    "Stel het hieronder in, of draai `Roan init` in een terminal."
                )
            )
            self._open_setup()
            return
        cfg = load_config()
        self._sysline(f"model: {cfg['model']}  ·  provider: {cfg['provider']}")

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
            self._sysline(f"(gesprek hersteld — {len(self.agent.messages) - 1} berichten)")

    def _update_status(self) -> None:
        cfg = load_config()
        key = "key set" if cfg.get("api_key") else "no key"
        self.query_one("#status", Static).update(
            f"{cfg['model']}  ·  {cfg['provider']}  ·  {key}  ·  sessie {self.agent.session_id}"
        )

    # ---------- helpers ----------
    def _messages(self) -> VerticalScroll:
        return self.query_one("#messages", VerticalScroll)

    def _sysline(self, text: str) -> None:
        self._messages().mount(Static(f"[dim]{text}[/dim]"))

    def _write(self, renderable) -> None:
        msgs = self._messages()
        msgs.mount(renderable)
        msgs.scroll_end(animate=False)

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
        if name == "new":
            self.agent.session_id = __import__("time").strftime("%Y%m%d-%H%M%S")
            self.agent.clear()
            self._messages().remove_children()
            self._sysline(f"Nieuwe sessie: {self.agent.session_id}")
            return True
        if name == "sessions":
            self._cmd_sessions()
            return True
        if name == "compact":
            self._cmd_compact()
            return True
        if name == "setup":
            self._cmd_setup()
            return True

        self._sysline(f"Onbekend commando: /{name}  (probeer /help)")
        return True

    def _cmd_free(self) -> None:
        self._sysline("Gratis modellen ophalen van models.dev ...")
        self._write(Markdown(list_free()))

    def _cmd_provider(self, args) -> None:
        cfg = load_config()
        if not args:
            self._sysline(f"Huidige provider: {cfg['provider']}")
            return
        name = args[0].lower()
        if name not in PROVIDER_PRESETS:
            self._sysline(f"Providers: {', '.join(sorted(PROVIDER_PRESETS))}")
            return
        save_config({"provider": name})
        self.agent.reload()
        self._sysline(f"Provider → {name}")
        self._update_status()

    def _cmd_memory(self) -> None:
        from .memory import load_memory

        mem = load_memory().strip()
        self._write(Markdown(mem or "_(nog niets onthouden)_"))

    def _cmd_compact(self) -> None:
        self._sysline("Gesprek samenvatten ...")
        self._compact_worker()

    @work(thread=True, exclusive=True)
    def _compact_worker(self) -> None:
        try:
            ok = self.agent.compact(force=True)
        except Exception:
            ok = False
        self.call_from_thread(
            self._sysline, "Gesprek samengevat." if ok else "Niets om samen te vatten."
        )

    def _cmd_sessions(self) -> None:
        from .agent import SESSIONS_DIR

        if not SESSIONS_DIR.exists():
            self._sysline("Nog geen sessies.")
            return
        files = sorted(SESSIONS_DIR.glob("*.json"), reverse=True)
        if not files:
            self._sysline("Nog geen sessies.")
            return
        lines = ["**Sessies**", ""]
        for f in files[:20]:
            lines.append(f"- `{f.stem}`")
        self._write(Markdown("\n".join(lines)))

    def _cmd_theme(self, args) -> None:
        if not args:
            self._write(Markdown(commands.help_text()))
            return
        name = args[0].lower()
        if name not in [t.name for t in THEMES]:
            self._sysline(f"Thema's: {', '.join(t.name for t in THEMES)}")
            return
        self.theme = name
        self._sysline(f"Thema → {name}")

    def _cmd_model(self, args) -> None:
        if not args:
            cfg = load_config()
            self._sysline(f"Huidig model: {cfg['model']}")
            return
        cfg = save_config({"model": args[0]})
        self.agent.reload()
        self._sysline(f"Model → {cfg['model']}")
        self._update_status()

    def _cmd_models(self) -> None:
        self._sysline("Modellen ophalen (models.dev + provider) ...")
        self._fetch_models()

    @work(thread=True, exclusive=True)
    def _fetch_models(self) -> None:
        cfg = load_config()
        free = list_dev("free")
        paid = list_dev("paid")
        custom = fetch_provider_models(cfg["base_url"], cfg["api_key"])
        self.call_from_thread(self._open_models, free, paid, custom)

    def _open_models(self, free, paid, custom) -> None:
        def chosen(result) -> None:
            if not result:
                return
            provider, model = result
            updates: dict = {"model": model}
            if provider in PROVIDER_PRESETS:
                updates["provider"] = provider
            save_config(updates)
            self.agent.reload()
            self._update_status()
            cfg = load_config()
            if provider not in PROVIDER_PRESETS:
                self._sysline(
                    f"Model → {model}. Provider '{provider}' is niet bekend — "
                    "stel base_url + api_key in via /setup."
                )
            else:
                self._sysline(f"Model → {model}  ·  provider → {cfg['provider']}")

        self.push_screen(ModelsScreen(free, paid, custom), chosen)

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
            self._sysline(f"Opgeslagen — model: {cfg['model']}  ·  provider: {cfg['provider']}")

        self.push_screen(SetupScreen(), done)

    # ---------- acties (sneltoetsen) ----------
    def action_clear_chat(self) -> None:
        self._messages().remove_children()
        self.agent.clear()

    def action_new_session(self) -> None:
        import time

        self.agent.session_id = time.strftime("%Y%m%d-%H%M%S")
        self.agent.clear()
        self._messages().remove_children()
        self._update_status()
        self._sysline(f"Nieuwe sessie: {self.agent.session_id}")

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
        lines = (ev.get("result") or "").strip().splitlines()
        first = lines[0][:120] if lines else ""
        bad = first.lower().startswith("error") or first.startswith("Error")
        marker = "✗" if bad else "↳"
        self._write(Static(f"  [dim]{marker} {first}[/dim]"))


def run_tui(avatar_path=None):
    from .config import migrate_legacy_dir

    migrate_legacy_dir()
    agent = Agent()
    app = RoanApp(agent, avatar_path)
    app.run()
