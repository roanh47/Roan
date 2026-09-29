"""TUI-tests via Textual's headless pilot (geen netwerk)."""

import pytest

from roan import config
from roan.tui import RoanApp, SetupScreen


class FakeAgent:
    model = "fake"
    session_id = "test-session"
    messages = []

    def __init__(self):
        self.sent = []

    def reload(self):
        pass

    def clear(self):
        self.messages = []

    def save(self):
        pass

    def send(self, text):
        self.sent.append(text)
        return f"echo: {text}"

    def send_stream(self, text, on_event=None):
        self.sent.append(text)
        yield f"echo: {text}"


@pytest.fixture
def tmp_roan(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "ROAN_DIR", tmp_path)
    monkeypatch.setattr(config, "CONFIG_PATH", tmp_path / "config.json")
    monkeypatch.setattr(config, "MEMORY_PATH", tmp_path / "memory.md")
    monkeypatch.setattr(config, "INSTRUCTIONS_PATH", tmp_path / "instructions.md")
    # Standaard een config zodat het setup-scherm niet automatisch opent.
    config.save_config({"provider": "lmstudio", "model": "test-model"})
    return tmp_path


@pytest.fixture
def tmp_roan_noconfig(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "ROAN_DIR", tmp_path)
    monkeypatch.setattr(config, "CONFIG_PATH", tmp_path / "config.json")
    monkeypatch.setattr(config, "MEMORY_PATH", tmp_path / "memory.md")
    monkeypatch.setattr(config, "INSTRUCTIONS_PATH", tmp_path / "instructions.md")
    return tmp_path


@pytest.mark.asyncio
async def test_slash_help(tmp_roan):
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        await pilot.press(*"/help", "enter")
        await pilot.pause()
        texts = [w.source for w in app.query("Markdown")]
        assert any("Commando" in str(t) for t in texts)


@pytest.mark.asyncio
async def test_slash_model_writes_config(tmp_roan):
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        await pilot.press(*"/model test-123", "enter")
        await pilot.pause()
        assert config.load_config()["model"] == "test-123"


@pytest.mark.asyncio
async def test_slash_clear(tmp_roan):
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        await pilot.press(*"/model x", "enter")
        await pilot.pause()
        assert len(app.query("#messages > *")) > 0
        await pilot.press(*"/clear", "enter")
        await pilot.pause()
        assert len(app.query("#messages > *")) == 0


@pytest.mark.asyncio
async def test_normal_message_goes_to_agent(tmp_roan):
    agent = FakeAgent()
    app = RoanApp(agent)
    async with app.run_test() as pilot:
        await pilot.press(*"hi there", "enter")
        await pilot.pause()
        await pilot.pause()
        assert agent.sent == ["hi there"]


@pytest.mark.asyncio
async def test_theme_switch(tmp_roan):
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        await pilot.press(*"/theme latte", "enter")
        await pilot.pause()
        assert app.theme == "latte"


@pytest.mark.asyncio
async def test_model_picker_selects(tmp_roan):
    from roan.tui import ModelPicker

    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        app._open_picker(["model-a", "model-b"])
        await pilot.pause()
        assert isinstance(app.screen, ModelPicker)
        await pilot.press("enter")
        await pilot.pause()
        assert config.load_config()["model"] == "model-a"


@pytest.mark.asyncio
async def test_unknown_command_reports(tmp_roan):
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        await pilot.press(*"/nope", "enter")
        await pilot.pause()
        statics = [str(w.render()) for w in app.query("Static")]
        assert any("Onbekend" in s for s in statics)


@pytest.mark.asyncio
async def test_status_bar_shows_model(tmp_roan):
    config.save_config({"provider": "groq", "model": "my-model"})
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        await pilot.pause()
        status = str(app.query_one("#status").render())
        assert "my-model" in status
        assert "groq" in status


def test_tool_summary_variants():
    from roan.tui import tool_summary

    assert tool_summary("run_shell", {"command": "ls -la"}) == "ls -la"
    assert tool_summary("read_file", {"path": "/tmp/x"}) == "/tmp/x"
    assert tool_summary("web_search", {"query": "python"}) == "python"
    assert tool_summary("other", {}) == ""


@pytest.mark.asyncio
async def test_tool_events_render(tmp_roan):
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        await pilot.pause()
        before = len(app.query("#messages > *"))
        app._render_tool_event({"type": "tool_call", "name": "run_shell", "arguments": {"command": "ls"}})
        app._render_tool_event({"type": "tool_result", "name": "run_shell", "result": "file.py"})
        await pilot.pause()
        after = app.query("#messages > *")
        assert len(after) == before + 2
        rendered = " ".join(str(w.render()) for w in after)
        assert "run_shell" in rendered and "file.py" in rendered


@pytest.mark.asyncio
async def test_setup_auto_opens_without_config(tmp_roan_noconfig):
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        await pilot.pause()
        assert isinstance(app.screen, SetupScreen)


@pytest.mark.asyncio
async def test_setup_screen_saves(tmp_roan):
    from textual.widgets import Button, Input

    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        app._open_setup()
        await pilot.pause()
        assert isinstance(app.screen, SetupScreen)
        app.screen.query_one("#model", Input).value = "setup-model"
        app.screen.query_one("#save", Button).press()
        await pilot.pause()
        assert config.load_config()["model"] == "setup-model"


@pytest.mark.asyncio
async def test_setup_cancel_leaves_config(tmp_roan):
    from textual.widgets import Button

    before = config.load_config()["model"]
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        app._open_setup()
        await pilot.pause()
        app.screen.query_one("#cancel", Button).press()
        await pilot.pause()
        assert config.load_config()["model"] == before


def test_history_input_dedup_and_navigate():
    from roan.tui import HistoryInput

    inp = HistoryInput()
    inp.add_history("een")
    inp.add_history("twee")
    inp.add_history("twee")  # duplicaat niet nog eens
    assert inp._history == ["een", "twee"]


@pytest.mark.asyncio
async def test_input_history_arrow_up(tmp_roan):
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        await pilot.press(*"eerste", "enter")
        await pilot.pause()
        await pilot.pause()
        inp = app.query_one("#input")
        await pilot.press("up")
        await pilot.pause()
        assert inp.value == "eerste"


@pytest.mark.asyncio
async def test_action_new_session(tmp_roan):
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        old = app.agent.session_id
        app.action_new_session()
        await pilot.pause()
        assert app.agent.session_id != old


@pytest.mark.asyncio
async def test_action_clear_chat(tmp_roan):
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        app._sysline("iets")
        await pilot.pause()
        assert len(app.query("#messages > *")) > 0
        app.action_clear_chat()
        await pilot.pause()
        assert len(app.query("#messages > *")) == 0
