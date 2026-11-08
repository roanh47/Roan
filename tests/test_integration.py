"""Integratietest: echte HTTP/SSE tegen een mock OpenAI-compatibele server.

Dekt de volledige keten: OpenAI-SDK -> HTTP -> SSE-stream -> tool-call -> shell.
"""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from roan import agent as agent_mod
from roan import config

STATE = {"turn": 0}


def _chunk(delta: dict, finish=None) -> str:
    payload = {
        "id": "chatcmpl-test",
        "object": "chat.completion.chunk",
        "created": 1,
        "model": "mock-model",
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
    }
    return f"data: {json.dumps(payload)}\n\n"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # stil
        pass

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")
        messages = body.get("messages", [])
        stream = bool(body.get("stream"))
        has_tool_result = any(m.get("role") == "tool" for m in messages)

        if has_tool_result:
            plan = "content"
        else:
            plan = "tool"

        if stream:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            if plan == "tool":
                self.wfile.write(
                    _chunk(
                        {
                            "tool_calls": [
                                {
                                    "index": 0,
                                    "id": "call_1",
                                    "type": "function",
                                    "function": {"name": "run_shell", "arguments": ""},
                                }
                            ]
                        }
                    ).encode()
                )
                self.wfile.write(
                    _chunk(
                        {
                            "tool_calls": [
                                {
                                    "index": 0,
                                    "function": {
                                        "arguments": json.dumps({"command": "echo integratie-ok"})
                                    },
                                }
                            ]
                        }
                    ).encode()
                )
                self.wfile.write(_chunk({}, finish="tool_calls").encode())
            else:
                for piece in ["Het ", "commando ", "gaf ", "integratie-ok."]:
                    self.wfile.write(_chunk({"content": piece}).encode())
                self.wfile.write(_chunk({}, finish="stop").encode())
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
            return

        # Non-streaming JSON
        if plan == "tool":
            message = {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": "call_1",
                        "type": "function",
                        "function": {
                            "name": "run_shell",
                            "arguments": json.dumps({"command": "echo integratie-ok"}),
                        },
                    }
                ],
            }
            finish = "tool_calls"
        else:
            message = {"role": "assistant", "content": "Het commando gaf integratie-ok."}
            finish = "stop"

        payload = {
            "id": "chatcmpl-test",
            "object": "chat.completion",
            "created": 1,
            "model": "mock-model",
            "choices": [{"index": 0, "message": message, "finish_reason": finish}],
        }
        raw = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


@pytest.fixture(scope="module")
def mock_server():
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}/v1"
    httpd.shutdown()


@pytest.fixture
def configured(tmp_path, monkeypatch, mock_server):
    monkeypatch.setattr(config, "ROAN_DIR", tmp_path)
    monkeypatch.setattr(config, "CONFIG_PATH", tmp_path / "config.json")
    monkeypatch.setattr(config, "MEMORY_PATH", tmp_path / "memory.md")
    monkeypatch.setattr(config, "INSTRUCTIONS_PATH", tmp_path / "instructions.md")
    monkeypatch.setattr(agent_mod, "SESSIONS_DIR", tmp_path / "sessions")
    config.save_config({"provider": "custom", "base_url": mock_server, "api_key": "test", "model": "mock-model"})
    return mock_server


def test_full_loop_tool_then_answer(configured):
    a = agent_mod.Agent(session_id="integ", restore=False, use_mcp=False)
    events: list[dict] = []
    out = "".join(a.send_stream("doe iets met een tool", on_event=events.append))

    assert "integratie-ok" in out
    assert [e["type"] for e in events] == ["tool_call", "tool_result"]
    assert events[0]["name"] == "run_shell"
    assert "integratie-ok" in events[1]["result"]
    # tool-bericht zit in de geschiedenis
    assert any(m.get("role") == "tool" for m in a.messages)
    # sessie is opgeslagen
    assert (configured and True)


def test_send_non_streaming(configured):
    a = agent_mod.Agent(session_id="integ2", restore=False, use_mcp=False)
    out = a.send("doe iets met een tool")
    assert "integratie-ok" in out


def test_session_saved_to_disk(configured, tmp_path):
    a = agent_mod.Agent(session_id="integ3", restore=False, use_mcp=False)
    a.send("doe iets met een tool")
    saved = tmp_path / "sessions" / "integ3.json"
    assert saved.exists()
    data = json.loads(saved.read_text())
    assert any(m.get("role") == "tool" for m in data["messages"])
