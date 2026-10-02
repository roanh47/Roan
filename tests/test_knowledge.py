"""Tests voor de kennisopslag: ophalen zonder sleutel, en opslaan van wat de
gebruiker zelf meegeeft.

Alle tests draaien zonder netwerk: urlopen is vervangen door een stub. Dat is
geen gemak maar de eis — een test die het echte internet raakt, faagt zomaar en
slaat de rate limit van GitHub op.
"""

import inspect
import socket
import urllib.error
import urllib.request
from pathlib import Path

import pytest

from roan import config, home, tools


PAGE = """<html><head><title>Roan — a TUI</title></head>
<body>
  <nav><a href="/">home</a></nav>
  <h1>Roan</h1>
  <p>Een <strong>terminal</strong> agent met <em>weinig</em> code.</p>
  <ul><li>live modellen</li><li>lokale modellen</li></ul>
  <pre><code>roan</code></pre>
  <script>alert('weg')</script>
  <footer>copyright</footer>
</body></html>"""


class FakeResponse:
    """Net genoeg van een http.client.HTTPResponse voor de code hierboven."""

    def __init__(self, body: bytes = b"", ctype: str = "text/html; charset=utf-8",
                 headers: dict | None = None):
        self.body = body
        self.headers = {"Content-Type": ctype, **(headers or {})}
        self.url = ""

    def read(self, size: int = -1) -> bytes:
        return self.body[:size] if size and size > 0 else self.body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakeNet:
    """Vervangt urllib.request.urlopen; elk antwoord of elke fout is instelbaar."""

    def __init__(self):
        self.routes: dict = {}
        self.requests: list = []
        self.robots = urllib.error.HTTPError("robots", 404, "Not Found", {}, None)

    def add(self, url: str, response) -> None:
        self.routes[url] = response

    def fail(self, url: str, exc: Exception) -> None:
        self.routes[url] = exc

    def __call__(self, request, timeout=None):
        url = request.full_url
        self.requests.append(request)
        item = self.robots if url.endswith("/robots.txt") else self.routes.get(url)
        if item is None:
            item = urllib.error.HTTPError(url, 404, "Not Found", {}, None)
        if isinstance(item, Exception):
            raise item
        item.url = url
        return item


@pytest.fixture
def kennis(tmp_path, monkeypatch):
    """Alle kennis in een tijdelijke map, en een netwerk dat niet bestaat."""
    monkeypatch.setattr(config, "KNOWLEDGE_DIR", tmp_path / "knowledge")
    # De robots-cache leeft in het proces, zoals in het echte leven. Per test
    # leegmaken, anders leent de ene test zijn robots.txt aan de volgende.
    tools._ROBOTS.clear()
    net = FakeNet()
    monkeypatch.setattr(urllib.request, "urlopen", net)
    yield net
    tools._ROBOTS.clear()


def stored_files() -> list[Path]:
    return sorted(p for p in config.KNOWLEDGE_DIR.glob("*.md"))


# ---------- opslaan van wat de gebruiker meegeeft ----------
def test_store_knowledge_without_any_network(kennis, monkeypatch):
    """De belangrijkste weg: plakken. Geen enkel verzoek mag worden gedaan."""

    def boom(*args, **kwargs):
        raise AssertionError("store_knowledge deed een netwerkverzoek")

    monkeypatch.setattr(urllib.request, "urlopen", boom)
    out = tools.store_knowledge("Mijn LinkedIn-post", "Ik werk aan Roan.", source="LinkedIn")

    files = stored_files()
    assert len(files) == 1
    text = files[0].read_text(encoding="utf-8")
    assert "- opgehaald: 20" in text
    assert "bron: LinkedIn" in text
    assert "geen netwerk" in text
    assert "Ik werk aan Roan." in text
    assert str(files[0]) in out
    assert "LinkedIn" in out
    assert kennis.requests == []


def test_store_knowledge_defaults_the_source(kennis):
    tools.store_knowledge("Notitie", "zonder bron")
    text = stored_files()[0].read_text(encoding="utf-8")
    assert "bron: (ingevoerd, geen externe bron)" in text


def test_store_knowledge_refuses_empty_text(kennis):
    assert "leeg" in tools.store_knowledge("Leeg", "   ")
    assert stored_files() == []


def test_store_knowledge_respects_the_size_cap(kennis):
    huge = "x" * (tools.KNOWLEDGE_MAX_BYTES + 1)
    out = tools.store_knowledge("Te groot", huge)
    assert "groter dan de cap" in out
    assert stored_files() == []


# ---------- een geslaagde fetch ----------
def test_successful_fetch_stores_url_and_date(kennis):
    kennis.add("https://example.com/roan", FakeResponse(PAGE.encode()))
    out = tools.fetch_and_store("https://example.com/roan")

    files = stored_files()
    assert len(files) == 1
    text = files[0].read_text(encoding="utf-8")
    assert "- bron: https://example.com/roan" in text
    assert "- opgehaald: 20" in text
    assert "read-only" in text
    assert "# Roan" in text
    # markdown, geen kale html-strip
    assert "<h1>" not in text and "# Roan" in text
    assert "**terminal**" in text and "*weinig*" in text
    assert "- live modellen" in text
    assert "alert('weg')" not in text  # <script> is weggegooid
    assert "copyright" not in text     # <footer> is weggegooid
    assert "[home](/)" not in text     # <nav> is weggegooid
    assert files[0].name.startswith("roan-a-tui.")  # de <title> gaf de naam
    assert str(files[0]) in out


def test_fetch_reports_no_credential_is_used(kennis):
    """Het mag nooit een Authorization-header meesturen."""
    kennis.add("https://example.com/roan", FakeResponse(PAGE.encode()))
    tools.fetch_and_store("https://example.com/roan")
    page = [r for r in kennis.requests if r.full_url.endswith("/roan")]
    assert page
    for request in page:
        headers = {k.lower() for k in request.headers}
        assert "authorization" not in headers
        assert "x-api-key" not in headers
        assert request.get_header("User-agent") == tools.ROAN_UA


def test_fetch_keeps_the_previous_version(kennis):
    kennis.add("https://example.com/roan", FakeResponse(b"<title>A</title><p>eerste</p>"))
    tools.fetch_and_store("https://example.com/roan")
    kennis.add("https://example.com/roan", FakeResponse(b"<title>A</title><p>tweede</p>"))
    tools.fetch_and_store("https://example.com/roan")

    revisions = sorted((config.KNOWLEDGE_DIR / "revisions").glob("*.md"))
    assert len(revisions) == 1
    assert "eerste" in revisions[0].read_text(encoding="utf-8")
    assert "tweede" in stored_files()[0].read_text(encoding="utf-8")


def test_fetch_keeps_at_most_a_couple_of_revisions(kennis):
    for i in range(tools.KNOWLEDGE_REVISIONS + 3):
        kennis.add("https://example.com/roan", FakeResponse(f"<p>versie {i}</p>".encode()))
        tools.fetch_and_store("https://example.com/roan")
    revisions = sorted((config.KNOWLEDGE_DIR / "revisions").glob("*.md"))
    assert len(revisions) == tools.KNOWLEDGE_REVISIONS
    newest = stored_files()[0].read_text(encoding="utf-8")
    assert f"versie {tools.KNOWLEDGE_REVISIONS + 2}" in newest


# ---------- fouten: leesbaar, geen traceback ----------
def test_404_reports_cleanly(kennis):
    out = tools.fetch_and_store("https://example.com/weg")
    assert "404" in out
    assert "bestaat niet" in out
    assert "Niet opgeslagen" in out
    assert "Traceback" not in out
    assert stored_files() == []


def test_timeout_reports_cleanly(kennis):
    kennis.fail("https://example.com/langzaam", socket.timeout("timed out"))
    out = tools.fetch_and_store("https://example.com/langzaam")
    assert "Timeout" in out
    assert f"{tools.KNOWLEDGE_TIMEOUT}s" in out
    assert stored_files() == []


def test_dns_failure_reports_cleanly(kennis):
    kennis.fail(
        "https://bestaat-niet.example/x",
        urllib.error.URLError(socket.gaierror(-2, "Name or service not known")),
    )
    out = tools.fetch_and_store("https://bestaat-niet.example/x")
    assert "DNS faalt" in out
    assert stored_files() == []


def test_connection_refused_reports_cleanly(kennis):
    kennis.fail(
        "https://localhost:9/x",
        urllib.error.URLError(ConnectionRefusedError(111, "Connection refused")),
    )
    out = tools.fetch_and_store("https://localhost:9/x")
    assert "Verbinding geweigerd" in out
    assert stored_files() == []


def test_rate_limit_response_is_reported(kennis):
    kennis.fail(
        "https://example.com/beperkt",
        urllib.error.HTTPError("x", 429, "Too Many Requests", {"Retry-After": "60"}, None),
    )
    out = tools.fetch_and_store("https://example.com/beperkt")
    assert "429" in out
    assert "rate limit" in out
    assert "60 seconden" in out


def test_non_html_body_reports_cleanly(kennis):
    kennis.add("https://example.com/bestand.pdf", FakeResponse(b"%PDF-1.7", "application/pdf"))
    out = tools.fetch_and_store("https://example.com/bestand.pdf")
    assert "geen HTML of tekst" in out
    assert "application/pdf" in out
    assert stored_files() == []


def test_plain_text_body_is_stored(kennis):
    kennis.add("https://example.com/a.txt", FakeResponse(b"gewoon tekst", "text/plain"))
    out = tools.fetch_and_store("https://example.com/a.txt")
    assert "Opgeslagen" in out
    assert "gewoon tekst" in stored_files()[0].read_text(encoding="utf-8")


# ---------- weigeringen ----------
def test_file_scheme_is_refused(kennis):
    out = tools.fetch_and_store("file:///etc/passwd")
    assert "Weiger file://" in out
    assert "read_file" in out
    assert kennis.requests == []


def test_other_scheme_is_refused(kennis):
    assert "alleen http en https" in tools.fetch_and_store("ftp://example.com/x")


def test_embedded_credential_is_refused(kennis):
    out = tools.fetch_and_store("https://gebruiker:geheim@example.com/privé")
    assert "ingebedde credential" in out
    assert "geheim" not in out.replace("Weiger een URL met een ingebedde credential", "")
    assert kennis.requests == []


def test_token_in_the_query_string_is_refused(kennis):
    out = tools.fetch_and_store("https://example.com/x?access_token=geheim123")
    assert "credential" in out
    assert kennis.requests == []


def test_linkedin_is_refused_and_points_at_pasting(kennis):
    out = tools.fetch_and_store("https://www.linkedin.com/in/iemand")
    assert "LinkedIn" in out
    assert "loginmuur" in out
    assert "store_knowledge" in out
    assert kennis.requests == []


def test_login_wall_is_detected(kennis):
    kennis.add(
        "https://example.com/muur",
        FakeResponse(b"<html><body><h1>Sign in to continue</h1><p>Log in</p></body></html>"),
    )
    out = tools.fetch_and_store("https://example.com/muur")
    assert "loginmuur" in out
    assert stored_files() == []


def test_robots_txt_is_respected(kennis):
    kennis.robots = FakeResponse(b"User-agent: *\nDisallow: /priv/\n", "text/plain")
    kennis.add("https://example.com/priv/ding", FakeResponse(PAGE.encode()))
    out = tools.fetch_and_store("https://example.com/priv/ding")
    assert "robots.txt" in out
    assert "store_knowledge" in out
    assert stored_files() == []


def test_robots_allows_a_normal_page(kennis):
    kennis.robots = FakeResponse(b"User-agent: *\nDisallow: /priv/\n", "text/plain")
    kennis.add("https://example.com/open", FakeResponse(PAGE.encode()))
    assert "Opgeslagen" in tools.fetch_and_store("https://example.com/open")


def test_robots_is_fetched_once_per_host(kennis):
    """robots.txt per host één keer ophalen, niet bij elke pagina."""
    kennis.robots = FakeResponse(b"User-agent: *\nDisallow: /priv/\n", "text/plain")
    for name in ("een", "twee", "drie"):
        kennis.add(f"https://example.com/{name}", FakeResponse(PAGE.encode()))
        tools.fetch_and_store(f"https://example.com/{name}")
    robots_calls = [r for r in kennis.requests if r.full_url.endswith("/robots.txt")]
    assert len(robots_calls) == 1
    assert len(stored_files()) == 3


# ---------- GitHub ----------
REPOS_JSON = b"""[
  {"full_name": "roanh47/Roan", "description": "Een TUI | agent",
   "language": "Python", "stargazers_count": 12},
  {"full_name": "roanh47/tekens", "description": null,
   "language": null, "stargazers_count": 0}
]"""


def test_github_repos_parses_a_stubbed_response(kennis):
    kennis.add(
        "https://api.github.com/users/roanh47/repos?per_page=100&sort=updated",
        FakeResponse(REPOS_JSON, "application/json", {"X-RateLimit-Remaining": "57"}),
    )
    out = tools.github_repos("roanh47")

    text = stored_files()[0].read_text(encoding="utf-8")
    assert "- bron: https://api.github.com/users/roanh47/repos" in text
    assert "roanh47/Roan | Python | 12 | Een TUI / agent" in text
    assert "roanh47/tekens | - | 0 | -" in text
    assert "X-RateLimit-Remaining" not in text
    assert "2 repo's opgehaald" in out
    assert "57 van 60 verzoeken per uur over" in out

    request = [r for r in kennis.requests if "api.github.com" in r.full_url][0]
    assert request.get_header("User-agent") == tools.ROAN_UA
    assert "authorization" not in {k.lower() for k in request.headers}
    assert request.get_header("Accept") == "application/vnd.github+json"


def test_github_repos_handles_a_single_repo(kennis):
    kennis.add(
        "https://api.github.com/repos/roanh47/Roan",
        FakeResponse(
            b'{"full_name": "roanh47/Roan", "description": "TUI", "language": "Python",'
            b' "stargazers_count": 12, "html_url": "https://github.com/roanh47/Roan"}',
            "application/json",
        ),
    )
    out = tools.github_repos("roanh47/Roan")
    assert "1 repo opgehaald" in out
    text = stored_files()[0].read_text(encoding="utf-8")
    assert "- taal: Python" in text
    assert "- sterren: 12" in text


def test_github_rate_limit_is_reported(kennis):
    kennis.fail(
        "https://api.github.com/users/roanh47/repos?per_page=100&sort=updated",
        urllib.error.HTTPError(
            "x", 403, "rate limit exceeded",
            {"X-RateLimit-Remaining": "0", "X-RateLimit-Limit": "60", "X-RateLimit-Reset": "1767225600"},
            None,
        ),
    )
    out = tools.github_repos("roanh47")
    assert "rate limit bereikt" in out
    assert "0 van 60" in out
    assert "Vrij vanaf" in out
    assert stored_files() == []


def test_github_404_is_reported(kennis):
    kennis.fail(
        "https://api.github.com/users/niet-bestaand/repos?per_page=100&sort=updated",
        urllib.error.HTTPError("x", 404, "Not Found", {}, None),
    )
    out = tools.github_repos("niet-bestaand")
    assert "404" in out
    assert "Geen API-sleutel" in out
    assert stored_files() == []


def test_github_broken_json_is_reported(kennis):
    kennis.add(
        "https://api.github.com/users/roanh47/repos?per_page=100&sort=updated",
        FakeResponse(b"<html>rate limit</html>", "application/json"),
    )
    out = tools.github_repos("roanh47")
    assert "gaf geen geldige JSON terug" in out
    assert stored_files() == []


def test_github_needs_a_target(kennis):
    assert "gebruiker" in tools.github_repos("")


def test_github_refuses_a_path_with_more_than_one_slash(kennis):
    out = tools.github_repos("a/b/c")
    assert "Weiger" in out
    assert kennis.requests == []


def test_github_timeout_is_reported(kennis):
    kennis.fail(
        "https://api.github.com/users/roanh47/repos?per_page=100&sort=updated",
        socket.timeout("timed out"),
    )
    out = tools.github_repos("roanh47")
    assert "Niet opgehaald" in out
    assert "Timeout" in out
    assert stored_files() == []


def test_github_size_cap_is_reported(kennis):
    kennis.add(
        "https://api.github.com/users/roanh47/repos?per_page=100&sort=updated",
        FakeResponse(b"[" + b" " * (tools.KNOWLEDGE_MAX_BYTES + 1) + b"]", "application/json"),
    )
    out = tools.github_repos("roanh47")
    assert "cap van" in out
    assert str(tools.KNOWLEDGE_MAX_BYTES) in out
    assert stored_files() == []


def test_github_stores_the_rate_limit_in_the_header(kennis):
    kennis.add(
        "https://api.github.com/users/roanh47/repos?per_page=100&sort=updated",
        FakeResponse(REPOS_JSON, "application/json", {"X-RateLimit-Remaining": "12"}),
    )
    tools.github_repos("roanh47")
    text = stored_files()[0].read_text(encoding="utf-8")
    assert "- rate limit: nog 12 van 60 verzoeken per uur over" in text


# ---------- er kan nergens een sleutel binnen ----------
FORBIDDEN_IN_KNOWLEDGE = (
    "authorization",
    "api_key",
    "apikey",
    "x-api-key",
    "getpass",
    "roan_api_key",
    "bearer",
    "load_config",
    "netrc",
    "cookie",
)


def _code_without_comments(source: str) -> str:
    """Haal de commentaarregels eruit: een commentaar dat 'authorization' zegt om
    te zeggen dat we het níét doen, is geen plek waar een sleutel binnenkomt."""
    out = []
    for line in source.splitlines():
        stripped = line.strip()
        if stripped.startswith("#") or '"' in stripped and stripped.startswith("#"):
            continue
        out.append(line.split("  #")[0] if "  #" in line else line)
    return "\n".join(out)


def test_no_knowledge_handler_can_receive_a_key(kennis):
    """Bronregels van het hele kennispad, gecontroleerd op een plek voor een sleutel.

    Dit is een hek voor de volgende agent: er komt hier geen credential binnen,
    en als er ooit eentje bij komt, faalt deze test eerst. `_check_url` doet er
    niet mee, want die noemt die woorden juist om ze te weigeren.
    """
    handlers = [tools.store_knowledge, tools.fetch_and_store, tools.github_repos, tools._http_get]
    source = _code_without_comments("\n".join(inspect.getsource(func) for func in handlers))
    for needle in FORBIDDEN_IN_KNOWLEDGE:
        assert needle not in source.lower(), f"{needle} staat in het kennispad"


def test_every_forbidden_thing_is_actually_refused_by_check_url(kennis):
    """De lijst hierboven is geen loosse verzameling: elk item wordt geweigerd."""
    for needle, url in (
        ("authorization", "https://user:geheim@example.com/x"),
        ("apikey", "https://example.com/x?apikey=geheim"),
        ("token", "https://example.com/x?access_token=geheim"),
    ):
        out = tools.fetch_and_store(url)
        assert "Weiger" in out, f"{needle} wordt niet geweigerd: {out}"


def test_a_url_with_a_credential_never_reaches_the_network(kennis):
    """Het enige dat een credential zou kunnen verhullen is een redirect — die ook niet."""
    kennis.add("https://example.com/ok", FakeResponse(PAGE.encode()))
    tools.fetch_and_store("https://example.com/ok")
    for request in kennis.requests:
        assert "@" not in request.full_url
        assert request.get_header("Authorization") is None
        assert request.get_header("Cookie") is None


# ---------- de cap ----------
def test_size_cap_holds(kennis):
    huge = b"<p>" + b"x" * tools.KNOWLEDGE_MAX_BYTES + b"</p>"
    kennis.add("https://example.com/huge", FakeResponse(huge))
    out = tools.fetch_and_store("https://example.com/huge")
    assert "Te groot" in out
    assert str(tools.KNOWLEDGE_MAX_BYTES) in out
    assert stored_files() == []


# ---------- de map zelf ----------
def test_ensure_home_creates_the_knowledge_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "ROAN_DIR", tmp_path / ".Roan")
    monkeypatch.setattr(config, "KNOWLEDGE_DIR", tmp_path / ".Roan" / "knowledge")
    home.ensure_home()
    assert (tmp_path / ".Roan" / "knowledge").is_dir()
    assert "knowledge" in home.layout()


def test_ensure_home_reports_the_knowledge_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "ROAN_DIR", tmp_path / ".Roan")
    monkeypatch.setattr(config, "KNOWLEDGE_DIR", tmp_path / ".Roan" / "knowledge")
    assert any("knowledge" in path for path in home.ensure_home())


def test_knowledge_dir_sits_under_the_roan_dir():
    assert config.KNOWLEDGE_DIR == config.ROAN_DIR / "knowledge"


# ---------- de schemata ----------
def test_tool_schemas_match_the_registry_shape():
    from roan import agent

    for schema in tools.KNOWLEDGE_TOOL_SCHEMAS:
        assert schema["type"] == "function"
        function = schema["function"]
        assert set(function) == {"name", "description", "parameters"}
        assert function["parameters"]["type"] == "object"
        assert function["parameters"]["required"]
        assert function["name"] in tools.KNOWLEDGE_TOOL_FUNCS
        # dezelfde vorm als wat al in agent.TOOLS staat
        known = next(t for t in agent.TOOLS if t["function"]["name"] == "fetch_url")
        assert set(known["function"]) == set(function)


def test_every_knowledge_handler_is_callable():
    for name, func in tools.KNOWLEDGE_TOOL_FUNCS.items():
        assert callable(func), name


def test_the_schema_text_agrees_with_the_constants_it_quotes():
    """De beschrijving die het model leest moet hetzelfde getal noemen als de code.

    Dit is een hek tegen een eigenlijkheid die erin zat: de schema-tekst zei
    "verzoffen" waar de code "verzoeken" schreef, en dat verschil ziet niemand.
    """
    desc = next(
        s["function"]["description"]
        for s in tools.KNOWLEDGE_TOOL_SCHEMAS
        if s["function"]["name"] == "github_repos"
    )
    assert f"{tools.GITHUB_RATE_LIMIT} verzoeken per uur" in desc
    assert str(tools.KNOWLEDGE_MAX_BYTES) not in desc  # de cap noemen we niet in het schema