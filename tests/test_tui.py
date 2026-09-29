"""TUI-tests via Textual's headless pilot (geen netwerk)."""

import pytest

from roan import config
from roan.tui import RoanApp


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

    def send_stream(self, text):
        self.sent.append(text)
        yield f"echo: {text}"


@pytest.fixture
def tmp_roan(tmp_path, monkeypatch):
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
