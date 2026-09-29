"""Plain-text chat-modus: werkt overal, ook op smalle terminals en telefoons."""

from __future__ import annotations

import sys

from .agent import Agent
from .channels.telegram import handle_command
from .config import has_config, load_config
from .i18n import init_from_config, t


def _print_help(agent: Agent) -> None:
    out = handle_command("/help", agent, lambda: agent)
    print(out or "")


def run_repl(session_id: str | None = None) -> None:
    from .home import ensure_home

    ensure_home()
    init_from_config()
    if not has_config():
        print(t("repl_banner"))
        print()
        print(t("repl_onboard"))
        return

    agent = Agent(session_id=session_id)
    cfg = load_config()
    print(t("repl_banner"))
    print(t("repl_model_line", model=cfg["model"], provider=cfg["provider"]) + "\n")

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
            print("\n" + t("msg_aborted"))
        except Exception as e:
            msg = str(e)
            print("\n" + t("msg_error", error=msg))
            if any(s in msg.lower() for s in ("connection", "connect", "refused", "timeout", "getaddrinfo")):
                print("\n" + t("repl_conn_error", url=cfg.get("base_url")))
                print(t("repl_conn_hint"))
        print()

    agent.stop()
