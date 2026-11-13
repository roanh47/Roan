import { useEffect, useState, type ReactElement } from "react";
import type { ChainClient } from "../chain";

interface Checkpoint {
  seq: number;
  label: string;
  ts: number;
}

interface Props {
  client: ChainClient;
  onRewind: (seq: number) => void;
}

/**
 * Points you deliberately marked. Going back opens a new conversation from
 * there; the old one stays exactly as it was.
 */
export function CheckpointsPanel({ client, onRewind }: Props): ReactElement {
  const [points, setPoints] = useState<Checkpoint[]>([]);
  const [label, setLabel] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    const answer = await client.request<{ checkpoints?: Checkpoint[] }>("checkpoints_list");
    setPoints(answer.checkpoints ?? []);
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">Checkpoints</h2>
        <button type="button" className="rail__button" onClick={() => void refresh()}>
          Refresh
        </button>
      </header>

      <div className="panel__form">
        <input
          className="panel__input"
          placeholder="Name this point (optional)"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
        <button
          type="button"
          className="panel__primary"
          onClick={() => {
            client.checkpoint(label.trim().length > 0 ? label.trim() : undefined);
            setLabel("");
            setStatus("checkpoint placed");
            window.setTimeout(() => void refresh(), 400);
          }}
        >
          Place checkpoint
        </button>
      </div>

      {status !== null ? <p className="panel__status">{status}</p> : null}

      <ul className="panel__list">
        {points.length === 0 ? <li className="panel__empty">No checkpoints yet.</li> : null}
        {points.map((point) => (
          <li key={point.seq} className="panel__row panel__row--static">
            <div>
              <div className="panel__path">{point.label}</div>
              <div className="panel__sub">
                #{point.seq} · {new Date(point.ts).toLocaleString()}
              </div>
            </div>
            <div className="panel__actions">
              <button type="button" className="rail__button" onClick={() => onRewind(point.seq)}>
                Go back here
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
