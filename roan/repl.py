"""Plain-text chat-modus: werkt overal, ook op smalle terminals en telefoons."""

from __future__ import annotations

import sys

from .agent import Agent
from .channels.telegram import handle_command
from .config import has_config, load_config

BANNER = "Roan — agent harness.  /help voor commando's, /quit om te stoppen."

ONBOARD = (
    "Nog geen model geconfigureerd.\n"
    "Draai `Roan init` om een provider + api_key + model in te stellen,\n"
    "of zet ROAN_API_KEY / ROAN_MODEL in je omgeving.\n"
    "Gratis opties: groq, openrouter (models met ':free')."
)


def _print_help(agent: Agent) -> None:
    out = handle_command("/help", agent, lambda: agent)
    print(out or "")


def run_repl(session_id: str | None = None) -> None:
    if not has_config():
        print(BANNER)
        print()
        print(ONBOARD)
        return

    agent = Agent(session_id=session_id)
    cfg = load_config()
    print(BANNER)
    print(f"model: {cfg['model']}  ·  provider: {cfg['provider']}\n")

    while True:
        try:
            line = input("❯ ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break

        if not line:
            continue

        if line.startswith("/"):
            if line[1:].split()[0].lower() in ("quit", "exit", "q"):
                break
            out = handle_command(line, agent, lambda: agent)
            if out is not None:
                print(out)
            continue

        try:
            for delta in agent.send_stream(line):
                sys.stdout.write(delta)
                sys.stdout.flush()
        except KeyboardInterrupt:
            print("\n(afgebroken)")
        except Exception as e:
            msg = str(e)
            print(f"\nFout: {msg}")
            if any(s in msg.lower() for s in ("connection", "connect", "refused", "timeout", "getaddrinfo")):
                print(
                    f"\nKan geen verbinding maken met {cfg.get('base_url')}.\n"
                    "Draai `Roan init` of /provider + /model om dit te wijzigen."
                )
        print()

    agent.stop()
