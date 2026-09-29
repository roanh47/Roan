from .config import MEMORY_PATH


def load_memory() -> str:
    if MEMORY_PATH.exists():
        return MEMORY_PATH.read_text()
    return ""


def remember(note: str) -> str:
    MEMORY_PATH.parent.mkdir(parents=True, exist_ok=True)
    with MEMORY_PATH.open("a", encoding="utf-8") as f:
        f.write(note.rstrip() + "\n")
    return "Onthouden."