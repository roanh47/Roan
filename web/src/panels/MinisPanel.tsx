import { useCallback, useEffect, useState, type ReactElement } from "react";
import type { ChainClient } from "../chain.js";

/**
 * Mini Roans: Roan handing part of the work to itself.
 *
 * A Mini Roan is the same agent in a context of its own, working on one task.
 * This page shows the ones that are working on this device, what each is
 * doing right now, what it came back with, and a Stop button.
 */
interface MiniRow {
  id: number;
  task: string;
  status: string;
  activity: string[];
  result: string;
  background: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  working: "Working",
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
};

export function MinisPanel({ client }: { client: ChainClient }): ReactElement {
  const [minis, setMinis] = useState<MiniRow[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(
    (kind: "minis_list" | "mini_stop", data: Record<string, unknown> = {}): void => {
      void client
        .request<{ ok?: boolean; minis?: MiniRow[]; error?: string }>(kind, data)
        .then((answer) => {
          if (answer.ok === true) {
            setMinis(answer.minis ?? []);
            setStatus(null);
          } else setStatus(answer.error ?? "could not read the Mini Roans");
        })
        .catch(() => setStatus("could not read the Mini Roans"));
    },
    [client],
  );

  useEffect(() => {
    load("minis_list");
    const timer = setInterval(() => load("minis_list"), 2000);
    return () => clearInterval(timer);
  }, [load]);

  const newestFirst = [...(minis ?? [])].sort((a, b) => b.id - a.id);

  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">Mini Roans</h2>
      </header>
      <p className="panel__sub">
        Roan hands a task to itself in a separate context and gets a summary back. Up to four can work at once.
      </p>
      {status !== null ? <p className="panel__status">{status}</p> : null}
      <ul className="panel__list">
        {newestFirst.map((mini) => (
          <li key={mini.id} className="panel__item">
            <span className="panel__path">
              Mini Roan {String(mini.id)} · {STATUS_LABEL[mini.status] ?? mini.status}
              {mini.background ? " · in the background" : ""}
            </span>
            <span className="panel__sub" style={{ whiteSpace: "pre-wrap" }}>
              {mini.task}
            </span>
            {mini.status === "working" ? (
              <span className="panel__sub" role="status">
                {mini.activity.length > 0
                  ? `Now: ${mini.activity[mini.activity.length - 1] ?? ""} · ${String(mini.activity.length)} steps so far`
                  : "Thinking…"}
              </span>
            ) : null}
            {mini.status !== "working" && mini.result.length > 0 ? (
              <details>
                <summary style={{ cursor: "pointer" }}>{mini.status === "done" ? "Summary" : "What went wrong"}</summary>
                <pre style={{ whiteSpace: "pre-wrap", margin: "6px 0 0", fontSize: 12.5, lineHeight: 1.45 }}>
                  {mini.result}
                </pre>
              </details>
            ) : null}
            {mini.status === "working" ? (
              <span>
                <button type="button" className="panel__secondary" onClick={() => load("mini_stop", { id: mini.id })}>
                  Stop
                </button>
              </span>
            ) : null}
          </li>
        ))}
        {minis === null ? <li className="panel__empty">Loading…</li> : null}
        {minis !== null && minis.length === 0 ? <li className="panel__empty">No Mini Roan has worked yet.</li> : null}
      </ul>
    </section>
  );
}

export default MinisPanel;
