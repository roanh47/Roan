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
from .models import fetch_provider_models, list_free, list_models
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


class ModelPicker(ModalScreen):
    """Klikbare dropdown om een model te kiezen."""

    CSS = """
    ModelPicker {
        align: center middle;
    }
    #picker {
        width: 60%;
        height: auto;
        max-height: 70%;
        border: thick $accent;
        background: $panel;
    }
    """

    def __init__(self, models: list[str]):
        super().__init__()
        self.models = models

    def compose(self) -> ComposeResult:
        options = [Option(m, id=m) for m in self.models]
        yield OptionList(*options, id="picker")

    def on_option_list_option_selected(self, event: OptionList.OptionSelected) -> None:
        self.dismiss(str(event.option.id))


class RoanApp(App):
    TITLE = "Roan"
    MIN_SIZE = (1, 1)

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
        yield Input(placeholder="Message Roan…  (/help)", id="input")

    def on_mount(self) -> None:
        self.query_one("#input", Input).focus()
        self._update_status()
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
        self._sysline("Modellen ophalen ...")
        self._fetch_models()

    @work(thread=True, exclusive=True)
    def _fetch_models(self) -> None:
        cfg = load_config()
        models = fetch_provider_models(cfg["base_url"], cfg["api_key"])
        if not models:
            self.call_from_thread(self._write, Markdown(list_models(cfg["base_url"], cfg["api_key"])))
            return
        self.call_from_thread(self._open_picker, models)

    def _open_picker(self, models: list[str]) -> None:
        def chosen(model: str | None) -> None:
            if not model:
                return
            save_config({"model": model})
            self.agent.reload()
            self._sysline(f"Model → {model}")
            self._update_status()

        self.push_screen(ModelPicker(models), chosen)

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
