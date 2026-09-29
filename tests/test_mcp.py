"""Tests voor de MCP-client tegen een fake stdio-server."""

import sys
from pathlib import Path

import pytest

from roan import mcp

FAKE = str(Path(__file__).parent / "fake_mcp_server.py")


def test_client_initialize_and_list():
    client = mcp.MCPClient("fake", sys.executable, [FAKE])
    try:
        client.initialize()
        assert len(client.tools) == 1
        assert client.tools[0]["name"] == "echo"
    finally:
        client.stop()


def test_client_call_tool():
    client = mcp.MCPClient("fake", sys.executable, [FAKE])
    try:
        client.initialize()
        out = client.call_tool("echo", {"text": "hoi"})
        assert out == "echo:hoi"
    finally:
        client.stop()


def test_manager_bundles_tools():
    mgr = mcp.MCPManager({"fake": {"command": sys.executable, "args": [FAKE]}})
    try:
        mgr.start_all()
        names = [t["function"]["name"] for t in mgr.tool_schemas]
        assert names == ["fake__echo"]
        assert mgr.handle("fake__echo", {"text": "x"}) == "echo:x"
    finally:
        mgr.stop_all()


def test_manager_handles_unknown():
    mgr = mcp.MCPManager({})
    assert "Onbekende MCP-tool" in mgr.handle("nope__x", {})


def test_manager_skips_broken_server():
    mgr = mcp.MCPManager({"broken": {"command": "/nonexistent/binary"}})
    mgr.start_all()  # mag niet crashen
    assert mgr.clients == {}
    mgr.stop_all()


def test_tool_schema_shape():
    schema = mcp.tool_schema("srv", {"name": "t", "description": "d"})
    assert schema["function"]["name"] == "srv__t"
    assert schema["function"]["parameters"]["type"] == "object"


def test_mcp_config_missing(tmp_path, monkeypatch):
    monkeypatch.setattr(mcp, "MCP_CONFIG_PATH", tmp_path / "none.json")
    assert mcp.load_mcp_config() == {}


def test_mcp_config_parses(tmp_path, monkeypatch):
    p = tmp_path / "mcp.json"
    p.write_text('{"servers": {"a": {"command": "x"}}}')
    monkeypatch.setattr(mcp, "MCP_CONFIG_PATH", p)
    assert "a" in mcp.load_mcp_config()
