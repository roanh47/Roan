import json
import subprocess
import sys
from importlib import metadata
from pathlib import Path


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
    print("Upgraden via pip ...")
    subprocess.run([sys.executable, "-m", "pip", "install", "--upgrade", "roan"])
