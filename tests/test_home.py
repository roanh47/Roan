"""Tests voor de ~/.Roan-map, skills, cron en het gebruikersprofiel."""

import time

import pytest

from roan import config, cron, home, skills


@pytest.fixture
def roan_home(tmp_path, monkeypatch):
    """Isoleer de hele ~/.Roan-map naar tmp_path."""
    monkeypatch.setattr(config, "ROAN_DIR", tmp_path)
    monkeypatch.setattr(config, "CONFIG_PATH", tmp_path / "config.json")
    monkeypatch.setattr(config, "MEMORY_PATH", tmp_path / "memory.md")
    monkeypatch.setattr(config, "USER_PATH", tmp_path / "user.md")
    monkeypatch.setattr(config, "INSTRUCTIONS_PATH", tmp_path / "instructions.md")
    monkeypatch.setattr(config, "SKILLS_DIR", tmp_path / "skills")
    monkeypatch.setattr(config, "CRON_DIR", tmp_path / "cron")
    monkeypatch.setattr(config, "PLUGINS_DIR", tmp_path / "plugins")
    monkeypatch.setattr(config, "LOGS_DIR", tmp_path / "logs")
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(config, "PLANS_DIR", tmp_path / "plans")
    return tmp_path


# ---------- home ----------
def test_ensure_home_creates_layout(roan_home):
    home.ensure_home()
    for name in ("sessions", "skills", "plugins", "cron", "logs", "cache", "plans"):
        assert (roan_home / name).is_dir()
    assert (roan_home / "memory.md").exists()
    assert (roan_home / "user.md").exists()


def test_ensure_home_is_idempotent(roan_home):
    first = home.ensure_home()
    second = home.ensure_home()
    assert first
    assert second == []


def test_ensure_home_keeps_existing_files(roan_home):
    home.ensure_home()
    (roan_home / "memory.md").write_text("belangrijk")
    home.ensure_home()
    assert (roan_home / "memory.md").read_text() == "belangrijk"


def test_read_profile_ignores_comments(roan_home):
    home.ensure_home()
    assert home.read_profile() == ""  # alleen een kopcommentaar
    (roan_home / "user.md").write_text("# User\n\nRoan, IT Ops\n# comment\n")
    assert home.read_profile() == "Roan, IT Ops"


def test_read_profile_missing_file(roan_home):
    assert home.read_profile() == ""


def test_layout_lists_entries(roan_home):
    home.ensure_home()
    (roan_home / "skills" / "a.md").write_text("x")
    out = home.layout()
    assert "skills" in out
    assert "a.md" in out["skills"]


# ---------- skills ----------
def test_parse_skill_frontmatter():
    name, desc, body = skills.parse_skill("---\nname: deploy\ndescription: Doe een release\n---\nStap 1\n")
    assert name == "deploy"
    assert desc == "Doe een release"
    assert body == "Stap 1"


def test_parse_skill_heading_fallback():
    name, desc, body = skills.parse_skill("# Mijn skill\nDoe iets nuttigs\n")
    assert name == "Mijn skill"
    assert desc == "Doe iets nuttigs"


def test_load_and_get_skills(roan_home):
    home.ensure_home()
    (roan_home / "skills" / "deploy.md").write_text("---\nname: deploy\ndescription: Release\n---\nBody")
    (roan_home / "skills" / "other.md").write_text("# Ander\nIets anders\n")
    loaded = skills.load_skills()
    assert {s["name"] for s in loaded} == {"deploy", "Ander"}
    assert skills.get_skill("deploy")["body"] == "Body"
    assert skills.get_skill("DEPLOY") is not None
    assert skills.get_skill("bestaat-niet") is None


def test_skills_prompt_lists_names(roan_home):
    home.ensure_home()
    (roan_home / "skills" / "x.md").write_text("---\nname: x\ndescription: doet x\n---\nbody")
    prompt = skills.skills_prompt()
    assert "x: doet x" in prompt
    assert "read_skill" in prompt


def test_skills_prompt_empty(roan_home):
    home.ensure_home()
    assert skills.skills_prompt() == ""


def test_skills_list_text(roan_home):
    home.ensure_home()
    assert "Nog geen skills" in skills.skills_list_text()
    (roan_home / "skills" / "x.md").write_text("---\nname: x\ndescription: d\n---\nb")
    assert "**x**" in skills.skills_list_text()


# ---------- systeem-prompt ----------
def test_system_prompt_includes_profile_and_skills(roan_home):
    home.ensure_home()
    (roan_home / "user.md").write_text("Roan Heemstra, Bergen op Zoom\n")
    (roan_home / "memory.md").write_text("Houdt van lokale modellen\n")
    (roan_home / "skills" / "s.md").write_text("---\nname: s\ndescription: d\n---\nb")

    from roan import agent as agent_mod

    prompt = agent_mod._build_system_prompt()
    assert "Roan Heemstra" in prompt
    assert "lokale modellen" in prompt
    assert "s: d" in prompt


def test_read_skill_tool(roan_home):
    home.ensure_home()
    (roan_home / "skills" / "s.md").write_text("---\nname: s\ndescription: d\n---\nde volledige body")

    from roan import agent as agent_mod

    assert agent_mod.read_skill("s") == "de volledige body"
    assert "Onbekende skill" in agent_mod.read_skill("nope")
    assert "read_skill" in agent_mod.TOOL_FUNCS


# ---------- cron ----------
def test_parse_every():
    assert cron.parse_every("30m") == 1800
    assert cron.parse_every("2h") == 7200
    assert cron.parse_every("45s") == 45
    assert cron.parse_every("1d") == 86400
    assert cron.parse_every("bogus") is None
    assert cron.parse_every("0m") is None


def test_parse_daily():
    assert cron.parse_daily("daily 09:30") == (9, 30)
    assert cron.parse_daily("daily 24:00") is None
    assert cron.parse_daily("elke dag 09:00") is None


def test_next_run_interval_from_last_run():
    now = 1_000_000.0
    job = {"schedule": "1h", "last_run": now - 3600}
    assert cron.next_run(job, now) == now


def test_next_run_unknown_schedule():
    assert cron.next_run({"schedule": "wat"}, 1.0) is None


def test_is_due_disabled():
    assert cron.is_due({"schedule": "1s", "enabled": False}, time.time()) is False


def test_is_due_interval():
    now = time.time()
    assert cron.is_due({"schedule": "1s", "last_run": now - 5}, now) is True
    assert cron.is_due({"schedule": "1h", "last_run": now}, now) is False


def test_add_and_load_jobs(roan_home):
    home.ensure_home()
    cron.add_job("ochtend", "daily 09:00", "Vat samen")
    jobs = cron.load_jobs()
    assert len(jobs) == 1
    assert jobs[0]["id"] == "ochtend"
    # idem id vervangt
    cron.add_job("ochtend", "1h", "Anders")
    jobs = cron.load_jobs()
    assert len(jobs) == 1
    assert jobs[0]["schedule"] == "1h"


def test_due_jobs_and_mark_run(roan_home):
    home.ensure_home()
    cron.add_job("j", "1s", "doe")
    jobs = cron.load_jobs()
    jobs[0]["last_run"] = time.time() - 10
    cron.save_jobs(jobs)
    assert len(cron.due_jobs()) == 1
    cron.mark_run("j")
    assert cron.due_jobs() == []


def test_run_due_executes_agent(roan_home, monkeypatch):
    home.ensure_home()
    cron.add_job("j", "1s", "doe iets")
    jobs = cron.load_jobs()
    jobs[0]["last_run"] = time.time() - 10
    cron.save_jobs(jobs)

    calls = {}

    class FakeAgent:
        def __init__(self, session_id=None):
            calls["session"] = session_id

        def send(self, prompt):
            calls["prompt"] = prompt
            return "klaar"

        def stop(self):
            calls["stopped"] = True

    monkeypatch.setattr("roan.agent.Agent", FakeAgent)
    results = cron.run_due()
    assert results[0]["output"] == "klaar"
    assert calls["prompt"] == "doe iets"
    assert calls["stopped"] is True
    assert cron.due_jobs() == []


def test_run_due_survives_agent_error(roan_home, monkeypatch):
    home.ensure_home()
    cron.add_job("j", "1s", "doe")
    jobs = cron.load_jobs()
    jobs[0]["last_run"] = time.time() - 10
    cron.save_jobs(jobs)

    class Boom:
        def __init__(self, session_id=None):
            pass

        def send(self, prompt):
            raise RuntimeError("kapot")

        def stop(self):
            pass

    monkeypatch.setattr("roan.agent.Agent", Boom)
    results = cron.run_due()
    assert "Fout" in results[0]["output"]
