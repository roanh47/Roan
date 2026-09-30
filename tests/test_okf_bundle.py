"""De OKF-bundle moet conform blijven: elke regel, elke keer.

De drie regels uit de spec (v0.2, §11) worden gecontroleerd door het script dat
in de bundle zelf staat, zodat er één implementatie is en niet twee.
"""

import importlib.util
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
VALIDATOR = REPO / "knowledge" / "references" / "validate_okf.py"
# Eén plek die weet waar de bundel staat; de rest leidt het daarvan af.
BUNDLE = VALIDATOR.parent.parent


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
    assert VALIDATOR.exists(), "de validator hoort in knowledge/references/ te staan"


def test_bundle_is_conformant(okf):
    problems = okf.check(BUNDLE)
    assert problems == [], "OKF-bundle niet conform:\n  " + "\n  ".join(problems)


def test_root_index_declares_the_version(okf):
    raw = (BUNDLE / "index.md").read_text(encoding="utf-8")
    front, _ = okf.split_frontmatter(raw)
    assert front is not None, "de root-index hoort frontmatter met okf_version te hebben"
    assert "okf_version" in front


def test_every_concept_has_a_type(okf):
    bundle = BUNDLE
    missing = []
    for path in sorted(bundle.rglob("*.md")):
        if path.name in okf.RESERVED:
            continue
        front, _ = okf.split_frontmatter(path.read_text(encoding="utf-8"))
        if front is None or not okf.parse_yaml(front).get("type"):
            missing.append(str(path.relative_to(bundle)))
    assert missing == [], f"zonder 'type': {missing}"


def test_no_orphan_pages(okf):
    """Elke pagina moet ergens vandaan gelinkt worden, anders vindt niemand hem."""
    import re

    bundle = BUNDLE
    linked = set()
    for path in bundle.rglob("*.md"):
        for target in re.findall(r"\]\(([^)#\s]+)\)", path.read_text(encoding="utf-8")):
            if target.startswith(("http://", "https://", "mailto:")):
                continue
            linked.add((path.parent / target).resolve())
    orphans = [
        str(p.relative_to(bundle))
        for p in sorted(bundle.rglob("*.md"))
        if p.name not in okf.RESERVED and p.resolve() not in linked
    ]
    assert orphans == [], f"niet gelinkt vanaf een index: {orphans}"


def test_agents_md_points_at_the_bundle():
    """OpenCode leest AGENTS.md; die moet naar de bundle verwijzen.

    Het bestand staat niet in de repo (het is een beschermd agent-bestand dat de
    gebruiker zelf toevoegt), dus als het ontbreekt is dat geen fout.
    """
    path = REPO / "AGENTS.md"
    if not path.exists():
        pytest.skip("AGENTS.md is nog niet toegevoegd")
    text = path.read_text(encoding="utf-8")
    assert "knowledge/index.md" in text
    assert "validate_okf.py" in text


def test_readme_points_at_the_bundle():
    text = (REPO / "README.md").read_text(encoding="utf-8")
    assert "knowledge/" in text, "de README hoort de knowledge bundle te noemen"


def test_file_map_lists_every_module():
    """Een nieuw bestand moet in de file map staan, anders vindt niemand het.

    Regelnummers worden bewust niet vergeleken - die lopen bij elke wijziging, en
    daarvoor is generate_file_map.py.
    """
    text = (BUNDLE / "references" / "file-map.md").read_text(encoding="utf-8")
    missing = [
        str(p.relative_to(REPO))
        for pattern in ("roan/**/*.py", "tests/*.py")
        for p in sorted(REPO.glob(pattern))
        if str(p.relative_to(REPO)) not in text
    ]
    assert missing == [], f"niet in de file map: {missing}"
