import { useState, type ReactElement } from "react";

import { describeJob, validateDraft, type BackgroundJob } from "./background.js";

export interface BackgroundPanelProps {
  /** Every scheduled task, in the order the chain has them. */
  readonly jobs: readonly BackgroundJob[];
  /** Called with a clean draft; the parent writes it to the chain. */
  readonly onCreate: (draft: { prompt: string; schedule: string }) => void;
  /** Enable or disable one job. */
  readonly onToggle: (id: string, enabled: boolean) => void;
  /** Delete one job. */
  readonly onDelete: (id: string) => void;
  /** Whatever the parent wants to say about the last action; null for quiet. */
  readonly status?: string | null;
}

/**
 * Background tasks: the jobs that run without being asked.
 *
 * Props only. The list comes down from the chain and every change goes back up
 * through a callback, so the screen renders the same on the desktop and on the
 * phone and nothing here touches a socket.
 */
export function BackgroundPanel({
  jobs,
  onCreate,
  onToggle,
  onDelete,
  status = null,
}: BackgroundPanelProps): ReactElement {
  const [prompt, setPrompt] = useState("");
  const [schedule, setSchedule] = useState("every 30m");
  const [error, setError] = useState<string | null>(null);

  function create(): void {
    const draft = { prompt: prompt.trim(), schedule: schedule.trim() };
    const problem = validateDraft(draft);
    if (problem !== null) {
      setError(problem);
      return;
    }
    setError(null);
    onCreate(draft);
    setPrompt("");
  }

  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">Background</h2>
        <span className="panel__sub">
          {jobs.length === 0 ? "nothing scheduled" : `${String(jobs.length)} scheduled`}
        </span>
      </header>

      <ul className="panel__list">
        {jobs.length === 0 ? <li className="panel__empty">Nothing runs in the background.</li> : null}
        {jobs.map((job) => (
          <li key={job.id} className={job.enabled ? "panel__row panel__row--static" : "panel__row"}>
            <div>
              <div className="panel__path">{job.prompt}</div>
              <div className="panel__sub">{describeJob(job)}</div>
            </div>
            <div className="panel__actions">
              <button
                type="button"
                className="rail__button"
                aria-pressed={job.enabled}
                onClick={() => onToggle(job.id, !job.enabled)}
              >
                {job.enabled ? "Pause" : "Resume"}
              </button>
              <button type="button" className="rail__button" onClick={() => onDelete(job.id)}>
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="panel__form">
        <input
          className="panel__input"
          placeholder="What should he do? (e.g. summarise my inbox)"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
        />
        <input
          className="panel__input"
          placeholder="every 30m, every 2h, daily 07:30"
          value={schedule}
          onChange={(event) => setSchedule(event.target.value)}
        />
        <button type="button" className="panel__primary" onClick={() => create()}>
          Add task
        </button>
      </div>

      {error !== null ? <p className="panel__status">{error}</p> : null}
      {status !== null ? <p className="panel__status">{status}</p> : null}
    </section>
  );
}
