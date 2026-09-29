import sys

HELP_COMMANDS = ("help", "--help", "-h")


def main() -> None:
    from .home import ensure_home
    from .i18n import init_from_config, t

    init_from_config()
    ensure_home()
    args = sys.argv[1:]

    if args and args[0] in HELP_COMMANDS:
        print(t("cli_help"))
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

    if args and args[0] == "cron":
        from .cron import run_forever

        run_forever()
        return

    if args and args[0] == "home":
        from .config import ROAN_DIR
        from .home import layout

        print(f"{ROAN_DIR}/")
        for name, entries in layout().items():
            print(f"  {name}/  ({len(entries)} items)")
            for entry in entries[:10]:
                print(f"    {entry}")
        return

    if args and args[0] in ("--version", "-v", "version"):
        from importlib.metadata import version

        try:
            print(f"Roan {version('roan')}")
        except Exception:
            from . import __version__

            print(f"Roan {__version__}")
        return

    # Altijd de TUI.
    from .tui import run_tui

    run_tui()


if __name__ == "__main__":
    main()
