"""Zet het GitHub Project board op dat bij ideas.md hoort.

Het board heeft drie kolommen — To Do, Doing, Done — en de items komen uit de
backlog in ideas.md. ideas.md houdt het *waarom* bij, het board de *status*, zodat
die twee niet uit elkaar kunnen lopen.

Eenmalig nodig: het token moet de `project`-scope hebben.

    gh auth refresh -h github.com -s project

Daarna:

    python3 tests/project_board.py

Het script is herhaalbaar: bestaat het board al, dan vult het alleen de items aan
die nog ontbreken.
"""

from __future__ import annotations

import json
import subprocess
import sys

OWNER = "roanh47"
REPO = "roanh47/Roan"
TITLE = "Roan"
COLUMNS = ["To Do", "Doing", "Done"]

# (titel, korte omschrijving) — houd dit gelijk aan de secties in ideas.md.
ITEMS = [
    ("Roan doctor",
     "Eén commando dat config, bereikbaarheid van de provider, aanwezigheid van een key, "
     "bestaan van het model, terminalgrootte en alternate screen controleert."),
    ("Session search",
     "~/.Roan/sessions/ wordt alleen door het herstelpad gelezen. Zoeken over sessies heen "
     "maakt er geheugen van: /sessions --find <term>."),
    ("Split tui.py into roan/screens/",
     "Het grootste bestand van de package. Trigger uit architecture.md: boven ~2.500 regels "
     "de schermen eruit halen."),
    ("Token and cost accounting",
     "Sessies weten niet wat ze gekost hebben. Een usage-veld per beurt plus een totaal per "
     "sessie maakt betaalde providers vergelijkbaar met lokale."),
    ("A second channel",
     "BaseChannel is de naad en Telegram bewijst dat het werkt. Interessant is vooral welk "
     "kanaal zonder eigen server kan."),
    ("Vision",
     "photo.py tekent een afbeelding in halve blokken voor de terminal. Een afbeelding naar "
     "een model sturen dat kan zien is iets anders, en vooral een andere berichtvorm."),
    ("Cron improvements",
     "Echte cron-expressies, een --list, en de laatste uitvoer van een job kunnen zien. De "
     "poll van 30 seconden is prima; de zichtbaarheid niet."),
    ("Cost-aware routing",
     "Model per beurt kiezen op taak en prijs. Vraagt om eerlijke kwaliteitsdata per model "
     "die niemand heeft; waarschijnlijk blijft /model een handmatige keuze."),
    ("Plugins: wire up or delete",
     "~/.Roan/plugins/ staat in de layout en er wordt niets uit geladen. Of het werkt, of de "
     "map verdwijnt — een lege belofte in een gedocumenteerde layout is erger dan geen "
     "plugin-systeem."),
    ("Web UI",
     "Staat als volgende in de README. Botst met de enige harde eis (niets te hosten), tenzij "
     "hij lokaal draait, en dan is het vooral een slechtere TUI. Alleen doen met een echt "
     "gebruiksscenario."),
    ("Publishing under the name roan",
     "De naam is bezet op PyPI, dus dit is de PEP 541-procedure: maanden, en het kan geweigerd "
     "worden. Tot die tijd installeren vanaf de repository."),
]


def run(args: list[str], *, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(args, capture_output=True, text=True, check=check)


def scopes() -> set[str]:
    out = run(["gh", "api", "-i", "user"]).stdout
    for line in out.splitlines():
        if line.lower().startswith("x-oauth-scopes:"):
            return {s.strip() for s in line.split(":", 1)[1].split(",") if s.strip()}
    return set()


def graphql(query: str, variables: dict | None = None) -> dict:
    payload = json.dumps({"query": query, "variables": variables or {}})
    proc = subprocess.run(
        ["gh", "api", "graphql", "--input", "-"],
        input=payload, capture_output=True, text=True,
    )
    if proc.returncode != 0:
        raise SystemExit("GraphQL-mislukking:\n" + (proc.stderr or proc.stdout))
    data = json.loads(proc.stdout)
    if "errors" in data:
        raise SystemExit("GraphQL-fout:\n" + json.dumps(data["errors"], indent=2))
    return data.get("data", {})


def find_project() -> dict | None:
    proc = run(["gh", "project", "list", "--owner", OWNER, "--format", "json", "-L", "100"],
               check=False)
    if proc.returncode != 0:
        raise SystemExit("Kon de projecten niet lezen:\n" + proc.stderr.strip())
    for project in json.loads(proc.stdout or "{}").get("projects", []):
        if project.get("title") == TITLE:
            return project
    return None


def create_project() -> dict:
    proc = run(["gh", "project", "create", "--owner", OWNER, "--title", TITLE,
                "--format", "json"], check=False)
    if proc.returncode != 0:
        raise SystemExit("Kon het board niet aanmaken:\n" + proc.stderr.strip())
    return json.loads(proc.stdout)


def project_id(number: int) -> str:
    data = graphql(
        "query($owner:String!,$number:Int!){user(login:$owner)"
        "{projectV2(number:$number){id}}}",
        {"owner": OWNER, "number": number},
    )
    return data["user"]["projectV2"]["id"]


def status_field(number: int) -> tuple[str, list[str]]:
    data = graphql(
        "query($owner:String!,$number:Int!){user(login:$owner)"
        "{projectV2(number:$number){field(name:\"Status\")"
        "{... on ProjectV2SingleSelectField{id options{name}}}}}}",
        {"owner": OWNER, "number": number},
    )
    field = data["user"]["projectV2"]["field"]
    if not field:
        raise SystemExit("Geen Status-veld gevonden op het board.")
    return field["id"], [o["name"] for o in field.get("options", [])]


def set_columns(field_id: str) -> None:
    options = [{"name": name, "color": colour, "description": ""}
               for name, colour in zip(COLUMNS, ("GRAY", "YELLOW", "GREEN"))]
    graphql(
        "mutation($fieldId:ID!,$options:[ProjectV2SingleSelectFieldOptionInput!]!)"
        "{updateProjectV2Field(input:{fieldId:$fieldId,singleSelectOptions:$options})"
        "{projectV2Field{... on ProjectV2SingleSelectField{name options{name}}}}}",
        {"fieldId": field_id, "options": options},
    )


def existing_items(number: int) -> set[str]:
    proc = run(["gh", "project", "item-list", str(number), "--owner", OWNER,
                "--format", "json", "-L", "200"], check=False)
    if proc.returncode != 0:
        return set()
    try:
        items = json.loads(proc.stdout or "{}").get("items", [])
    except json.JSONDecodeError:
        return set()
    return {i.get("title") or (i.get("content") or {}).get("title", "") for i in items}


def main() -> int:
    have = scopes()
    if have and "project" not in have and "read:project" not in have:
        print("Het token mist de 'project'-scope, dus het board kan niet aangemaakt worden.\n")
        print("  gh auth refresh -h github.com -s project\n")
        print("Daarna opnieuw: python3 tests/project_board.py")
        print(f"\nHuidige scopes: {', '.join(sorted(have)) or 'onbekend'}")
        return 2

    project = find_project()
    if project:
        number = project["number"]
        print(f"Board bestaat al: {project.get('url')}")
    else:
        project = create_project()
        number = project["number"]
        print(f"Board aangemaakt: {project.get('url')}")

    field_id, current = status_field(number)
    if current != COLUMNS:
        set_columns(field_id)
        print(f"Kolommen gezet: {' / '.join(COLUMNS)} (was: {', '.join(current)})")
    else:
        print(f"Kolommen staan al goed: {' / '.join(COLUMNS)}")

    run(["gh", "project", "link", str(number), "--owner", OWNER, "--repo", REPO], check=False)
    print(f"Gekoppeld aan {REPO}")

    known = existing_items(number)
    added = 0
    for title, body in ITEMS:
        if title in known:
            continue
        proc = run(["gh", "project", "item-create", str(number), "--owner", OWNER,
                    "--title", title, "--body", body], check=False)
        if proc.returncode != 0:
            print("  ! niet toegevoegd:", title, "-", proc.stderr.strip()[:120])
            continue
        added += 1
    print(f"Items toegevoegd: {added} (stonden er al: {len(known)})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
