import asyncio
from pathlib import Path

from textual import on
from textual.app import App, ComposeResult
from textual.containers import VerticalScroll
from textual.events import Click
from textual.widgets import Input, Markdown, Static

try:
    from textual_image.widget import Image as _HDImage

    _HAS_HD = True
except Exception:
    _HDImage = None
    _HAS_HD = False

from . import commands
from .agent import Agent
from .config import PROVIDER_PRESETS, ROAN_DIR, load_config, save_config
from .models import list_free, list_models
from .photo import render_photo
from .themes import ACCENT, THEMES

BUNDLED_AVATAR = Path(__file__).parent / "assets" / "avatar.png"


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
        yield Input(placeholder="Message Roan…  (/help)", id="input")

    def on_mount(self) -> None:
        self.query_one("#input", Input).focus()
        cfg = load_config()
        self._sysline(f"model: {cfg['model']}  ·  provider: {cfg['provider']}")

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

    def _cmd_memory(self) -> None:
        from .memory import load_memory

        mem = load_memory().strip()
        self._write(Markdown(mem or "_(nog niets onthouden)_"))

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

    def _cmd_models(self) -> None:
        cfg = load_config()
        self._sysline(f"Modellen ophalen van {cfg['provider']} ...")
        resp = list_models(cfg["base_url"], cfg["api_key"])
        self._write(Markdown(resp))

    def _cmd_setup(self) -> None:
        cfg = load_config()
        text = [
            "**Setup**",
            "",
            f"- provider: `{cfg['provider']}`",
            f"- base_url: `{cfg['base_url']}`",
            f"- model: `{cfg['model']}`",
            f"- api_key: {'ingesteld' if cfg.get('api_key') else 'leeg'}",
            "",
            f"Config: `{ROAN_DIR / 'config.json'}`",
            "Aanpassen: `/model <naam>`, of bewerk het bestand.",
        ]
        self._write(Markdown("\n".join(text)))

    # ---------- input ----------
    @on(Click)
    def _focus_input(self) -> None:
        self.query_one("#input", Input).focus()

    @on(Input.Submitted)
    async def handle_submit(self, event: Input.Submitted) -> None:
        text = event.value.strip()
        if not text:
            return
        event.input.value = ""

        if text.startswith("/"):
            self._run_command(text)
            return

        event.input.disabled = True
        self._write(Static(f"[bold {ACCENT}]❯ {text}[/bold {ACCENT}]"))
        thinking = Static("[dim]…[/dim]", id="thinking")
        self._write(thinking)

        try:
            result = await asyncio.to_thread(self.agent.send, text)
        except Exception as e:
            result = f"Fout: {e}"

        thinking.remove()
        self._write(Markdown(result))
        event.input.disabled = False
        event.input.focus()


def run_tui(avatar_path=None):
    agent = Agent()
    app = RoanApp(agent, avatar_path)
    for theme in THEMES:
        app.register_theme(theme)
    app.theme = "mocha"
    app.run()
