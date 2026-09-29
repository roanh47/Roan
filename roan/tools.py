import html
import json
import re
import subprocess
import urllib.parse
import urllib.request
from pathlib import Path

from . import config

TIMEOUT = 120
_MAX_OUTPUT = 20000


def _truncate(text: str, limit: int = _MAX_OUTPUT) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n... [afgekapt, {len(text) - limit} tekens over]"


def run_shell(command: str) -> str:
    try:
        r = subprocess.run(command, shell=True, capture_output=True, text=True, timeout=TIMEOUT)
        out = (r.stdout or "").rstrip()
        err = (r.stderr or "").rstrip()
        parts = []
        if out:
            parts.append(out)
        if err:
            parts.append(f"[stderr]\n{err}")
        if not parts:
            parts.append(f"(exit code {r.returncode}, no output)")
        return _truncate("\n".join(parts))
    except subprocess.TimeoutExpired:
        return f"Error: command timed out ({TIMEOUT}s)."
    except Exception as e:
        return f"Error: {e}"


def read_file(path: str) -> str:
    try:
        return _truncate(Path(path).expanduser().read_text(encoding="utf-8", errors="replace"))
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


def edit_file(path: str, old: str, new: str) -> str:
    """Vervang de eerste voorkoming van `old` door `new`."""
    try:
        p = Path(path).expanduser()
        text = p.read_text(encoding="utf-8")
        if old not in text:
            return f"Error: `old` niet gevonden in {path}."
        p.write_text(text.replace(old, new, 1), encoding="utf-8")
        return f"Edited {path}."
    except Exception as e:
        return f"Error editing {path}: {e}"


def list_files(path: str = ".") -> str:
    try:
        p = Path(path).expanduser()
        if not p.exists():
            return f"Error: {path} bestaat niet."
        if p.is_file():
            return str(p)
        entries = sorted(p.iterdir(), key=lambda e: (e.is_file(), e.name))
        lines = []
        for e in entries[:500]:
            suffix = "/" if e.is_dir() else ""
            lines.append(f"{e.name}{suffix}")
        return "\n".join(lines) or "(leeg)"
    except Exception as e:
        return f"Error listing {path}: {e}"


def glob_files(pattern: str) -> str:
    try:
        matches = sorted(str(m) for m in Path(".").glob(pattern))
        return "\n".join(matches[:500]) or "(geen matches)"
    except Exception as e:
        return f"Error globbing {pattern}: {e}"


def _strip_html(text: str) -> str:
    text = re.sub(r"(?is)<(script|style).*?</\1>", " ", text)
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def fetch_url(url: str) -> str:
    """Haal een URL op en geef de tekst terug (HTML wordt gestript)."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Roan harness)"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read(500_000).decode("utf-8", errors="replace")
        if "text/html" in resp.headers.get("Content-Type", ""):
            raw = _strip_html(raw)
        return _truncate(raw, 8000)
    except Exception as e:
        return f"Error fetching {url}: {e}"


def web_search(query: str) -> str:
    """Zoek op het web via DuckDuckGo lite (geen API-key nodig)."""
    try:
        data = urllib.parse.urlencode({"q": query}).encode()
        req = urllib.request.Request(
            "https://lite.duckduckgo.com/lite/",
            data=data,
            headers={"User-Agent": "Mozilla/5.0 (Roan harness)"},
        )
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read(300_000).decode("utf-8", errors="replace")
    except Exception as e:
        return f"Error searching: {e}"

    results = []
    for m in re.finditer(r'<a[^>]+class="result-link"[^>]*href="([^"]+)"[^>]*>(.*?)</a>', raw, re.S):
        url, title = m.group(1), _strip_html(m.group(2))
        if title:
            results.append(f"{title}\n{url}")
    if not results:
        for m in re.finditer(r'<a[^>]+href="(https?://[^"]+)"[^>]*>(.*?)</a>', raw, re.S):
            url, title = m.group(1), _strip_html(m.group(2))
            if title and "duckduckgo" not in url:
                results.append(f"{title}\n{url}")
    if not results:
        return "Geen resultaten (of DuckDuckGo blokkeerde het verzoek)."
    return _truncate("\n\n".join(results[:8]), 6000)


def todo_write(items_json: str) -> str:
    """Simpele takenlijst-helper; slaat op als tekst."""
    try:
        items = json.loads(items_json)
    except json.JSONDecodeError:
        return "Error: items_json moet geldige JSON zijn."
    path = config.ROAN_DIR / "todo.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = []
    for it in items:
        box = "x" if it.get("done") else " "
        lines.append(f"- [{box}] {it.get('text', '')}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return f"Todo bijgewerkt ({len(items)} items)."
