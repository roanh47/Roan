"""De schrijfstijl: één document, hier in de repo, met GitHub als upstream.

De agent hoort altijd in de schrijfstijl van Roan te praten, dus de nieuwste
versie van het document moet elke keer mee. Die nieuwste versie mag niet
afhangen van een nieuwe Roan-release: het document staat daarom in deze repo
(`roan/skills/roan-writing-style/SKILL.md`), wordt bij het starten naar
`~/.Roan/skills/` gekopieerd zodra de repo nieuwer is, en Roan probeert het één
keer per etmaal van GitHub te halen.

Lukt dat niet, dan blijft de laatst opgehaalde versie staan met een zichtbare
aantekening dat hij niet gecontroleerd is. Nooit stilzwijgend terugvallen op een
oudere versie: dan lijkt de stijl toegepast en is hij dat niet.

Wat waar staat:

    deze repo                        de versie die met deze Roan meekomt
    GitHub (raw)                     de upstream, zodat een nieuwere stijl
                                     werkt zonder een nieuwe release
    ~/.Roan/skills/<naam>/SKILL.md   wat de agent echt in de prompt krijgt
    ~/.Roan/writing-style.json       wat er opgehaald is, en wanneer
"""

from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

from . import __version__, config

STYLE_NAME = "roan-writing-style"

# De raw-URL van het document in deze repo. `ROAN_STYLE_URL` gaat hier overheen,
# bijvoorbeeld om vanaf een andere branch of een mirror te halen.
DEFAULT_SOURCE = (
    "https://raw.githubusercontent.com/roanh47/Roan/pre-release/"
    f"roan/skills/{STYLE_NAME}/SKILL.md"
)

# Eén keer per etmaal controleren is genoeg: de stijl verandert niet per minuut,
# en elke start op het netwerk wachten is erger dan een dag oud zijn. Binnen die
# tijd geldt de versie als gecontroleerd.
CHECK_INTERVAL = 24 * 60 * 60
FETCH_TIMEOUT = 3.0

VERSION_RE = re.compile(r"^version:\s*(\S+)\s*$", re.M)


def bundled_path() -> Path:
    """Het document zoals het met deze Roan meekomt."""
    return Path(__file__).resolve().parent / "skills" / STYLE_NAME / "SKILL.md"


def installed_path() -> Path:
    """Het document dat de agent echt in de prompt krijgt."""
    return config.SKILLS_DIR / STYLE_NAME / "SKILL.md"


def state_path() -> Path:
    """Waar Roan vastlegt welke versie er opgehaald is, en wanneer."""
    return config.ROAN_DIR / "writing-style.json"


def offline() -> bool:
    """`ROAN_NO_NETWORK=1` houdt het ophalen tegen; de cache blijft staan."""
    return bool(os.environ.get("ROAN_NO_NETWORK", "").strip())


def source_url() -> str:
    """De upstream; `ROAN_STYLE_URL` gaat vóór de ingebouwde URL."""
    return (os.environ.get("ROAN_STYLE_URL") or "").strip() or DEFAULT_SOURCE


def version_of(text: str) -> str:
    """De `version:` uit de frontmatter, of "" als het document er geen heeft."""
    match = VERSION_RE.search(text or "")
    return match.group(1).strip() if match else ""


def _parts(version: str) -> tuple[int, int, int]:
    """`3.10.1` als drie getallen, zodat 3.10 nieuwer is dan 3.9.

    Zonder dit vergelijkt Python tekst, en dan komt `3.10` vóór `3.9` uit.
    """
    delen: list[int] = []
    for stuk in str(version or "").split(".")[:3]:
        cijfers = "".join(teken for teken in stuk if teken.isdigit())
        delen.append(int(cijfers) if cijfers else 0)
    while len(delen) < 3:
        delen.append(0)
    return delen[0], delen[1], delen[2]


def is_newer(kandidaat: str, huidig: str) -> bool:
    """True als `kandidaat` nieuwer is dan `huidig`; leeg telt als onbekend."""
    if not kandidaat:
        return False
    if not huidig:
        return True
    return _parts(kandidaat) > _parts(huidig)


def read_installed() -> str:
    """Wat er nu klaarstaat, of "" als er nog niets staat."""
    try:
        return installed_path().read_text(encoding="utf-8")
    except OSError:
        return ""


def installed_version() -> str:
    return version_of(read_installed())


def bundled_version() -> str:
    try:
        return version_of(bundled_path().read_text(encoding="utf-8"))
    except OSError:
        return ""


def install(text: str) -> bool:
    """Schrijf het document naar de thuismap; False als dat niet lukt."""
    if not text:
        return False
    pad = installed_path()
    try:
        pad.parent.mkdir(parents=True, exist_ok=True)
        pad.write_text(text, encoding="utf-8")
    except OSError:
        return False
    return True


def install_bundled() -> bool:
    """Zet de versie uit de repo klaar als die nieuwer is dan wat er staat."""
    try:
        tekst = bundled_path().read_text(encoding="utf-8")
    except OSError:
        return False
    if not is_newer(version_of(tekst), installed_version()):
        return False
    return install(tekst)


def read_state() -> dict:
    """Wat er in `writing-style.json` staat; {} als het er niet is."""
    try:
        staat = json.loads(state_path().read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return staat if isinstance(staat, dict) else {}


def write_state(staat: dict) -> None:
    """Leg de stand vast voor diagnose; een thuismap zonder schijf is geen fout."""
    try:
        state_path().parent.mkdir(parents=True, exist_ok=True)
        state_path().write_text(json.dumps(staat, indent=2), encoding="utf-8")
    except OSError:
        pass


def fetch(url: str | None = None, timeout: float = FETCH_TIMEOUT) -> str | None:
    """Haal het document op; None als het niet lukt.

    Geen netwerk, een 404 of een timeout is geen uitzondering om te laten
    knallen: het is de normale gang van zaken op een laptop zonder bereik, en de
    aanroeper hoort te weten dat er niets opgehaald is.
    """
    verzoek = urllib.request.Request(
        url or source_url(),
        headers={"User-Agent": f"Roan/{__version__}"},
    )
    try:
        with urllib.request.urlopen(verzoek, timeout=timeout) as antwoord:
            tekst = antwoord.read().decode("utf-8", "replace")
    except (urllib.error.URLError, OSError, TimeoutError, ValueError):
        return None
    return tekst or None


def status(now: float | None = None) -> dict:
    """De stand van de stijl: welke versie, waar vandaan, en of hij gecontroleerd is.

    `stale` is True zodra de laatste geslaagde controle ouder is dan
    `CHECK_INTERVAL`, of er nooit een was. Dat is de enige eerlijke uitkomst
    zonder netwerk: de kopie blijft werken, maar niemand mag denken dat hij
    actueel is.
    """
    nu = time.time() if now is None else float(now)
    staat = read_state()
    gecontroleerd = float(staat.get("checked_at") or 0)
    leeftijd = (nu - gecontroleerd) if gecontroleerd else None
    ok = bool(staat.get("ok"))
    return {
        "name": STYLE_NAME,
        "version": installed_version(),
        "bundled_version": bundled_version(),
        "installed": installed_path().exists(),
        "source": staat.get("source") or source_url(),
        "checked_at": gecontroleerd,
        "age": leeftijd or 0.0,
        "ok": ok,
        "stale": (not ok) or leeftijd is None or leeftijd > CHECK_INTERVAL,
        "offline": offline(),
    }


def sync(
    force: bool = False,
    net: bool = True,
    fetch_fn=None,
    now: float | None = None,
) -> dict:
    """Zorg dat de nieuwste versie klaarstaat en leg vast wat er gebeurd is.

    `net=False` (of `ROAN_NO_NETWORK`) slaat het ophalen over maar laat de
    administratie kloppen; `fetch_fn` is er voor de tests, zodat die nooit het
    netwerk op gaan.
    """
    nu = time.time() if now is None else float(now)
    bijgewerkt = install_bundled()
    staat = read_state()

    gecontroleerd = float(staat.get("checked_at") or 0)
    te_oud = (nu - gecontroleerd) > CHECK_INTERVAL
    mag_halen = bool(net) and not offline() and (bool(force) or te_oud)

    opgehaald: str | None = None
    mislukt = False
    if mag_halen:
        tekst = (fetch_fn or fetch)()
        if tekst:
            opgehaald = version_of(tekst)
            if is_newer(opgehaald, installed_version()):
                bijgewerkt = install(tekst) or bijgewerkt
            staat.update(
                {
                    "checked_at": nu,
                    "ok": True,
                    "source": source_url(),
                    "fetched_version": opgehaald,
                }
            )
        else:
            mislukt = True
            staat.update({"ok": False, "source": source_url()})
        write_state(staat)

    stand = status(now=nu)
    stand["updated"] = bijgewerkt
    stand["fetched"] = mag_halen and opgehaald is not None
    stand["failed"] = mislukt
    return stand
