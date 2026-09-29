"""Tests voor de nieuwe TUI: renderer-keuze, transcript, auto-follow, tool-uitklappen."""

import pytest

from roan import config
from roan.tui import (
    Messages,
    RoanApp,
    ToolResult,
    TranscriptScreen,
    TuiPromptScreen,
)


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


def _isolate(tmp_path, monkeypatch, cfg):
    monkeypatch.setattr(config, "ROAN_DIR", tmp_path)
    monkeypatch.setattr(config, "CONFIG_PATH", tmp_path / "config.json")
    monkeypatch.setattr(config, "MEMORY_PATH", tmp_path / "memory.md")
    monkeypatch.setattr(config, "INSTRUCTIONS_PATH", tmp_path / "instructions.md")
    config.save_config(cfg)
    return tmp_path


@pytest.fixture
def tmp_roan(tmp_path, monkeypatch):
    return _isolate(tmp_path, monkeypatch, {"provider": "lmstudio", "model": "m", "tui": "default"})


@pytest.fixture
def tmp_no_tui(tmp_path, monkeypatch):
    return _isolate(tmp_path, monkeypatch, {"provider": "lmstudio", "model": "m"})


# ---------- renderer-resolutie ----------
def test_renderer_default(tmp_roan):
    assert config.resolve_renderer() == "default"


def test_renderer_from_config(tmp_roan):
    config.save_config({"tui": "fullscreen"})
    assert config.resolve_renderer() == "fullscreen"


def test_renderer_env_wins(tmp_roan, monkeypatch):
    config.save_config({"tui": "fullscreen"})
    monkeypatch.setenv("ROAN_DISABLE_ALTERNATE_SCREEN", "1")
    assert config.resolve_renderer() == "default"


def test_env_no_flicker(tmp_roan, monkeypatch):
    monkeypatch.setenv("ROAN_NO_FLICKER", "1")
    assert config.resolve_renderer() == "fullscreen"


def test_should_offer_fullscreen(tmp_no_tui):
    assert config.should_offer_fullscreen() is True
    config.save_config({"tui_prompts": 3})
    assert config.should_offer_fullscreen() is False


def test_should_not_offer_when_declined(tmp_no_tui):
    config.save_config({"tui_declined": True})
    assert config.should_offer_fullscreen() is False


def test_should_not_offer_when_saved(tmp_roan):
    assert config.should_offer_fullscreen() is False


def test_failure_falls_back_after_two(tmp_roan):
    config.save_config({"tui": "fullscreen"})
    assert config.note_fullscreen_failure() == "fullscreen"  # eerste keer nog niet
    assert config.note_fullscreen_failure() == "default"  # tweede keer -> classic
    assert config.load_config()["tui"] == "default"


def test_success_resets_fail_count(tmp_roan):
    config.save_config({"tui_fails": 1})
    config.note_fullscreen_success()
    assert config.load_config()["tui_fails"] == 0


# ---------- /tui ----------
@pytest.mark.asyncio
async def test_cmd_tui_saves_and_relaunches(tmp_roan):
    app = RoanApp(FakeAgent())
    calls = []
    async with app.run_test() as pilot:
        app.exit = lambda result=None: calls.append(result)
        app._cmd_tui(["fullscreen"])
        await pilot.pause()
        assert config.load_config()["tui"] == "fullscreen"
        assert calls == [{"relaunch": "fullscreen"}]


@pytest.mark.asyncio
async def test_cmd_tui_no_arg_reports(tmp_roan):
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        await pilot.pause()
        app._cmd_tui([])
        await pilot.pause()
        rendered = " ".join(str(w.render()) for w in app.query("Static"))
        assert "default" in rendered


@pytest.mark.asyncio
async def test_cmd_tui_invalid(tmp_roan):
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        await pilot.pause()
        assert config.load_config().get("tui") == "default"
        app._cmd_tui(["bogus"])
        await pilot.pause()
        assert config.load_config()["tui"] == "default"


# ---------- startup-dialoog ----------
@pytest.mark.asyncio
async def test_fullscreen_prompt_appears(tmp_no_tui):
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        await pilot.pause()
        assert isinstance(app.screen, TuiPromptScreen)
        assert config.load_config()["tui_prompts"] == 1


@pytest.mark.asyncio
async def test_fullscreen_prompt_declined(tmp_no_tui):
    from textual.widgets import Button

    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        await pilot.pause()
        app.screen.query_one("#notnow", Button).press()
        await pilot.pause()
        assert config.load_config()["tui_declined"] is True
        assert config.load_config().get("tui") is None


@pytest.mark.asyncio
async def test_fullscreen_prompt_accepted(tmp_no_tui):
    from textual.widgets import Button

    app = RoanApp(FakeAgent())
    exits = []
    async with app.run_test() as pilot:
        await pilot.pause()
        app.exit = lambda result=None: exits.append(result)
        app.screen.query_one("#yes", Button).press()
        await pilot.pause()
        assert config.load_config()["tui"] == "fullscreen"
        assert exits == [{"relaunch": "fullscreen"}]


@pytest.mark.asyncio
async def test_no_prompt_when_tui_set(tmp_roan):
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        await pilot.pause()
        assert not isinstance(app.screen, TuiPromptScreen)


# ---------- transcript ----------
@pytest.mark.asyncio
async def test_transcript_renders_messages(tmp_roan):
    agent = FakeAgent()
    agent.messages = [
        {"role": "system", "content": "sys"},
        {"role": "user", "content": "hallo wereld"},
        {"role": "assistant", "content": "antwoord hier"},
        {"role": "tool", "content": "tool output"},
    ]
    app = RoanApp(agent)
    async with app.run_test() as pilot:
        await pilot.pause()
        app.action_transcript()
        await pilot.pause()
        assert isinstance(app.screen, TranscriptScreen)
        screen = app.screen
        assert len(screen._widgets) == 3  # system wordt overgeslagen
        await pilot.press("escape")
        await pilot.pause()
        assert not isinstance(app.screen, TranscriptScreen)


@pytest.mark.asyncio
async def test_transcript_search_matches(tmp_roan):
    from textual.widgets import Input

    agent = FakeAgent()
    agent.messages = [
        {"role": "user", "content": "hallo wereld"},
        {"role": "assistant", "content": "iets anders"},
    ]
    app = RoanApp(agent)
    async with app.run_test() as pilot:
        await pilot.pause()
        app.action_transcript()
        await pilot.pause()
        screen = app.screen
        screen.query_one("#tsearch", Input).value = "hallo"
        await pilot.pause()
        assert screen.matches == [0]
        screen.query_one("#tsearch", Input).value = "zzz"
        await pilot.pause()
        assert screen.matches == []


@pytest.mark.asyncio
async def test_transcript_navigation_no_match_is_safe(tmp_roan):
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        await pilot.pause()
        app.action_transcript()
        await pilot.pause()
        screen = app.screen
        screen.action_next_match()  # geen matches -> mag niet crashen
        screen.action_prev_match()
        screen.action_top()
        screen.action_bottom()


# ---------- auto-follow ----------
@pytest.mark.asyncio
async def test_jump_indicator_shows_and_clears(tmp_roan):
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        await pilot.pause()
        app._new_since_scroll = 3
        app._update_jump()
        await pilot.pause()
        jump = app.query_one("#jump")
        assert jump.display is True
        assert "3" in str(jump.render())

        app.action_scroll_bottom()
        await pilot.pause()
        assert jump.display is False


@pytest.mark.asyncio
async def test_write_follows_when_at_bottom(tmp_roan):
    from textual.widgets import Static

    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        await pilot.pause()
        app._write(Static("nieuw bericht"))
        await pilot.pause()
        assert app._new_since_scroll == 0
        assert app.query_one("#jump").display is False


# ---------- tool-resultaat uitklappen ----------
@pytest.mark.asyncio
async def test_tool_result_toggle(tmp_roan):
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        widget = ToolResult("run_shell", "regel1\nregel2\nregel3")
        app._write(widget)
        await pilot.pause()
        assert widget.expanded is False
        assert "+2 regels" in str(widget.render())
        widget.on_click()
        assert widget.expanded is True
        assert "regel2" in str(widget.render())
        widget.on_click()
        assert widget.expanded is False


def test_tool_result_error_marker():
    widget = ToolResult("run_shell", "Error: kapot")
    assert "✗" in str(widget.render())


# ---------- scroll-snelheid ----------
def test_messages_scroll_speed_reads_config(tmp_roan):
    config.save_config({"scroll_speed": 3})
    msgs = Messages()
    assert msgs._speed() == 3.0


def test_messages_scroll_speed_bad_value(tmp_roan):
    config.save_config({"scroll_speed": "snel"})
    msgs = Messages()
    assert msgs._speed() == 1.0


@pytest.mark.asyncio
async def test_scroll_actions_do_not_crash(tmp_roan):
    app = RoanApp(FakeAgent())
    async with app.run_test() as pilot:
        await pilot.pause()
        app.action_scroll_top()
        app.action_scroll_bottom()
        app.action_page_up()
        app.action_page_down()
        await pilot.pause()
