"""De schrijfstijl: uit de repo, bijgehouden van GitHub, nooit stil verouderd.

De agent hoort altijd in Roans stijl te schrijven, dus het document moet de
nieuwste versie zijn. Deze tests gaan niet het netwerk op: `sync(fetch_fn=...)`
krijgt een nep-ophaler mee. Dat is precies het punt — een test die van GitHub
afhangt is morgen rood zonder dat er iets stuk is.
"""

import json

import pytest

from roan import config, style

STIJL = """---
type: Reference
name: roan-writing-style
description: testversie
version: {versie}
always: true
---

# Stijl

Zinnen blijven kort.
"""


@pytest.fixture
def thuis(tmp_path, monkeypatch):
    """Een lege thuismap plus een nagebootst document in de repo."""
    monkeypatch.setattr(config, "ROAN_DIR", tmp_path)
    monkeypatch.setattr(config, "SKILLS_DIR", tmp_path / "skills")
    meegeleverd = tmp_path / "repo-SKILL.md"
    meegeleverd.write_text(STIJL.format(versie="3.0.0"), encoding="utf-8")
    monkeypatch.setattr(style, "bundled_path", lambda: meegeleverd)
    monkeypatch.delenv("ROAN_NO_NETWORK", raising=False)
    monkeypatch.delenv("ROAN_STYLE_URL", raising=False)
    return tmp_path


def test_the_bundled_document_lands_in_the_home(thuis):
    """Wat met de repo meekomt staat na één sync klaar voor de agent."""
    stand = style.sync(net=False)
    assert stand["updated"] is True
    assert stand["installed"] is True
    assert stand["version"] == "3.0.0"
    assert style.installed_path().read_text(encoding="utf-8").startswith("---")


def test_a_newer_version_from_github_replaces_the_copy(thuis):
    """Een nieuwere stijl werkt zonder nieuwe Roan-release."""
    stand = style.sync(force=True, fetch_fn=lambda: STIJL.format(versie="4.1.0"), now=1000.0)
    assert stand["fetched"] is True
    assert stand["version"] == "4.1.0"
    assert style.installed_version() == "4.1.0"
    assert stand["stale"] is False
    staat = json.loads(style.state_path().read_text(encoding="utf-8"))
    assert staat["fetched_version"] == "4.1.0"
    assert staat["source"].startswith("https://")
    assert staat["checked_at"] == 1000.0


def test_within_the_interval_roan_does_not_call_out(thuis):
    """Eén controle per etmaal is genoeg; daarbinnen blijft het stil."""
    style.sync(force=True, fetch_fn=lambda: STIJL.format(versie="4.1.0"), now=1000.0)

    def nooit(_url=None, timeout=None):
        raise AssertionError("binnen het etmaal mag er niets opgehaald worden")

    stand = style.sync(fetch_fn=nooit, now=1000.0 + 3600.0)
    assert stand["fetched"] is False
    assert stand["version"] == "4.1.0"
    assert stand["stale"] is False


def test_an_older_version_from_github_does_not_downgrade(thuis):
    """Wat er staat blijft staan als de upstream ouder is."""
    style.sync(force=True, fetch_fn=lambda: STIJL.format(versie="4.1.0"), now=1000.0)
    style.sync(force=True, fetch_fn=lambda: STIJL.format(versie="3.9.0"), now=2000.0)
    assert style.installed_version() == "4.1.0"


def test_a_failed_fetch_keeps_the_copy_and_says_so(thuis):
    """Zonder netwerk blijft de cache werken, met een zichtbare aantekening."""
    style.sync(force=True, fetch_fn=lambda: STIJL.format(versie="4.1.0"), now=1000.0)
    twee_dagen_later = 1000.0 + 2 * style.CHECK_INTERVAL
    stand = style.sync(force=True, fetch_fn=lambda: None, now=twee_dagen_later)
    assert stand["failed"] is True
    assert stand["version"] == "4.1.0", "de laatst opgehaalde versie blijft"
    assert stand["stale"] is True, "en dat is te zien, niet stil"


def test_the_offline_switch_keeps_roan_from_calling_out(thuis, monkeypatch):
    """`ROAN_NO_NETWORK=1` betekent: geen poging, wel eerlijk verouderd."""
    monkeypatch.setenv("ROAN_NO_NETWORK", "1")

    def nooit(_url=None, timeout=None):
        raise AssertionError("er mag niets opgehaald worden")

    stand = style.sync(fetch_fn=nooit, force=True)
    assert stand["offline"] is True
    assert stand["version"] == "3.0.0", "de versie uit de repo staat wel klaar"
    assert stand["stale"] is True


def test_an_empty_home_has_nothing_and_says_so(thuis):
    stand = style.status(now=1000.0)
    assert stand["installed"] is False
    assert stand["version"] == ""
    assert stand["stale"] is True


def test_versions_compare_as_numbers():
    assert style.is_newer("3.10.0", "3.9.0") is True
    assert style.is_newer("3.0.0", "3.0.0") is False
    assert style.is_newer("", "3.0.0") is False
    assert style.is_newer("3.0.1", "") is True
    assert style.version_of("---\nversion: 7.2.1\n---\n# kop") == "7.2.1"
    assert style.version_of("geen frontmatter") == ""


def test_the_upstream_is_the_document_in_this_repo():
    """De bron staat in de repo, dus een nieuwere stijl vraagt geen release."""
    from pathlib import Path

    assert style.STYLE_NAME == "roan-writing-style"
    assert style.DEFAULT_SOURCE.endswith(f"roan/skills/{style.STYLE_NAME}/SKILL.md")
    assert Path(style.bundled_path()).exists(), "het document hoort in de repo te staan"


def test_the_style_ends_up_in_the_prompt(thuis):
    """Na een sync staat de stijl waar de agent hem leest."""
    from roan import skills

    style.sync(net=False)
    prompt = skills.skills_prompt()
    assert "Zinnen blijven kort." in prompt
