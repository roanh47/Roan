import json

from openai import OpenAI
from rich.console import Console
from rich.markdown import Markdown

from .config import load_config, load_instructions
from .memory import load_memory, remember
from .tools import run_shell, read_file, write_file

console = Console()

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
                "properties": {
                    "path": {"type": "string"},
                    "content": {"type": "string"},
                },
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


def main() -> None:
    cfg = load_config()

    system = load_instructions()
    memory = load_memory()
    if memory.strip():
        system += f"\n\n[Geheugen uit eerdere sessies]\n{memory}"

    client = OpenAI(base_url=cfg["base_url"], api_key=cfg["api_key"] or "sk-none")
    messages = [{"role": "system", "content": system}]

    console.print(f"[bold green]Roan[/] · model: [yellow]{cfg['model']}[/]", highlight=False)

    while True:
        try:
            user_input = console.input("[bold cyan]❯ [/]")
        except (EOFError, KeyboardInterrupt):
            console.print("\nTot ziens.")
            break

        text = user_input.strip()
        if text in ("exit", "quit", "/quit", "/exit"):
            break
        if not text:
            continue

        messages.append({"role": "user", "content": user_input})

        while True:
            try:
                resp = client.chat.completions.create(
                    model=cfg["model"],
                    messages=messages,
                    tools=TOOLS,
                    tool_choice="auto",
                )
            except Exception as e:
                console.print(f"[red]Fout: {e}[/]")
                break

            msg = resp.choices[0].message

            if msg.tool_calls:
                messages.append(
                    {
                        "role": "assistant",
                        "content": msg.content,
                        "tool_calls": [tc.model_dump() for tc in msg.tool_calls],
                    }
                )
                for tc in msg.tool_calls:
                    name = tc.function.name
                    args = json.loads(tc.function.arguments or "{}")
                    console.print(f"  [dim]→ {name}{args}[/]")
                    func = TOOL_FUNCS.get(name)
                    try:
                        result = func(**args) if func else f"Onbekende tool: {name}"
                    except Exception as e:
                        result = f"Error: {e}"
                    messages.append(
                        {"role": "tool", "tool_call_id": tc.id, "content": str(result)}
                    )
                continue

            content = msg.content or ""
            messages.append({"role": "assistant", "content": content})
            console.print(Markdown(content))
            break


if __name__ == "__main__":
    main()