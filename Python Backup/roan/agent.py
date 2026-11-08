import json

from openai import OpenAI

from .config import load_config, load_instructions
from .memory import load_memory, remember
from .tools import run_shell, read_file, write_file

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
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string"}},
                "required": ["path"],
            },
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
            "name": "remember",
            "description": "Bewaar een duurzame notitie in het geheugen voor volgende sessies.",
            "parameters": {
                "type": "object",
                "properties": {"note": {"type": "string"}},
                "required": ["note"],
            },
        },
    },
]

TOOL_FUNCS = {
    "run_shell": run_shell,
    "read_file": read_file,
    "write_file": write_file,
    "remember": remember,
}


class Agent:
    def __init__(self):
        cfg = load_config()
        self.model = cfg["model"]
        self.client = OpenAI(base_url=cfg["base_url"], api_key=cfg["api_key"] or "sk-none")

        system = load_instructions()
        memory = load_memory()
        if memory.strip():
            system += f"\n\n[Geheugen uit eerdere sessies]\n{memory}"

        self.messages = [{"role": "system", "content": system}]

    def send(self, user_text: str) -> str:
        self.messages.append({"role": "user", "content": user_text})

        while True:
            resp = self.client.chat.completions.create(
                model=self.model,
                messages=self.messages,
                tools=TOOLS,
                tool_choice="auto",
            )
            msg = resp.choices[0].message

            if msg.tool_calls:
                self.messages.append(
                    {
                        "role": "assistant",
                        "content": msg.content,
                        "tool_calls": [tc.model_dump() for tc in msg.tool_calls],
                    }
                )
                for tc in msg.tool_calls:
                    name = tc.function.name
                    args = json.loads(tc.function.arguments or "{}")
                    func = TOOL_FUNCS.get(name)
                    try:
                        result = func(**args) if func else f"Onbekende tool: {name}"
                    except Exception as e:
                        result = f"Error: {e}"
                    self.messages.append(
                        {"role": "tool", "tool_call_id": tc.id, "content": str(result)}
                    )
                continue

            content = msg.content or ""
            self.messages.append({"role": "assistant", "content": content})
            return content
