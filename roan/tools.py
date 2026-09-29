import subprocess
from pathlib import Path


def run_shell(command: str) -> str:
    try:
        r = subprocess.run(command, shell=True, capture_output=True, text=True, timeout=120)
        out = (r.stdout or "").rstrip()
        err = (r.stderr or "").rstrip()
        parts = []
        if out:
            parts.append(out)
        if err:
            parts.append(f"[stderr]\n{err}")
        if not parts:
            parts.append(f"(exit code {r.returncode}, no output)")
        return "\n".join(parts)
    except subprocess.TimeoutExpired:
        return "Error: command timed out (120s)."
    except Exception as e:
        return f"Error: {e}"


def read_file(path: str) -> str:
    try:
        return Path(path).expanduser().read_text(encoding="utf-8", errors="replace")
    except Exception as e:
        return f"Error reading {path}: {e}"


def write_file(path: str, content: str) -> str:
    try:
        p = Path(path).expanduser()
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
        return f"Wrote {path}."
    except Exception as e:
        return f"Error writing {path}: {e}"