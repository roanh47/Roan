import { useEffect, useState, type ReactElement } from "react";
import type { ChainClient } from "../chain";

interface CronJob {
  id: string;
  title: string;
  prompt: string;
  every: string;
  enabled?: boolean;
}

interface Props {
  client: ChainClient;
}

/**
 * Turns Roan takes on his own. The list travels with the agent; the "last run"
 * clock stays on the machine that ran it.
 */
export function SchedulesPanel({ client }: Props): ReactElement {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [every, setEvery] = useState("1h");
  const [status, setStatus] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    const answer = await client.request<{ jobs?: CronJob[]; error?: string }>("cron_list");
    if (answer.error !== undefined) setStatus(answer.error);
    setJobs(answer.jobs ?? []);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function save(next: CronJob[]): Promise<void> {
    const answer = await client.request<{ ok?: boolean; error?: string }>("cron_save", { jobs: next });
    setStatus(answer.error ?? "saved");
    setJobs(next);
  }

  async function add(): Promise<void> {
    if (title.trim().length === 0 || prompt.trim().length === 0) {
      setStatus("a title and a prompt, please");
      return;
    }
    const job: CronJob = {
      id: `job-${String(Date.now())}`,
      title: title.trim(),
      prompt: prompt.trim(),
      every: every.trim(),
    };
    await save([...jobs, job]);
    setTitle("");
    setPrompt("");
  }

  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">Schedules</h2>
        <button type="button" className="rail__button" onClick={() => void refresh()}>
          Refresh
        </button>
      </header>

      <ul className="panel__list">
        {jobs.length === 0 ? <li className="panel__empty">Nothing scheduled.</li> : null}
        {jobs.map((job) => (
          <li key={job.id} className="panel__row panel__row--static">
            <div>
              <div className="panel__path">{job.title}</div>
              <div className="panel__sub">
                {job.every} · {job.prompt.slice(0, 70)}
              </div>
            </div>
            <div className="panel__actions">
              <button
                type="button"
                className="rail__button"
                onClick={() =>
                  void save(jobs.map((entry) => (entry.id === job.id ? { ...entry, enabled: !entry.enabled } : entry)))
                }
              >
                {job.enabled === false ? "Off" : "On"}
              </button>
              <button
                type="button"
                className="rail__button"
                onClick={() => void save(jobs.filter((entry) => entry.id !== job.id))}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="panel__form">
        <input className="panel__input" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input
          className="panel__input"
          placeholder="What should he do? (e.g. summarise my inbox)"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <input className="panel__input" placeholder="30m, 2h, 1d" value={every} onChange={(e) => setEvery(e.target.value)} />
        <button type="button" className="panel__primary" onClick={() => void add()}>
          Add schedule
        </button>
      </div>

      {status !== null ? <p className="panel__status">{status}</p> : null}
    </section>
  );
}
