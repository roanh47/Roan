"""Minimale MCP-client (Model Context Protocol) over stdio.

Leest servers uit ~/.roan/mcp.json:

    {
      "servers": {
        "filesystem": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]}
      }
    }

Tools van een server worden beschikbaar als `<server>__<tool>`.
"""

from __future__ import annotations

import json
import os
import subprocess
import threading
from pathlib import Path

from .config import ROAN_DIR

MCP_CONFIG_PATH = ROAN_DIR / "mcp.json"
PROTOCOL_VERSION = "2024-11-05"


class MCPError(Exception):
    pass


class MCPClient:
    """Eén MCP-server via stdio."""

    def __init__(self, name: str, command: str, args: list[str] | None = None, env: dict | None = None):
        self.name = name
        self.command = command
        self.args = args or []
        self.env = {**os.environ, **(env or {})}
        self.proc: subprocess.Popen | None = None
        self._id = 0
        self._lock = threading.Lock()
        self.tools: list[dict] = []

    # ---------- transport ----------
    def start(self) -> None:
        self.proc = subprocess.Popen(
            [self.command, *self.args],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            bufsize=1,
            env=self.env,
        )

    def _next_id(self) -> int:
        self._id += 1
        return self._id

    def _send(self, payload: dict) -> None:
        if not self.proc or not self.proc.stdin:
            raise MCPError("server niet gestart")
        self.proc.stdin.write(json.dumps(payload) + "\n")
        self.proc.stdin.flush()

    def _read_response(self, want_id: int) -> dict:
        """Lees regels tot we het antwoord met het juiste id hebben."""
        assert self.proc and self.proc.stdout
        for _ in range(200):
            line = self.proc.stdout.readline()
            if not line:
                raise MCPError("server stopte met antwoorden")
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            if msg.get("id") == want_id:
                if "error" in msg:
                    raise MCPError(str(msg["error"]))
                return msg.get("result", {})
        raise MCPError("geen antwoord ontvangen")

    def request(self, method: str, params: dict | None = None) -> dict:
        with self._lock:
            req_id = self._next_id()
            self._send({"jsonrpc": "2.0", "id": req_id, "method": method, "params": params or {}})
            return self._read_response(req_id)

    def notify(self, method: str, params: dict | None = None) -> None:
        with self._lock:
            self._send({"jsonrpc": "2.0", "method": method, "params": params or {}})

    # ---------- protocol ----------
    def initialize(self) -> None:
        self.start()
        self.request(
            "initialize",
            {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "roan", "version": "0.2"},
            },
        )
        self.notify("notifications/initialized")
        self.tools = self.list_tools()

    def list_tools(self) -> list[dict]:
        result = self.request("tools/list")
        tools = result.get("tools", [])
        return tools if isinstance(tools, list) else []

    def call_tool(self, tool: str, arguments: dict) -> str:
        result = self.request("tools/call", {"name": tool, "arguments": arguments})
        if isinstance(result, dict) and result.get("content"):
            parts = []
            for item in result["content"]:
                if isinstance(item, dict) and item.get("type") == "text":
                    parts.append(item.get("text", ""))
                else:
                    parts.append(json.dumps(item))
            return "\n".join(parts)
        return json.dumps(result)

    def stop(self) -> None:
        if self.proc and self.proc.poll() is None:
            try:
                self.proc.terminate()
                self.proc.wait(timeout=3)
            except Exception:
                try:
                    self.proc.kill()
                except Exception:
                    pass


# ---------- config + manager ----------
def load_mcp_config() -> dict:
    if not MCP_CONFIG_PATH.exists():
        return {}
    try:
        return json.loads(MCP_CONFIG_PATH.read_text()).get("servers", {})
    except (json.JSONDecodeError, OSError):
        return {}


def tool_schema(server: str, tool: dict) -> dict:
    return {
        "type": "function",
        "function": {
            "name": f"{server}__{tool.get('name', 'tool')}",
            "description": tool.get("description", "") or f"MCP tool {tool.get('name')} op {server}",
            "parameters": tool.get("inputSchema") or {"type": "object", "properties": {}},
        },
    }


class MCPManager:
    """Start alle geconfigureerde MCP-servers en bundelt hun tools."""

    def __init__(self, config: dict | None = None):
        self.config = config if config is not None else load_mcp_config()
        self.clients: dict[str, MCPClient] = {}
        self.tool_schemas: list[dict] = []
        self.routes: dict[str, tuple[MCPClient, str]] = {}

    def start_all(self) -> None:
        for name, spec in self.config.items():
            command = spec.get("command")
            if not command:
                continue
            client = MCPClient(name, command, spec.get("args"), spec.get("env"))
            try:
                client.initialize()
            except Exception:
                client.stop()
                continue
            self.clients[name] = client
            for tool in client.tools:
                schema = tool_schema(name, tool)
                self.tool_schemas.append(schema)
                self.routes[schema["function"]["name"]] = (client, tool.get("name", "tool"))

    def handle(self, name: str, arguments: dict) -> str:
        route = self.routes.get(name)
        if not route:
            return f"Onbekende MCP-tool: {name}"
        client, tool_name = route
        try:
            return client.call_tool(tool_name, arguments)
        except Exception as e:
            return f"MCP-fout ({name}): {e}"

    def stop_all(self) -> None:
        for client in self.clients.values():
            client.stop()
        self.clients.clear()
        self.tool_schemas.clear()
        self.routes.clear()
