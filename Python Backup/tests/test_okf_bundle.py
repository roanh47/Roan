"""De kennisbundel moet conform blijven: elke regel, elke keer.

De bundel is deze repository. De drie regels uit de OKF-spec (v0.2, §11) worden
gecontroleerd door het script dat in tests/ staat, zodat er één implementatie is
en niet twee.
"""

import importlib.util
import re
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
VALIDATOR = REPO / "tests" / "validate_okf.py"
# De repo is de bundel; de validator staat er zelf in.
BUNDLE = REPO


def _load_validator():
    spec = importlib.util.spec_from_file_location("validate_okf", VALIDATOR)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def okf():
    return _load_validator()


def test_validator_script_exists():
    assert VALIDATOR.exists(), "de validator hoort in tests/ te staan"


def test_bundle_is_conformant(okf):
    problems = okf.check(BUNDLE)
    assert problems == [], "OKF-bundel niet conform:\n  " + "\n  ".join(problems)


def test_root_index_declares_the_version(okf):
    raw = (BUNDLE / "index.md").read_text(encoding="utf-8")
    front, _ = okf.split_frontmatter(raw)
    assert front is not None, "de root-index hoort frontmatter met okf_version te hebben"
    assert "okf_version" in front


def test_every_concept_has_a_type(okf):
    missing = []
    for path in okf.markdown_files(BUNDLE):
        if path.name in okf.RESERVED:
            continue
        front, _ = okf.split_frontmatter(path.read_text(encoding="utf-8"))
        if front is None or not okf.parse_yaml(front).get("type"):
            missing.append(str(path.relative_to(BUNDLE)))
    assert missing == [], f"zonder 'type': {missing}"


def test_no_orphan_pages(okf):
    """Elke pagina moet ergens vandaan gelinkt worden, anders vindt niemand hem."""
    linked = set()
    for path in okf.markdown_files(BUNDLE):
        for target in re.findall(r"\]\(([^)#\s]+)\)", path.read_text(encoding="utf-8")):
            if target.startswith(("http://", "https://", "mailto:")):
                continue
            linked.add((path.parent / target).resolve())
    orphans = [
        str(p.relative_to(BUNDLE))
        for p in okf.markdown_files(BUNDLE)
        if p.name not in okf.RESERVED and p.resolve() not in linked
    ]
    assert orphans == [], f"niet gelinkt vanaf een index: {orphans}"


def test_the_bundle_is_the_repository(okf):
    """Geen aparte documentatiemap: de concepten wonen naast de code."""
    stray = [d for d in ("knowledge", "okf", "docs") if (BUNDLE / d).exists()]
    assert stray == [], f"de bundel hoort geen eigen map te hebben, gevonden: {stray}"
    for expected in ("index.md", "log.md", "roan/index.md", "tests/index.md"):
        assert (BUNDLE / expected).exists(), f"{expected} ontbreekt"


def test_agents_md_points_at_the_bundle():
    """OpenCode leest AGENTS.md; die moet naar de bundel verwijzen.

    Het bestand staat niet in de repo (het is een beschermd agent-bestand dat de
    gebruiker zelf toevoegt), dus als het ontbreekt is dat geen fout.
    """
    path = REPO / "AGENTS.md"
    if not path.exists():
        pytest.skip("AGENTS.md is nog niet toegevoegd")
    text = path.read_text(encoding="utf-8")
    assert "index.md" in text
    assert "validate_okf.py" in text


def test_readme_points_at_the_bundle():
    text = (REPO / "README.md").read_text(encoding="utf-8")
    assert "index.md" in text, "de README hoort de kennisbundel te noemen"
    assert "validate_okf.py" in text


def test_file_map_lists_every_module(okf):
    """Een nieuw bestand moet in de file map staan, anders vindt niemand het.

    Regelnummers worden bewust niet vergeleken - die lopen bij elke wijziging, en
    daarvoor is generate_file_map.py.
    """
    text = (BUNDLE / "file-map.md").read_text(encoding="utf-8")
    missing = [
        str(p.relative_to(REPO))
        for pattern in ("roan/**/*.py", "tests/*.py")
        for p in sorted(REPO.glob(pattern))
        if str(p.relative_to(REPO)) not in text
    ]
    assert missing == [], f"niet in de file map: {missing}"


def test_board_items_match_the_backlog():
    """Elk item op het board moet een kop in ideas.md hebben.

    ideas.md houdt het waarom bij, het board de status. Als ze uit elkaar lopen
    klopt een van de twee niet meer, dus dat mag niet stil gebeuren.
    """
    spec = importlib.util.spec_from_file_location("project_board", REPO / "tests" / "project_board.py")
    assert spec is not None and spec.loader is not None
    board = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(board)

    body = re.sub(r"[^a-z0-9]", "", (REPO / "ideas.md").read_text(encoding="utf-8").lower())
    missing = [
        title
        for title, _ in board.ITEMS
        if re.sub(r"[^a-z0-9]", "", title.lower()) not in body
    ]
    assert missing == [], f"wel op het board, niet in ideas.md: {missing}"
    assert board.COLUMNS == ["To Do", "Doing", "Done"]


def test_project_board_script_reports_a_missing_scope():
    """Zonder de project-scope moet het script dat zeggen, niet stuklopen."""
    text = (REPO / "tests" / "project_board.py").read_text(encoding="utf-8")
    assert "gh auth refresh" in text
    assert "-s project" in text
