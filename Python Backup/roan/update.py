import json
import subprocess
import sys
from importlib import metadata
from pathlib import Path

try:
    from packaging.version import Version
except ImportError:
    Version = None


def _is_prerelease(version: str) -> bool:
    if Version is not None:
        try:
            return Version(version).is_prerelease
        except Exception:
            pass
    return any(s in version.lower() for s in ("rc", "dev", "alpha", "beta", ".a", ".b"))


def _editable_git_repo() -> str | None:
    """Geef het pad terug als roan editable uit een git-clone is geïnstalleerd, anders None."""
    try:
        dist = metadata.distribution("roan")
        raw = dist.read_text("direct_url.json")
        if not raw:
            return None
        info = json.loads(raw)
        if not info.get("dir_info", {}).get("editable"):
            return None
        url = info.get("url", "")
        if url.startswith("file://"):
            return str(Path(url[7:]))
        return None
    except Exception:
        return None


def update() -> None:
    repo = _editable_git_repo()
    if repo and (Path(repo) / ".git").exists():
        print(f"Git clone: {repo} — pull + reinstalleren ...")
        r = subprocess.run(["git", "-C", repo, "pull"])
        if r.returncode == 0:
            subprocess.run([sys.executable, "-m", "pip", "install", "-e", repo])
            return
        print("git pull mislukt, val terug op pip upgrade.")

    # Kanaal-bewust: pre-release → --pre, anders nieuwste stable.
    try:
        current = metadata.version("roan")
    except Exception:
        current = ""

    if _is_prerelease(current):
        print("Pre-release gedetecteerd — upgraden naar nieuwste pre-release ...")
        cmd = [sys.executable, "-m", "pip", "install", "--upgrade", "--pre", "roan"]
    else:
        print("Upgraden naar nieuwste stable ...")
        cmd = [sys.executable, "-m", "pip", "install", "--upgrade", "roan"]

    subprocess.run(cmd)
