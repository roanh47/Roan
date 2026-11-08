import sys


def main() -> None:
    args = sys.argv[1:]

    if args and args[0] == "update":
        from .update import update

        update()
        return

    if args and args[0] in ("--version", "-v", "version"):
        from . import __version__

        print(f"roan {__version__}")
        return

    from .tui import run_tui

    run_tui()


if __name__ == "__main__":
    main()
