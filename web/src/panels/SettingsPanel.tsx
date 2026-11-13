import { useEffect, useMemo, useState, type ReactElement } from "react";
import type { ChainClient } from "../chain";

interface ModelRow {
  provider: string;
  providerName: string;
  model: string;
  modelName: string;
  context?: number;
}

interface Props {
  client: ChainClient;
  current: string;
}

/**
 * Every provider in models.dev, searchable. Picking one writes the model into
 * the agent's config, which travels the chain like everything else.
 */
export function SettingsPanel({ client, current }: Props): ReactElement {
  const [daemon, setDaemon] = useState(() => {
    try {
      return window.localStorage.getItem("roan.daemon") ?? "";
    } catch {
      return "";
    }
  });
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<ModelRow[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const answer = await client.request<{ models?: ModelRow[] }>("models_search", { query });
      if (live) setRows(answer.models ?? []);
    })();
    return () => {
      live = false;
    };
  }, [query]);

  const shown = useMemo(() => rows.slice(0, 60), [rows]);

  async function pick(row: ModelRow): Promise<void> {
    setBusy(true);
    const answer = await client.request<{ ok?: boolean; error?: string }>("model_set", {
      provider: row.provider,
      model: row.model,
    });
    setBusy(false);
    setStatus(answer.error ?? `now using ${row.providerName} · ${row.modelName}`);
  }

  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">Settings</h2>
      </header>

      <p className="panel__sub">Model in use: {current}</p>

      <div className="panel__form">
        <span className="panel__sub">Daemon this app talks to</span>
        <input
          className="panel__input"
          placeholder="ws://192.168.0.100:7411/ws"
          value={daemon}
          spellCheck={false}
          onChange={(event) => setDaemon(event.target.value)}
        />
        <button
          type="button"
          className="panel__primary"
          onClick={() => {
            try {
              if (daemon.trim().length === 0) window.localStorage.removeItem("roan.daemon");
              else window.localStorage.setItem("roan.daemon", daemon.trim());
            } catch {
              // storage blocked: nothing to save
            }
            window.location.reload();
          }}
        >
          Use this daemon
        </button>
      </div>

      <input
        className="panel__input"
        placeholder="Search a model, provider, or family"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      {status !== null ? <p className="panel__status">{status}</p> : null}

      <ul className="panel__list">
        {shown.map((row) => (
          <li key={`${row.provider}/${row.model}`}>
            <button
              type="button"
              className={row.model === current ? "panel__row panel__row--active" : "panel__row"}
              disabled={busy}
              onClick={() => void pick(row)}
            >
              <span className="panel__path">{row.modelName}</span>
              <span className="panel__sub">
                {row.providerName}
                {row.context !== undefined ? ` · ${String(Math.round(row.context / 1000))}k` : ""}
              </span>
            </button>
          </li>
        ))}
        {shown.length === 0 ? <li className="panel__empty">Nothing matches.</li> : null}
      </ul>
    </section>
  );
}
