"""Cron: geplande prompts in ~/.Roan/cron/jobs.json.

Een job:
    {
      "id": "ochtend",
      "schedule": "daily 09:00",     # of "30m" / "2h" / "45s"
      "prompt": "Vat mijn openstaande punten samen",
      "enabled": true,
      "last_run": 0
    }

`Roan cron` draait de scheduler; `run_due()` is puur en dus testbaar.
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timedelta

from . import config


def jobs_path():
    """Pad naar jobs.json (lazy, zodat tests het kunnen isoleren)."""
    return config.CRON_DIR / "jobs.json"


# ---------- schema's ----------
def parse_every(spec: str) -> int | None:
    """'30m' / '2h' / '45s' -> seconden, anders None."""
    spec = (spec or "").strip().lower()
    if len(spec) < 2 or not spec[:-1].isdigit():
        return None
    unit = spec[-1]
    value = int(spec[:-1])
    if value <= 0:
        return None
    return {"s": 1, "m": 60, "h": 3600, "d": 86400}.get(unit, 0) * value or None


def parse_daily(spec: str) -> tuple[int, int] | None:
    """'daily 09:30' -> (9, 30), anders None."""
    parts = (spec or "").strip().lower().split()
    if len(parts) != 2 or parts[0] != "daily" or ":" not in parts[1]:
        return None
    try:
        hour, minute = parts[1].split(":", 1)
        hour, minute = int(hour), int(minute)
    except ValueError:
        return None
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        return None
    return hour, minute


def next_run(job: dict, now: float | None = None) -> float | None:
    """Wanneer deze job weer moet draaien (epoch), of None bij een onbekend schema."""
    now = time.time() if now is None else now
    spec = job.get("schedule", "")
    interval = parse_every(spec)
    if interval:
        last = float(job.get("last_run") or 0)
        return max(now, last + interval) if last else now
    daily = parse_daily(spec)
    if daily:
        hour, minute = daily
        moment = datetime.fromtimestamp(now).replace(
            hour=hour, minute=minute, second=0, microsecond=0
        )
        if moment.timestamp() <= now:
            moment += timedelta(days=1)
        return moment.timestamp()
    return None


def is_due(job: dict, now: float | None = None) -> bool:
    if not job.get("enabled", True):
        return False
    run_at = next_run(job, now)
    if run_at is None:
        return False
    return run_at <= (time.time() if now is None else now)


# ---------- opslag ----------
def load_jobs() -> list[dict]:
    path = jobs_path()
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return []
    return data.get("jobs", []) if isinstance(data, dict) else (data or [])


def save_jobs(jobs: list[dict]) -> None:
    path = jobs_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"jobs": jobs}, indent=2), encoding="utf-8")


def add_job(job_id: str, schedule: str, prompt: str) -> dict:
    jobs = [j for j in load_jobs() if j.get("id") != job_id]
    job = {"id": job_id, "schedule": schedule, "prompt": prompt, "enabled": True, "last_run": 0}
    jobs.append(job)
    save_jobs(jobs)
    return job


def due_jobs(now: float | None = None) -> list[dict]:
    return [j for j in load_jobs() if is_due(j, now)]


def mark_run(job_id: str, when: float | None = None) -> None:
    jobs = load_jobs()
    stamp = time.time() if when is None else when
    for job in jobs:
        if job.get("id") == job_id:
            job["last_run"] = stamp
    save_jobs(jobs)


# ---------- uitvoeren ----------
def run_due(now: float | None = None) -> list[dict]:
    """Draai alle jobs die nu moeten; geeft [{id, prompt, output}] terug."""
    from .agent import Agent

    results: list[dict] = []
    for job in due_jobs(now):
        agent = Agent(session_id=f"cron-{job.get('id')}")
        try:
            output = agent.send(job.get("prompt", ""))
        except Exception as exc:
            output = f"Fout: {exc}"
        finally:
            agent.stop()
        mark_run(job.get("id", ""), now)
        results.append({"id": job.get("id"), "prompt": job.get("prompt"), "output": output})
    return results


def run_forever(poll_seconds: int = 30) -> None:
    print("Roan cron actief. Ctrl-C om te stoppen.")
    while True:
        for result in run_due():
            print(f"[{result['id']}] {result['prompt']}\n{result['output']}\n")
        time.sleep(poll_seconds)
