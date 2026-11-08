import hashlib
import html
import json
import re
import socket
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from datetime import datetime, timezone
from html.parser import HTMLParser
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


# ---------- kennis: ophalen en bewaren zonder API-sleutel ----------

# We identificeren ons, zoals in roan/models.py: een gewone UA met de naam erin.
ROAN_UA = "Mozilla/5.0 (Roan)"

KNOWLEDGE_MAX_BYTES = 512_000   # per bron; één enorme pagina mag de schijf niet vullen
KNOWLEDGE_REVISIONS = 2         # oude versies die we bewaren voor een mislukte fetch
KNOWLEDGE_TIMEOUT = 20
KNOWLEDGE_PREVIEW = 1500        # hoeveel van de opgeslagen tekst terug in het gesprek komt

GITHUB_API = "https://api.github.com"
# api.github.com geeft 60 requests per uur per IP zonder authenticatie. Dat is de
# limiet uit de headers zelf: X-RateLimit-Limit, X-RateLimit-Remaining en
# X-RateLimit-Reset (epoch seconden). Bij 403 met Remaining 0 is het de limiet
# en geen blokkade — dan zeggen we dat, met het tijdstip waarop het vrijkomt.
GITHUB_RATE_LIMIT = 60

# Waarom api.github.com geen robots.txt-probe krijgt, terwijl een gewone pagina
# die wel krijgt: die probe zou een van de 60 verzoeken per uur opmaken, en dus de
# rate limit verslechteren in plaats van hem te respecteren. Voor de API geldt
# GitHubs eigen voorwaarde (ongeauthenticeerd toegang is toegestaan, met 60
# verzoeken per uur); die volgen we met GITHUB_RATE_LIMIT en de headers uit het
# antwoord. Zonder api-sleutel zien we uitsluitend wat een anonieme bezoeker ziet.

# Pagina's die aan een ingelogde bezoeker te zien geven. LinkedIn staat er expliciet
# bij: die mur is niet te omzeilen zonder account, dus dat is geen storing maar een
# blokkade, en die horen we benoemd te hebben in plaats van te verhullen.
_LOGIN_WALL_MARKERS = (
    "authwall",
    "sign in to continue",
    "log in to continue",
    "sign in to view",
    "join now to see who",
    "please log in to continue",
    "/login?",
    "/checkpoint/lg",
)

_ROBOTS: dict[str, urllib.robotparser.RobotFileParser | None] = {}


class _FetchError(Exception):
    """Een mislukte aanroep, met een melding die je zo kunt teruggeven."""

    def __init__(self, message: str):
        super().__init__(message)


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _slug(text: str, limit: int = 60) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", str(text).lower()).strip("-")
    return (slug[:limit].strip("-") or "bron")


def _check_url(url: str) -> str:
    """Controleer een URL. Geeft de URL terug of gooit _FetchError met de reden.

    Drie dingen gaan altijd mis en worden hier geweigerd in plaats van geprobeerd:
    een ander schema dan http(s) (dus ook file://), een ingebedde credential, en
    een token in de querystring — die zou in een plaintext-bestand belanden.
    """
    raw = str(url or "").strip()
    if not raw:
        raise _FetchError("Geen URL gegeven.")
    parts = urllib.parse.urlsplit(raw)
    scheme = (parts.scheme or "").lower()
    if scheme == "file":
        raise _FetchError(
            f"Weiger file:// — dit is lokale schijf, geen internetbron. "
            f"Gebruik `read_file` om {raw} te lezen."
        )
    if scheme not in ("http", "https"):
        raise _FetchError(
            f"Weiger {scheme or '(geen schema)'}:// — alleen http en https worden opgehaald."
        )
    if "@" in parts.netloc:
        raise _FetchError(
            "Weiger een URL met een ingebedde credential (`user:pass@`). Roan haalt "
            "alleen ongeauthenticeerd op; zet geen wachtwoord of token in een URL."
        )
    if not parts.hostname:
        raise _FetchError(f"Kan de host uit {raw} halen.")
    lowered = raw.lower()
    for marker in ("access_token=", "api_key=", "apikey=", "token=", "password=", "secret="):
        if marker in lowered:
            raise _FetchError(
                f"Weiger een URL met `{marker}` erin: dat is een credential, en die zou "
                "in een leesbaar bestand in ~/.Roan/knowledge belanden. Haal de bron op "
                "zonder token, of plak de inhoud met `store_knowledge`."
            )
    return raw


def _load_robots(origin: str) -> urllib.robotparser.RobotFileParser | None:
    """robots.txt ophalen en parsen. None betekent: geen robots.txt, dus vrij.

    Een ontbrekende robots.txt geven we niet als fout terug — dat staat in RFC 9309,
    en LinkedIn/GitHub hebben er allebei geen. Onbereikbaar is een apart geval: daar
    geven we de pagina vrij met de regel dat robots dan niet te naleven is.
    """
    try:
        body, ctype, _, _ = _http_get(
            origin + "/robots.txt", accept="text/plain,*/*;q=0.5", limit=64_000
        )
    except _FetchError:
        return None
    if "text" not in ctype and "html" not in ctype:
        return None
    parser = urllib.robotparser.RobotFileParser()
    parser.set_url(origin + "/robots.txt")
    try:
        parser.parse(body.decode("utf-8", errors="replace").splitlines())
    except Exception:
        return None
    return parser


def _robots_allows(url: str) -> tuple[bool, str]:
    """Mag deze URL volgens robots.txt? (toegestaan, reden)"""
    parts = urllib.parse.urlsplit(url)
    origin = f"{parts.scheme}://{parts.netloc}"
    if origin not in _ROBOTS:
        _ROBOTS[origin] = _load_robots(origin)
    parser = _ROBOTS[origin]
    if parser is None:
        return True, ""
    try:
        allowed = parser.can_fetch(ROAN_UA, url)
    except Exception:
        return True, ""
    return allowed, origin


def _retry_after(headers) -> str:
    value = (headers or {}).get("Retry-After") or ""
    if not value:
        return ""
    value = value.strip()
    if value.isdigit():
        return f" De server vraagt om {int(value)} seconden wachten (Retry-After)."
    return f" De server vraagt om een retry na {value} (Retry-After)."


def _http_error_message(err: urllib.error.HTTPError, url: str) -> str:
    """Een leesbare melding per statuscode, inclusief rate limit en Retry-After."""
    code = err.code
    if code == 404:
        return f"404 — {url} bestaat niet (of is verplaatst). Er is niets opgeslagen."
    if code in (401, 403):
        extra = _retry_after(err.headers)
        remaining = (err.headers or {}).get("X-RateLimit-Remaining")
        if code == 403 and remaining == "0":
            reset = (err.headers or {}).get("X-RateLimit-Reset", "")
            when = ""
            if reset.isdigit():
                when = datetime.fromtimestamp(int(reset), timezone.utc).strftime(
                    "%Y-%m-%d %H:%M UTC"
                )
            limit = (err.headers or {}).get("X-RateLimit-Limit", str(GITHUB_RATE_LIMIT))
            return (
                f"{code} — rate limit bereikt: {remaining} van {limit} verzoeken over."
                + (f" Vrij vanaf {when}." if when else "")
                + " Wacht af; het afhalen van een API-sleutel is geen optie."
            )
        return (
            f"{code} — geweigerd: {url}. Deze bron vraagt om een login of een API-sleutel. "
            "Roan doet alleen ongeauthenticeerd lezen, dus dit gaat niet lukken. "
            "Plak de inhoud zelf met `store_knowledge`." + extra
        )
    if code == 429:
        return f"429 — rate limit bereikt op {url}.{_retry_after(err.headers)}"
    return f"{code} — {_http_reason(err, url)}{_retry_after(err.headers)}"


def _http_reason(err: urllib.error.HTTPError, url: str) -> str:
    return f"de server gaf {err.code} {err.reason} voor {url}. Er is niets opgeslagen."


def _http_get(
    url: str, accept: str = "text/html,application/xhtml+xml,text/plain;q=0.8",
    limit: int = KNOWLEDGE_MAX_BYTES,
) -> tuple[bytes, str, str, object]:
    """Een GET zonder credentials. Geeft (body, content-type, eind-URL, headers).

    Leest nooit meer dan `limit` + 1 bytes: een enorme pagina wordt dus geweigerd
    voordat hij het geheugen in kan, niet erna.
    """
    request = urllib.request.Request(url, headers={"User-Agent": ROAN_UA, "Accept": accept})
    # Bewust geen Authorization-header en geen auth-handler: dit pad kan niet
    # ingelogd zijn, ook niet als er ergens een key in de omgeving staat.
    try:
        with urllib.request.urlopen(request, timeout=KNOWLEDGE_TIMEOUT) as resp:
            body = resp.read(limit + 1)
            ctype = resp.headers.get("Content-Type", "")
            headers = resp.headers
            final = getattr(resp, "url", None) or url
    except urllib.error.HTTPError as e:
        raise _FetchError(_http_error_message(e, url)) from None
    except socket.timeout:
        raise _FetchError(
            f"Timeout na {KNOWLEDGE_TIMEOUT}s op {url}. De server antwoordde niet. Er is "
            "niets opgeslagen."
        ) from None
    except urllib.error.URLError as e:
        reason = e.reason
        if isinstance(reason, socket.timeout):
            raise _FetchError(
                f"Timeout na {KNOWLEDGE_TIMEOUT}s op {url}. Er is niets opgeslagen."
            ) from None
        if isinstance(reason, socket.gaierror):
            raise _FetchError(
                f"DNS faalt voor {_host(url)}: de hostnaam bestaat niet of de DNS "
                "los het niet op. Er is niets opgeslagen."
            ) from None
        if isinstance(reason, ConnectionRefusedError):
            raise _FetchError(
                f"Verbinding geweigerd op {_host(url)}: niemand luistert daar. "
                "Er is niets opgeslagen."
            ) from None
        raise _FetchError(f"Netwerkfout bij het ophalen van {url}: {reason}") from None
    except TimeoutError:
        raise _FetchError(
            f"Timeout na {KNOWLEDGE_TIMEOUT}s op {url}. Er is niets opgeslagen."
        ) from None
    except OSError as e:
        raise _FetchError(f"Netwerkfout bij het ophalen van {url}: {e}") from None
    if len(body) > limit:
        raise _FetchError(
            f"Te groot: {url} is meer dan {limit} bytes en wordt niet opgeslagen, zodat "
            "één pagina de schijf niet kan vullen. Gebruik `github_repos` voor metadata, "
            "of een lichtere pagina."
        )
    return body, ctype, final, headers


def _host(url: str) -> str:
    """Alleen de host uit een URL, voor een leesbare foutmelding."""
    parts = urllib.parse.urlsplit(url)
    return parts.hostname or url


class _MarkdownExtractor(HTMLParser):
    """HTML -> markdown, bewust grof: koppen, lijsten, links, code, tabellen.

    Geen dependency, en geen belofte van perfectie. Wat we weggooien staat hieronder
    bij SKIP; de tekst die overblijft is leesbaar en controleerbaar.
    """

    SKIP = {"script", "style", "noscript", "template", "svg", "head", "iframe", "object",
            "nav", "footer", "aside"}
    HEADINGS = {"h1": "#", "h2": "##", "h3": "###", "h4": "####", "h5": "#####", "h6": "######"}
    BLOCKS = {
        "p", "div", "section", "article", "main", "header", "footer", "aside", "nav",
        "blockquote", "pre", "ul", "ol", "dl", "dt", "dd", "table", "tr", "figure",
        "form", "hgroup", "address",
    }

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.title = ""
        self._skip = 0
        self._pre = 0
        self._href: list[str] = []
        self._in_title = False

    def _emit(self, text: str) -> None:
        self.out.append(text)

    def handle_starttag(self, tag, attrs):
        # De titel eerst: <title> staat binnen <head>, en head slaan we over.
        if tag == "title":
            self._in_title = True
            return
        if tag in self.SKIP:
            self._skip += 1
            return
        if self._skip:
            return
        attrs = dict(attrs)
        if tag == "br":
            self._emit("\n")
        elif tag == "hr":
            self._emit("\n\n---\n\n")
        elif tag in self.HEADINGS:
            self._emit("\n\n" + self.HEADINGS[tag] + " ")
        elif tag in ("strong", "b") and not self._pre:
            self._emit("**")
        elif tag in ("em", "i") and not self._pre:
            self._emit("*")
        elif tag == "code" and not self._pre:
            self._emit("`")
        elif tag == "pre":
            self._pre += 1
            self._emit("\n\n```\n")
        elif tag == "a":
            href = attrs.get("href") or ""
            if href.startswith(("http://", "https://", "/", "#", "mailto:")):
                self._href.append(href)
                self._emit("[")
            else:
                self._href.append("")
        elif tag == "li":
            self._emit("\n- ")
        elif tag in ("td", "th"):
            self._emit(" | ")
        elif tag in ("tr",):
            self._emit("\n| ")
        elif tag in self.BLOCKS:
            self._emit("\n\n")

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.SKIP:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
            return
        if tag in self.SKIP:
            self._skip = max(0, self._skip - 1)
            return
        if self._skip:
            return
        if tag in ("strong", "b") and not self._pre:
            self._emit("**")
        elif tag in ("em", "i") and not self._pre:
            self._emit("*")
        elif tag == "code" and not self._pre:
            self._emit("`")
        elif tag == "pre" and self._pre:
            self._pre -= 1
            self._emit("\n```\n")
        elif tag == "a" and self._href:
            href = self._href.pop()
            self._emit(f"]({href})" if href else "")
        elif tag in ("p", "li", "tr", "blockquote"):
            self._emit("\n")

    def handle_data(self, data):
        if self._in_title:
            self.title += data.strip()
            return
        if self._skip:
            return
        text = data if self._pre else re.sub(r"\s+", " ", data)
        if text.strip() or (self._pre and text.strip("\n")):
            self._emit(text)

    def result(self) -> str:
        text = "".join(self.out)
        text = re.sub(r"[ \t]+\n", "\n", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
        text = re.sub(r"\|\s*\|\s*\|", "|", text)
        return text.strip()


def _html_to_markdown(raw: str) -> tuple[str, str]:
    """(markdown, paginatitel) uit HTML."""
    parser = _MarkdownExtractor()
    try:
        parser.feed(raw)
        parser.close()
    except Exception:
        pass
    return parser.result(), parser.title


def _looks_like_login_wall(text: str) -> bool:
    low = text.lower()
    return any(marker in low for marker in _LOGIN_WALL_MARKERS)


def _linkedin_message() -> str:
    return (
        "LinkedIn kan niet anoniem worden opgehaald. LinkedIn serveert aan elke "
        "ongeauthenticeerde client een loginmuur, en dat is met een gewone HTTP-GET "
        "niet te omzeilen — alleen met een account, een token of OAuth, en dat is "
        "precies wat hier niet mag. Dit is dus een blokkade, geen storing, en er is "
        "geen manier om dit hier op te lossen.\n"
        "Wat wel werkt: open LinkedIn in je eigen browser, kopieer de tekst of de "
        "tekst van een post, en plak die met de `store_knowledge`-tool. Roan slaat "
        "die dan op met bron en datum."
    )


def _prune_revisions(revisions: Path, stem: str) -> None:
    """Houd de nieuwste KNOWLEDGE_REVISIONS versies; de rest weg."""
    old = sorted(revisions.glob(f"{stem}.*.md"), key=lambda p: (p.stat().st_mtime, p.name))
    for path in old[: max(0, len(old) - KNOWLEDGE_REVISIONS)]:
        try:
            path.unlink()
        except OSError:
            pass


def _write_knowledge(stem: str, content: str) -> Path:
    """Schrijf een bron weg. De vorige versie gaat naar revisions/ voordat dit weg.

    Zwaaien met de vorige versie lukt niet, dan schrijven we níet: een mislukte
    fetch mag geen werkende bron overschrijven.
    """
    root = config.KNOWLEDGE_DIR
    revisions = root / "revisions"
    root.mkdir(parents=True, exist_ok=True)
    revisions.mkdir(parents=True, exist_ok=True)
    target = root / f"{stem}.md"
    if target.exists():
        stamp = time.strftime("%Y%m%dT%H%M%S")
        rev = revisions / f"{stem}.{stamp}.md"
        counter = 2
        while rev.exists():
            rev = revisions / f"{stem}.{stamp}-{counter}.md"
            counter += 1
        target.replace(rev)
        _prune_revisions(revisions, stem)
    target.write_text(content, encoding="utf-8")
    return target


def _store_body(body: str, size: int) -> str:
    preview = body[:KNOWLEDGE_PREVIEW].rstrip()
    if len(body) > KNOWLEDGE_PREVIEW:
        preview += f"\n\n[+{len(body) - KNOWLEDGE_PREVIEW} tekens, lees het bestand voor de rest]"
    return (
        f"formaat: {size} tekens markdown — hieronder het begin; "
        f"het hele bestand staat op schijf\n\n{preview}"
    )


def store_knowledge(title: str, text: str, source: str = "") -> str:
    """Bewaar tekst die de gebruiker zelf meegeeft. Geen netwerk, geen API-sleutel.

    Dit is de weg die altijd werkt, ook zonder internet: plak de tekst hier en hij
    staat in ~/.Roan/knowledge, met bron en datum erboven.
    """
    body = str(text or "")
    if not body.strip():
        return "Niets opgeslagen: de tekst is leeg. Plak de inhoud die je wilt bewaren."
    if len(body.encode("utf-8")) > KNOWLEDGE_MAX_BYTES:
        return (
            f"Niets opgeslagen: {len(body.encode('utf-8'))} bytes is groter dan de cap van "
            f"{KNOWLEDGE_MAX_BYTES} bytes per bron. Splits het op in stukken, of vat het samen."
        )
    stem = f"{_slug(title)}.{hashlib.sha1(title.encode('utf-8')).hexdigest()[:8]}"
    when = _now()
    where = source.strip() or "(ingevoerd, geen externe bron)"
    header = [
        f"# Roan kennis: {title.strip()}",
        "",
        f"- bron: {where}",
        f"- opgehaald: {when}",
        f"- via: store_knowledge (ingevoerd door de gebruiker, geen netwerk)",
        "",
        "---",
        "",
    ]
    try:
        path = _write_knowledge(stem, "\n".join(header) + body.strip() + "\n")
    except OSError as e:
        return f"Fout bij het opslaan van {title.strip()}: {e}"
    return (
        f"Opgeslagen: {path}\n"
        f"bron: {where}\n"
        f"datum: {when}\n"
        f"{_store_body(body.strip(), len(body.strip()))}"
    )


def _content_kind(ctype: str, body: bytes) -> tuple[str, str]:
    """(soort, uitleg) — 'html', 'plain' of '' als het geen leesbare tekst is."""
    kind = (ctype or "").split(";")[0].strip().lower()
    if kind in ("text/html", "application/xhtml+xml"):
        return "html", kind
    if kind.startswith("text/") or kind in (
        "application/json", "application/xml", "application/x-yaml", "application/yaml",
    ):
        return "plain", kind
    if not kind:
        sample = body[:200].lstrip().lower()
        return ("html", "onbekend (begint als html)") if sample.startswith(b"<!doctype") or sample.startswith(b"<html") else ("plain", "onbekend")
    return "", kind


def fetch_and_store(url: str) -> str:
    """Haal een URL op (alleen lezend, zonder sleutel) en sla hem op als markdown."""
    try:
        raw_url = _check_url(url)
        host = _host(raw_url).lower()
        if host.endswith("linkedin.com"):
            raise _FetchError(_linkedin_message())
        allowed, origin = _robots_allows(raw_url)
        if not allowed:
            raise _FetchError(
                f"Geblokkeerd door robots.txt van {origin}: deze pagina mag niet "
                "programmatisch worden opgehaald. Dat is een afspraak, geen storing. "
                "Plak de inhoud zelf met `store_knowledge`."
            )
        body, ctype, final, _headers = _http_get(raw_url)
        kind, label = _content_kind(ctype, body)
        if not kind:
            raise _FetchError(
                f"{raw_url} is geen HTML of tekst ({label}). Deze tool bewaart webpagina's "
                "en platte tekst; binaire of exotische formaten laat ik liggen."
            )
        text = body.decode("utf-8", errors="replace")
        if kind == "html":
            markdown, page_title = _html_to_markdown(text)
            if _looks_like_login_wall(markdown) or _looks_like_login_wall(text):
                raise _FetchError(
                    f"{raw_url} stuurt een loginmuur: het opgehaalde bestand is de "
                    "inlogpagina, niet de inhoud. Zonder account levert deze bron niets. "
                    "Plak de inhoud zelf met `store_knowledge`."
                )
        else:
            markdown, page_title = text.strip(), ""
        if not markdown.strip():
            raise _FetchError(
                f"{raw_url} gaf wel een antwoord, maar er viel geen leesbare tekst uit "
                "(de pagina is leeg of helemaal JavaScript). Er is niets opgeslagen."
            )
        title = page_title or urllib.parse.unquote(_host(raw_url)) or raw_url
        stem = f"{_slug(title)}.{hashlib.sha1(raw_url.encode('utf-8')).hexdigest()[:8]}"
        when = _now()
        header = [
            f"# Roan kennis: {title}",
            "",
            f"- bron: {raw_url}",
            f"- opgehaald: {when}",
            f"- type: {label}",
            f"- via: fetch_and_store (ongeauthenticeerd, read-only, geen API-sleutel)",
        ]
        if final != raw_url:
            header.append(f"- eind-url: {final}")
        header += ["", "---", ""]
        path = _write_knowledge(stem, "\n".join(header) + markdown + "\n")
    except _FetchError as e:
        return f"Niet opgeslagen. {e}"
    except OSError as e:
        return f"Niet opgeslagen. Fout bij het schrijven in {config.KNOWLEDGE_DIR}: {e}"
    return (
        f"Opgeslagen: {path}\n"
        f"bron: {raw_url}\n"
        f"datum: {when}\n"
        f"{_store_body(markdown, len(markdown))}"
    )


def _github_repos_markdown(target: str, payload) -> str:
    if isinstance(payload, dict):
        return (
            f"# {_github_name(payload)}\n\n"
            f"- beschrijving: {_github_text(payload.get('description'))}\n"
            f"- taal: {payload.get('language') or '(onbekend)'}\n"
            f"- sterren: {payload.get('stargazers_count', 0)}\n"
            f"- url: {payload.get('html_url') or '(onbekend)'}\n"
        )
    lines = ["# Repository's\n", "Naam | taal | sterren | beschrijving", "---|---|---|---"]
    for repo in payload or []:
        if not isinstance(repo, dict):
            continue
        lines.append(
            "| {name} | {lang} | {stars} | {desc} |".format(
                name=_github_name(repo),
                lang=repo.get("language") or "-",
                stars=repo.get("stargazers_count", 0),
                desc=_github_text(repo.get("description")),
            )
        )
    if len(lines) == 3:
        return "# Repository's\n\n(leeg — geen repositories gevonden)\n"
    return "\n".join(lines) + "\n"


def _github_name(repo: dict) -> str:
    return str(repo.get("full_name") or repo.get("name") or "(onbekend)")


def _github_text(value) -> str:
    if not value:
        return "-"
    return str(value).replace("|", "/").replace("\n", " ").strip()


def github_repos(target: str) -> str:
    """Lijst repositories van een GitHub-gebruiker of één repo. Zonder API-sleutel.

    api.github.com staat 60 requests per uur per IP toe aan ongeauthenticeerde
    clients (zie GITHUB_RATE_LIMIT). Een 403 met X-RateLimit-Remaining: 0 is dus
    een uitputting van die limiet, en geen blokkade — dat staat in het bericht.
    """
    raw = str(target or "").strip().strip("/")
    if not raw:
        return "Geef een GitHub-gebruiker (bijv. `torvalds`) of een repo (`roanh47/Roan`)."
    if raw.count("/") > 1:
        return (
            f"Weiger `{raw}`: geef een gebruikersnaam (`torvalds`) of één repo "
            "(`roanh47/Roan`), niet een pad met meerdere schuine strepen."
        )
    try:
        _check_url(f"https://github.com/{raw}")  # weigert credentials in de naam
    except _FetchError as e:
        return f"Niet opgehaald. {e}"
    if raw.count("/") == 1:
        url = f"{GITHUB_API}/repos/{raw}"
        stem_src = raw.replace("/", "-")
    else:
        url = f"{GITHUB_API}/users/{raw}/repos?per_page=100&sort=updated"
        stem_src = raw
    headers_extra = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    request = urllib.request.Request(
        url, headers={"User-Agent": ROAN_UA, **headers_extra}
    )
    try:
        with urllib.request.urlopen(request, timeout=KNOWLEDGE_TIMEOUT) as resp:
            body = resp.read(KNOWLEDGE_MAX_BYTES + 1)
            gh_headers = resp.headers
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return (
                f"404 — GitHub kent `{raw}` niet (gebruiker of repo niet gevonden, of "
                "privé). Geen API-sleutel gebruikt, dus privérepositories blijven zichtbaar "
                "als 404. Er is niets opgeslagen."
            )
        try:
            message = _http_error_message(e, url)
        except Exception:
            message = f"{e.code} — GitHub weigerde het verzoek."
        return f"Niet opgehaald. {message}"
    except socket.timeout:
        return (
            f"Niet opgehaald. Timeout na {KNOWLEDGE_TIMEOUT}s op api.github.com. "
            "Er is niets opgeslagen."
        )
    except urllib.error.URLError as e:
        return f"Niet opgehaald. Netwerkfout bij api.github.com: {e.reason}"
    except OSError as e:
        return f"Niet opgehaald. Netwerkfout bij api.github.com: {e}"
    if len(body) > KNOWLEDGE_MAX_BYTES:
        return (
            f"Niet opgeslagen. GitHub gaf meer dan de cap van {KNOWLEDGE_MAX_BYTES} bytes "
            "terug, dus er is niets weggeschreven."
        )
    try:
        payload = json.loads(body.decode("utf-8", errors="replace"))
    except json.JSONDecodeError as e:
        return f"Niet opgeslagen. GitHub gaf geen geldige JSON terug: {e}"
    if isinstance(payload, dict) and payload.get("message"):
        return f"Niet opgeslagen. GitHub zei: {payload['message']}"
    remaining = (gh_headers or {}).get("X-RateLimit-Remaining", "")
    markdown = _github_repos_markdown(raw, payload)
    when = _now()
    stem = f"github-{_slug(stem_src)}.{hashlib.sha1(stem_src.encode('utf-8')).hexdigest()[:8]}"
    header = [
        f"# Roan kennis: GitHub {raw}",
        "",
        f"- bron: {url}",
        f"- opgehaald: {when}",
        f"- via: github_repos (ongeauthenticeerd, read-only, geen API-sleutel)",
        f"- rate limit: nog {remaining or '?'} van {GITHUB_RATE_LIMIT} verzoeken per uur over",
        "",
        "---",
        "",
    ]
    try:
        path = _write_knowledge(stem, "\n".join(header) + markdown)
    except OSError as e:
        return f"Niet opgeslagen. Fout bij het schrijven in {config.KNOWLEDGE_DIR}: {e}"
    count = len(payload) if isinstance(payload, list) else 1
    noun = "repo" if count == 1 else "repo's"
    limit_note = (
        f"\nLet op: nog {remaining} van {GITHUB_RATE_LIMIT} verzoeken per uur over."
        if remaining != ""
        else ""
    )
    return (
        f"Opgeslagen: {path}\n"
        f"bron: {url}\n"
        f"datum: {when}\n"
        f"{count} {noun} opgehaald.{limit_note}\n\n"
        f"{_store_body(markdown, len(markdown))}"
    )


# De JSON-schema's staan normaal in roan/agent.py (TOOLS) samen met de dispatch in
# TOOL_FUNCS. Deze twee lijsten hebben dezelfde vorm, zodat registreren twee regels
# is in agent.py:
#     TOOLS += KNOWLEDGE_TOOL_SCHEMAS
#     TOOL_FUNCS.update(KNOWLEDGE_TOOL_FUNCS)
KNOWLEDGE_TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "store_knowledge",
            "description": (
                "Bewaar tekst die de gebruiker je meegeeft in ~/.Roan/knowledge, met bron "
                "en datum. Gebruik dit ook als een fetch mislukt of als een site een "
                "loginmuur serveert: plakken werkt altijd, ook zonder netwerk."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Korte titel van de kennis."},
                    "text": {"type": "string", "description": "De tekst zelf."},
                    "source": {
                        "type": "string",
                        "description": "Waar het vandaan komt (optioneel, bv. een URL of 'LinkedIn').",
                    },
                },
                "required": ["title", "text"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fetch_and_store",
            "description": (
                "Haal een http(s)-URL op zonder inloggen (geen API-sleutel) en sla de "
                "pagina op als markdown in ~/.Roan/knowledge. Kan niets ophalen, dan zegt "
                "het waarom — verzin dan niets, maar gebruik store_knowledge."
            ),
            "parameters": {
                "type": "object",
                "properties": {"url": {"type": "string", "description": "De http(s)-URL."}},
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "github_repos",
            "description": (
                "Lijst de repositories van een GitHub-gebruiker of één repo, via de "
                "ongeauthenticeerde api.github.com (60 verzoeken per uur). Bewaart het "
                "overzicht ook."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "target": {
                        "type": "string",
                        "description": "Een gebruikersnaam (bv. 'torvalds') of 'eigenaar/repo'.",
                    }
                },
                "required": ["target"],
            },
        },
    },
]

KNOWLEDGE_TOOL_FUNCS = {
    "store_knowledge": store_knowledge,
    "fetch_and_store": fetch_and_store,
    "github_repos": github_repos,
}
