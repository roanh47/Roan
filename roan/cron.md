---
type: Concept
title: Cron
description: Scheduled prompts in ~/.Roan/cron/jobs.json, run by `Roan cron`.
tags: [roan, cron, scheduling]
status: stable
generated: { by: hermes-agent/deepseek-v4.1-flash, at: 2026-09-30T08:12:52Z }
verified: { by: process:pytest, at: 2026-09-30T08:12:52Z }
sources:
  - id: cron
    resource: cron.py
    title: roan/cron.py
---

# Shape

`~/.Roan/cron/jobs.json` — an object with a `jobs` key holding a list.
`save_jobs()` writes it that way; `load_jobs()` also accepts a bare list, so an
old file keeps working.

    {
      "jobs": [
        {
          "id": "ochtend",
          "schedule": "daily 09:00",
          "prompt": "Vat mijn ongelezen berichten samen.",
          "enabled": true,
          "last_run": 1759200000
        }
      ]
    }

| Field | Meaning |
|---|---|
| `id` | the job's name; also the session id it runs in |
| `schedule` | `30s` / `15m` / `2h` / `1d`, or `daily HH:MM` |
| `prompt` | the message sent to the agent |
| `enabled` | `false` disables the job without deleting it |
| `last_run` | unix timestamp of the last execution |

# Schedule syntax

Two forms, parsed by `parse_every()` and `parse_daily()`:

* **Interval** — a positive number plus `s`, `m`, `h` or `d`: `45s`, `30m`,
  `2h`, `1d`.
* **Daily** — `daily HH:MM` on a 24-hour clock, e.g. `daily 09:00`. The hour must
  be 0-23 and the minute 0-59 or the schedule is rejected.

`next_run(job, now)` returns the next timestamp, `is_due(job)` compares it to now
and honours `enabled`, `due_jobs()` filters, and `mark_run(job_id)` stamps
`last_run`.

# Running

* `Roan cron` starts `run_forever()`: a loop that polls every 30 seconds, runs
  whatever is due, and prints the id, the prompt and the output.
* Each job gets **its own session**, `cron-<id>` — so a nightly summary never
  mixes with your chat history.
* A failing job becomes `"Fout: ..."` in the output instead of killing the loop,
  and the agent is stopped in a `finally`.

# No slash command

There is deliberately **no** `/cron` in the TUI. Cron is a long-running process;
the TUI is interactive. A test asserts `cron` is not in `commands.names()` so
nobody adds one by accident.

# API

`add_job(id, schedule, prompt)`, `load_jobs()`, `save_jobs(jobs)`,
`run_due(now)` (pure and therefore testable), `run_forever(poll_seconds)`.

`add_job` replaces a job with the same id rather than appending a duplicate.
