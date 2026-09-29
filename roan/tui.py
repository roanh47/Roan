import asyncio
from pathlib import Path

from textual import on
from textual.app import App, ComposeResult
from textual.containers import VerticalScroll
from textual.widgets import Input, Markdown, Static

from .agent import Agent
from .config import ROAN_DIR
from .photo import render_photo

BUNDLED_AVATAR = Path(__file__).parent / "assets" / "avatar.png"


class RoanApp(App):
    TITLE = "Roan"

    CSS = """
    #top {
        height: auto;
        padding: 1 2;
        background: $panel;
    }
    #messages {
        height: 1fr;
        padding: 1 2;
    }
    #input {
        dock: bottom;
        margin: 1 2;
    }
    .user {
        color: $text;
        padding: 1 0;
    }
    """

    def __init__(self, agent: Agent, avatar_path=None):
        super().__init__()
        self.agent = agent
        self.avatar_path = avatar_path

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

    def compose(self) -> ComposeResult:
        avatar = self._resolve_avatar()
        yield VerticalScroll(id="messages")
        yield Input(placeholder="Message Roan…", id="input")

        if avatar:
            self.avatar = render_photo(avatar)

    def on_mount(self) -> None:
        if getattr(self, "avatar", None):
            msgs = self.query_one("#messages", VerticalScroll)
            msgs.mount(Static(self.avatar))
            msgs.mount(Static("[bold green]Roan[/bold green] — je agent harness\n"))
        else:
            msgs = self.query_one("#messages", VerticalScroll)
            msgs.mount(Static("[bold green]Roan[/bold green] — je agent harness\n"))

    @on(Input.Submitted)
    async def handle_submit(self, event: Input.Submitted) -> None:
        text = event.value.strip()
        if not text:
            return
        event.input.value = ""
        event.input.disabled = True

        msgs = self.query_one("#messages", VerticalScroll)
        msgs.mount(Static(f"[bold cyan]❯ {text}[/bold cyan]\n"))
        msgs.mount(Static("…", id="thinking"))
        thinking = self.query_one("#thinking", Static)

        try:
            result = await asyncio.to_thread(self.agent.send, text)
        except Exception as e:
            result = f"Fout: {e}"

        thinking.remove()
        msgs.mount(Markdown(result))
        msgs.mount(Static(""))
        event.input.disabled = False
        event.input.focus()


def run_tui(avatar_path=None):
    agent = Agent()
    app = RoanApp(agent, avatar_path)
    app.run()
