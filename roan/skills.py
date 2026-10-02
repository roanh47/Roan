"""Skills: herbruikbare instructie-bestanden in ~/.Roan/skills/.

Een skill is markdown met optionele frontmatter:

    ---
    name: deploy
    description: Hoe je een release uitbrengt
    ---
    Stap 1 ...

Twee vormen worden gelezen: losse `*.md` in de skills-map, en
`<naam>/SKILL.md` voor een skill per onderwerp.

Zonder de vlag `always` ziet de agent alleen naam + beschrijving in de
system-prompt en haalt de volledige tekst op met de `read_skill`-tool. Dat is
goedkoop, maar betekent wel dat een regel in de body pas werkt als de model toevallig
`read_skill` aanroept.

Met `always: true` wordt de **hele body** bij elke aanvraag in de system-prompt
gezet, onder een eigen kop die het bindend maakt. Dat is voor regels die altijd
moeten gelden, zoals een schrijfstijl. Het is een opt-in: zonder de vlag blijft
alles zoals het was, dus niets wordt traag vanzelf.

    ---
    name: roan-writing-style
    description: De schrijfstijl van Roan
    always: true
    ---
    ## Schrijfstijl
    - Nooit beginnen met "Zeker".

Een always-skill wordt afgekapt boven `MAX_ALWAYS_CHARS`, en boven
`MAX_ALWAYS_TOTAL` vallen er skills weg. Dat staat dan zichtbaar in de prompt,
met de reden en de naam, en `always_warnings()` geeft dezelfde melding terug aan
het `/skills`-scherm — een stijlgids dat je stilzwijgend inkort is erger dan geen
stijlgids.
"""

from __future__ import annotations

import re
from pathlib import Path

from . import config

# Kop en bindende regel voor de altijd-actieve skills.
ALWAYS_HEADING = "[Schrijfstijl — altijd van toepassing]"
ALWAYS_LEAD = (
    "Deze regels gelden voor ELK bericht dat je schrijft. Ze zijn geen suggestie "
    "en geen samenvatting van een optie: volg ze."
)

# Limieten voor always-skills: per skill, en voor alle bij elkaar.
MAX_ALWAYS_CHARS = 4_000
MAX_ALWAYS_TOTAL = 12_000

# Wat `always: true` mag schrijven.
TRUTHY = {"true", "yes", "1", "on", "ja"}

FRONTMATTER_RE = r"^---\s*\n(.*?)\n---\s*\n?(.*)$"


def skills_dir() -> Path:
    """De skills-map (lazy, zodat tests hem kunnen isoleren)."""
    return config.SKILLS_DIR


def parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    """(frontmatter als dict, body) uit de inhoud van een skill-bestand."""
    match = re.match(FRONTMATTER_RE, text, re.S)
    if not match:
        return {}, text
    front: dict[str, str] = {}
    for line in match.group(1).splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            front[key.strip().lower()] = value.strip().strip("\"'")
    return front, match.group(2)


def is_always(front: dict[str, str]) -> bool:
    """True als de frontmatter `always: true` zegt (ook `yes`/`1`/`on`/`ja`)."""
    return str(front.get("always", "")).strip().lower() in TRUTHY


def parse_skill(text: str) -> tuple[str, str, str]:
    """(name, description, body) uit de inhoud van een skill-bestand."""
    front, body = parse_frontmatter(text)
    name = front.get("name", "")
    description = front.get("description", "")
    if not name:
        heading = re.search(r"^#\s+(.+)$", body, re.M)
        name = heading.group(1).strip() if heading else ""
    if not description:
        for line in body.splitlines():
            line = line.strip()
            if line and not line.startswith("#"):
                description = line[:160]
                break
    return name, description, body.strip()


def skill_paths(target: Path) -> list[Path]:
    """Alle skill-bestanden: losse `*.md` plus `<naam>/SKILL.md` per onderwerp."""
    paths = sorted(target.glob("*.md"))
    try:
        folders = sorted(p for p in target.iterdir() if p.is_dir())
    except OSError:
        folders = []
    for folder in folders:
        candidate = folder / "SKILL.md"
        if candidate.is_file():
            paths.append(candidate)
    return paths


def load_skills(directory: Path | None = None) -> list[dict]:
    """Alle skills als dicts met name/description/body/always/path."""
    target = directory or skills_dir()
    if not target.exists():
        return []
    out: list[dict] = []
    for path in skill_paths(target):
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        front, _ = parse_frontmatter(text)
        name, description, body = parse_skill(text)
        out.append(
            {
                "name": name or path.stem,
                "description": description,
                "body": body,
                "always": is_always(front),
                "path": str(path),
            }
        )
    return out


def get_skill(name: str, directory: Path | None = None) -> dict | None:
    for skill in load_skills(directory):
        if skill["name"].lower() == (name or "").lower():
            return skill
    return None


def _clip(body: str, limit: int, name: str) -> str:
    """Snijd `body` op `limit` af, maar zeg zichtbaar dát en waarom."""
    if len(body) <= limit:
        return body
    return (
        f"{body[:limit].rstrip()}\n"
        f"[… afgekapt: deze skill is {len(body)} tekens lang, {limit} meegestuurd. "
        f'Haal de rest op met read_skill("{name}").]'
    )


def _walk_always(skills: list[dict]):
    """Loop de always-skills langs het budget: `(skill, body, reden)`.

    Eén plek die bepaalt wat er meegaat, zodat de prompt en de melding in het
    `/skills`-scherm nooit tegen elkaar in kunnen lopen. `reden` is `""`,
    `"afgekapt"` of `"weggelaten"`.
    """
    budget = MAX_ALWAYS_TOTAL
    for skill in skills:
        body = str(skill.get("body") or "").strip()
        limit = min(MAX_ALWAYS_CHARS, budget)
        if limit <= 0:
            yield skill, "", "weggelaten"
            continue
        clipped = _clip(body, limit, skill["name"])
        if len(clipped) > budget:
            yield skill, "", "weggelaten"
            continue
        budget -= len(clipped)
        yield skill, clipped, ("afgekapt" if len(clipped) != len(body) else "")


def always_skills_prompt(skills: list[dict]) -> str:
    """De volledige body van elke `always: true`-skill, als één bindend blok.

    Het blok komt vóór de lijst met losse skills, zodat het in de prompt vooral
    opvalt. Afkappen gebeurt nooit stil: er staat welke regel is afgekapt, hoe
    lang de skill is, en hoe de rest op te halen is.
    """
    lines = ["", ALWAYS_HEADING, ALWAYS_LEAD]
    dropped: list[str] = []
    for skill, body, reason in _walk_always(skills):
        if reason == "weggelaten":
            dropped.append(skill["name"])
            continue
        lines += ["", f"### {skill['name']}", body]
    if dropped:
        lines += [
            "",
            f"[NIET meegestuurd: {', '.join(dropped)}. Het totaalbudget van "
            f"{MAX_ALWAYS_TOTAL} tekens voor always-skills is op. Zet `always: false` "
            f"en haal deze skills op met read_skill(name), of verklein ze.]",
        ]
    return "\n".join(lines)


def always_warnings(skills: list[dict]) -> dict[str, str]:
    """`{skillnaam: reden}` voor always-skills die niet volledig meegaan.

    De prompt zegt het tegen het model; dit zegt het tegen de gebruiker, in het
    `/skills`-scherm. Een stijlgids die voor de helft is afgekapt mag niet
    stilzwijgend half werken.
    """
    out: dict[str, str] = {}
    for skill, _body, reason in _walk_always(skills):
        if not reason:
            continue
        if reason == "afgekapt":
            out[skill["name"]] = (
                f"⚠ afgekapt op {MAX_ALWAYS_CHARS} tekens — de rest lees je met "
                f'read_skill("{skill["name"]}").'
            )
        else:
            out[skill["name"]] = (
                f"⚠ niet meegestuurd: het totaalbudget van {MAX_ALWAYS_TOTAL} "
                "tekens voor always-skills is op."
            )
    return out


def skills_prompt(directory: Path | None = None) -> str:
    """Skills in de system-prompt: altijd-actieve bodies, anders de korte lijst."""
    skills = load_skills(directory)
    if not skills:
        return ""
    parts: list[str] = []
    always = [s for s in skills if s["always"]]
    if always:
        parts.append(always_skills_prompt(always))
    loose = [s for s in skills if not s["always"]]
    if loose:
        lines = ["", "[Beschikbare skills — gebruik read_skill(name) voor de volledige inhoud]"]
        for skill in loose:
            lines.append(f"- {skill['name']}: {skill['description']}")
        parts.append("\n".join(lines))
    return "\n\n".join(parts)


def skills_list_text(directory: Path | None = None) -> str:
    """Markdown-overzicht voor het /skills-commando."""
    skills = load_skills(directory)
    if not skills:
        return f"Nog geen skills. Zet .md-bestanden in `{skills_dir()}`."
    lines = [f"**Skills ({len(skills)})**", ""]
    for skill in skills:
        mark = " — altijd aan" if skill["always"] else ""
        lines.append(f"- **{skill['name']}**{mark} — {skill['description']}")
    return "\n".join(lines)
