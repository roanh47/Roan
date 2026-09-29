"""Agent-tests: chat-loop, tools, streaming (met een nep OpenAI-client)."""

from types import SimpleNamespace

import pytest

from roan import agent as agent_mod
from roan import config


@pytest.fixture
def tmp_roan(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "ROAN_DIR", tmp_path)
    monkeypatch.setattr(config, "CONFIG_PATH", tmp_path / "config.json")
    monkeypatch.setattr(config, "MEMORY_PATH", tmp_path / "memory.md")
    monkeypatch.setattr(config, "INSTRUCTIONS_PATH", tmp_path / "instructions.md")
    monkeypatch.setattr(agent_mod, "SESSIONS_DIR", tmp_path / "sessions")
    return tmp_path


def _msg(content=None, tool_calls=None):
    return SimpleNamespace(content=content, tool_calls=tool_calls)


def _resp(content=None, tool_calls=None):
    return SimpleNamespace(choices=[SimpleNamespace(message=_msg(content, tool_calls))])


def _tool_call(idx, name, arguments, call_id="call_1"):
    return SimpleNamespace(
        id=call_id,
        index=idx,
        function=SimpleNamespace(name=name, arguments=arguments),
    )


class FakeClient:
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = 0
        self.chat = SimpleNamespace(completions=self)

    def create(self, **kwargs):
        r = self._responses[self.calls]
        self.calls += 1
        return r


def make_agent(responses):
    a = agent_mod.Agent(session_id="t", restore=False)
    a.client = FakeClient(responses)
    return a


def test_send_plain(tmp_roan):
    a = make_agent([_resp(content="hoi")])
    assert a.send("hi") == "hoi"
    assert a.messages[-1]["role"] == "assistant"


def test_send_runs_tool(tmp_roan):
    tool = _tool_call(0, "run_shell", '{"command": "echo roan-test"}')
    a = make_agent([_resp(tool_calls=[tool]), _resp(content="klaar")])
    assert a.send("run het") == "klaar"
    tool_msgs = [m for m in a.messages if m["role"] == "tool"]
    assert tool_msgs and "roan-test" in tool_msgs[0]["content"]


def test_send_unknown_tool(tmp_roan):
    tool = _tool_call(0, "nope", "{}")
    a = make_agent([_resp(tool_calls=[tool]), _resp(content="ok")])
    a.send("x")
    tool_msgs = [m for m in a.messages if m["role"] == "tool"]
    assert "Onbekende tool" in tool_msgs[0]["content"]


def test_session_saved_and_restored(tmp_roan):
    a = make_agent([_resp(content="bewaard")])
    a.send("hi")
    path = tmp_roan / "sessions" / "t.json"
    assert path.exists()

    b = agent_mod.Agent(session_id="t", restore=True)
    assert any(m.get("content") == "bewaard" for m in b.messages)


def test_clear_resets_history(tmp_roan):
    a = make_agent([_resp(content="x")])
    a.send("hi")
    assert len(a.messages) > 1
    a.clear()
    assert len(a.messages) == 1
    assert a.messages[0]["role"] == "system"


# ---------- streaming ----------
def _chunk(content=None, tool_calls=None):
    return SimpleNamespace(choices=[SimpleNamespace(delta=_msg(content, tool_calls))])


def test_send_stream_plain(tmp_roan):
    a = make_agent([[ _chunk("hoi"), _chunk(" daar") ]])
    assert "".join(a.send_stream("hi")) == "hoi daar"


def test_send_stream_tool_then_text(tmp_roan):
    tool = _tool_call(0, "run_shell", '{"command": "echo stream-test"}')
    a = make_agent([[ _chunk(tool_calls=[tool]) ], [ _chunk("klaar") ]])
    out = "".join(a.send_stream("doe"))
    assert "klaar" in out
    tool_msgs = [m for m in a.messages if m["role"] == "tool"]
    assert "stream-test" in tool_msgs[0]["content"]


def test_tools_registered():
    for name in ("run_shell", "read_file", "write_file", "edit_file", "glob_files",
                 "fetch_url", "web_search", "remember", "list_files"):
        assert name in agent_mod.TOOL_FUNCS
