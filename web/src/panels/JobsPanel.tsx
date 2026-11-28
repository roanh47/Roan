import { useCallback, useEffect, useState, type ReactElement } from "react";
import type { ChainClient } from "../chain.js";

/**
 * Background jobs on this device: commands Roan started and did not wait for.
 *
 * A dev server, a long build, a watcher. This page shows what is running and
 * what ended, lets you read the last output and stop a job. Jobs belong to
 * this device and are gone when its daemon restarts.
 */
interface JobRow {
  id: number;
  command: string;
  status: string;
  exitCode: number | null;
  output: string;
}

const STATUS_LABEL: Record<string, string> = {
  running: "Running",
  exited: "Finished",
  failed: "Failed",
  stopped: "Stopped",
};

export function JobsPanel({ client }: { client: ChainClient }): ReactElement {
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(
    (kind: "jobs_list" | "job_stop", data: Record<string, unknown> = {}): void => {
      void client
        .request<{ ok?: boolean; jobs?: JobRow[]; error?: string }>(kind, data)
        .then((answer) => {
          if (answer.ok === true) {
            setJobs(answer.jobs ?? []);
            setStatus(null);
          } else setStatus(answer.error ?? "could not read the jobs");
        })
        .catch(() => setStatus("could not read the jobs"));
    },
    [client],
  );

  useEffect(() => {
    load("jobs_list");
    const timer = setInterval(() => load("jobs_list"), 3000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">Background jobs</h2>
      </header>
      <p className="panel__sub">Commands Roan started on this device and left running.</p>
      {status !== null ? <p className="panel__status">{status}</p> : null}
      <ul className="panel__list">
        {(jobs ?? []).map((job) => (
          <li key={job.id} className="panel__item">
            <span className="panel__path">{job.command}</span>
            <span className="panel__sub">
              {STATUS_LABEL[job.status] ?? job.status}
              {job.exitCode !== null ? ` · exit ${String(job.exitCode)}` : ""}
            </span>
            <span style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="panel__secondary"
                aria-expanded={open === job.id}
                onClick={() => setOpen(open === job.id ? null : job.id)}
              >
                {open === job.id ? "Hide output" : "Show output"}
              </button>
              {job.status === "running" ? (
                <button type="button" className="panel__secondary" onClick={() => load("job_stop", { id: job.id })}>
                  Stop
                </button>
              ) : null}
            </span>
            {open === job.id ? (
              <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 12.5, lineHeight: 1.45 }}>
                {job.output.trim().length > 0 ? job.output : "No output yet."}
              </pre>
            ) : null}
          </li>
        ))}
        {jobs === null ? <li className="panel__empty">Loading…</li> : null}
        {jobs !== null && jobs.length === 0 ? <li className="panel__empty">Nothing is running in the background.</li> : null}
      </ul>
    </section>
  );
}

export default JobsPanel;
