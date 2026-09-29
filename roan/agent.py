"""De Roan agent: OpenAI-compatibele chat-loop met tools, streaming en sessies."""

from __future__ import annotations

import json
import time
from pathlib import Path

from openai import OpenAI

from .config import ROAN_DIR, load_config, load_instructions
from .memory import load_memory, remember
from .mcp import MCPManager
from . import tools as T

MAX_TOOL_ROUNDS = 12
SESSIONS_DIR = ROAN_DIR / "sessions"

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "run_shell",
            "description": "Voer een shell-commando uit en geef de output terug.",
            "parameters": {
                "type": "object",
                "properties": {"command": {"type": "string", "description": "Het commando."}},
                "required": ["command"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Lees de inhoud van een bestand.",
            "parameters": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Schrijf content naar een bestand (overschrijft).",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string"}, "content": {"type": "string"}},
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "edit_file",
            "description": "Vervang de eerste voorkoming van een stuk tekst in een bestand.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "old": {"type": "string"},
                    "new": {"type": "string"},
                },
                "required": ["path", "old", "new"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_files",
            "description": "Toon de inhoud van een map.",
            "parameters": {"type": "object", "properties": {"path": {"type": "string"}}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "glob_files",
            "description": "Zoek bestanden met een glob-patroon, bijv. **/*.py.",
            "parameters": {"type": "object", "properties": {"pattern": {"type": "string"}}, "required": ["pattern"]},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fetch_url",
            "description": "Haal een URL op en geef de leesbare tekst terug.",
            "parameters": {"type": "object", "properties": {"url": {"type": "string"}}, "required": ["url"]},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Zoek op het web (DuckDuckGo) en geef titel + url terug.",
            "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "todo_write",
            "description": (
                "Zet een takenlijst voor meerstaps-werk. items_json is een JSON-array "
                'van {"text": "...", "done": false}.'
            ),
            "parameters": {
                "type": "object",
                "properties": {"items_json": {"type": "string"}},
                "required": ["items_json"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "remember",
            "description": "Bewaar een duurzame notitie in het geheugen voor volgende sessies.",
            "parameters": {"type": "object", "properties": {"note": {"type": "string"}}, "required": ["note"]},
        },
    },
]

TOOL_FUNCS = {
    "run_shell": T.run_shell,
    "read_file": T.read_file,
    "write_file": T.write_file,
    "edit_file": T.edit_file,
    "list_files": T.list_files,
    "glob_files": T.glob_files,
    "fetch_url": T.fetch_url,
    "web_search": T.web_search,
    "todo_write": T.todo_write,
    "remember": remember,
}


def _build_system_prompt() -> str:
    system = load_instructions()
    memory = load_memory()
    if memory.strip():
        system += f"\n\n[Geheugen uit eerdere sessies]\n{memory}"
    return system


class Agent:
    def __init__(self, session_id: str | None = None, restore: bool = True, use_mcp: bool = True):
        self.session_id = session_id or time.strftime("%Y%m%d-%H%M%S")
        self.reload()
        self.messages: list[dict] = [{"role": "system", "content": _build_system_prompt()}]
        self.mcp = MCPManager()
        if use_mcp:
            try:
                self.mcp.start_all()
            except Exception:
                pass
        if restore:
            self._restore()

    @property
    def tools(self) -> list[dict]:
        return TOOLS + self.mcp.tool_schemas

    # ---------- config ----------
    def reload(self) -> None:
        cfg = load_config()
        self.model = cfg["model"]
        self.provider = cfg["provider"]
        self.client = OpenAI(base_url=cfg["base_url"], api_key=cfg["api_key"] or "sk-none")

    # ---------- sessies ----------
    @property
    def _session_path(self) -> Path:
        return SESSIONS_DIR / f"{self.session_id}.json"

    def _restore(self) -> None:
        if not self._session_path.exists():
            return
        try:
            data = json.loads(self._session_path.read_text())
            if isinstance(data.get("messages"), list) and data["messages"]:
                self.messages.extend(data["messages"])
        except (json.JSONDecodeError, OSError):
            pass

    def save(self) -> None:
        SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
        try:
            self._session_path.write_text(
                json.dumps({"id": self.session_id, "messages": self.messages[1:]}, indent=2)
            )
        except OSError:
            pass

    def clear(self) -> None:
        self.messages = [{"role": "system", "content": _build_system_prompt()}]
        self.save()

    # ---------- tools ----------
    def _run_tool(self, name: str, args: dict) -> str:
        if name in self.mcp.routes:
            return self.mcp.handle(name, args)
        func = TOOL_FUNCS.get(name)
        if not func:
            return f"Onbekende tool: {name}"
        try:
            return str(func(**args))
        except Exception as e:
            return f"Error: {e}"

    def stop(self) -> None:
        self.mcp.stop_all()

    @staticmethod
    def _dump_tool_call(tc) -> dict:
        if hasattr(tc, "model_dump"):
            return tc.model_dump()
        return {
            "id": getattr(tc, "id", "") or "",
            "type": "function",
            "function": {
                "name": tc.function.name,
                "arguments": tc.function.arguments or "{}",
            },
        }

    def _assistant_msg(self, content, tool_calls) -> dict:
        msg: dict = {"role": "assistant", "content": content or ""}
        if tool_calls:
            msg["tool_calls"] = tool_calls
        return msg

    # ---------- chat ----------
    def send(self, user_text: str, on_event=None) -> str:
        self.messages.append({"role": "user", "content": user_text})
        for _ in range(MAX_TOOL_ROUNDS):
            resp = self.client.chat.completions.create(
                model=self.model, messages=self.messages, tools=self.tools, tool_choice="auto"
            )
            msg = resp.choices[0].message
            if msg.tool_calls:
                self.messages.append(
                    self._assistant_msg(msg.content, [self._dump_tool_call(tc) for tc in msg.tool_calls])
                )
                for tc in msg.tool_calls:
                    args = json.loads(tc.function.arguments or "{}")
                    if on_event:
                        on_event({"type": "tool_call", "name": tc.function.name, "arguments": args})
                    result = self._run_tool(tc.function.name, args)
                    if on_event:
                        on_event({"type": "tool_result", "name": tc.function.name, "result": result})
                    self.messages.append({"role": "tool", "tool_call_id": tc.id, "content": result})
                continue
            content = msg.content or ""
            self.messages.append(self._assistant_msg(content, None))
            self.save()
            return content

        self.save()
        return "(maximale aantal tool-rondes bereikt)"

    def send_stream(self, user_text: str, on_event=None):
        """Yield content-deltas terwijl het model antwoordt. Voert tools uit tussendoor."""
        self.messages.append({"role": "user", "content": user_text})
        for _ in range(MAX_TOOL_ROUNDS):
            stream = self.client.chat.completions.create(
                model=self.model, messages=self.messages, tools=self.tools, tool_choice="auto", stream=True
            )
            content_parts: list[str] = []
            tool_calls: dict[int, dict] = {}

            for chunk in stream:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                if delta.content:
                    content_parts.append(delta.content)
                    yield delta.content
                for tc in delta.tool_calls or []:
                    slot = tool_calls.setdefault(tc.index, {"id": "", "name": "", "arguments": ""})
                    if tc.id:
                        slot["id"] = tc.id
                    if tc.function:
                        if tc.function.name:
                            slot["name"] = tc.function.name
                        if tc.function.arguments:
                            slot["arguments"] += tc.function.arguments

            content = "".join(content_parts)

            if not tool_calls:
                self.messages.append(self._assistant_msg(content, None))
                self.save()
                return

            dumped = [
                {
                    "id": tc["id"] or f"call_{i}",
                    "type": "function",
                    "function": {"name": tc["name"], "arguments": tc["arguments"] or "{}"},
                }
                for i, tc in tool_calls.items()
            ]
            self.messages.append(self._assistant_msg(content, dumped))
            for tc in dumped:
                try:
                    args = json.loads(tc["function"]["arguments"] or "{}")
                except json.JSONDecodeError:
                    args = {}
                if on_event:
                    on_event({"type": "tool_call", "name": tc["function"]["name"], "arguments": args})
                result = self._run_tool(tc["function"]["name"], args)
                if on_event:
                    on_event({"type": "tool_result", "name": tc["function"]["name"], "result": result})
                self.messages.append(
                    {"role": "tool", "tool_call_id": tc["id"], "content": result}
                )
            yield "\n"
        self.save()
