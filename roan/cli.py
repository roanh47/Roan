import sys

HELP = """Roan — agent harness

Usage: roan [command]

Commands:
  (none)      Start the TUI (falls back to chat mode without a TTY)
  chat        Plain-text chat mode (works on any terminal)
  init        Interactive setup: provider, api_key, model, telegram token
  telegram    Run the agent as a Telegram bot
  update      Update to the latest version for this channel
  version     Show the version
  help        Show this message
"""


def main() -> None:
    args = sys.argv[1:]

    if args and args[0] in ("help", "--help", "-h"):
        print(HELP)
        return

    if args and args[0] == "update":
        from .update import update

        update()
        return

    if args and args[0] == "init":
        from .init_cmd import run_init

        run_init()
        return

    if args and args[0] == "chat":
        from .repl import run_repl

        run_repl(session_id=args[1] if len(args) > 1 else None)
        return

    if args and args[0] == "telegram":
        from .channels.telegram import run_telegram

        run_telegram()
        return

    if args and args[0] in ("--version", "-v", "version"):
        from importlib.metadata import version

        try:
            print(f"roan {version('roan')}")
        except Exception:
            from . import __version__

            print(f"roan {__version__}")
        return

    # Geen/nooit TTY (ssh-zonder-tty, pipe, telefoon) -> plain chat.
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        from .repl import run_repl

        run_repl()
        return

    from .tui import run_tui

    run_tui()


if __name__ == "__main__":
    main()
