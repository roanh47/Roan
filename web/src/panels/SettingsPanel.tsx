import { useEffect, useMemo, useState, type ReactElement } from "react";
import type { ChainClient } from "../chain";
import { UpdateCard } from "./UpdateCard";

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
  // The key and the base URL of the provider. Both travel to the other
  // machines in the chain, so one device can set them up for all of them.
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
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

  async function saveProvider(): Promise<void> {
    setBusy(true);
    const patch: Record<string, string> = {};
    if (apiKey.trim().length > 0) patch["apiKey"] = apiKey.trim();
    if (baseUrl.trim().length > 0) patch["baseUrl"] = baseUrl.trim();
    const answer = await client.request<{ ok?: boolean; error?: string; keySet?: boolean }>(
      "settings_save",
      patch,
    );
    setBusy(false);
    if (answer.error !== undefined) {
      setStatus(answer.error);
      return;
    }
    setApiKey("");
    setStatus(answer.keySet === true ? "saved; the key travels with the chain" : "saved");
  }

  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">Settings</h2>
      </header>

      <p className="panel__sub">Model in use: {current}</p>

      <UpdateCard />

      <div className="panel__form">
        <span className="panel__sub">Provider key for this chain</span>
        <input
          className="panel__input"
          placeholder="API key — empty means keep the current one"
          value={apiKey}
          type="password"
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setApiKey(event.target.value)}
        />
        <input
          className="panel__input"
          placeholder="Base URL (optional), e.g. https://api.example.com/v1"
          value={baseUrl}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setBaseUrl(event.target.value)}
        />
        <button type="button" className="panel__primary" disabled={busy} onClick={() => void saveProvider()}>
          Save
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
