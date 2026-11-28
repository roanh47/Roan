import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import type { ChainClient } from "../chain.js";

interface LiveModel {
  id: string;
  name: string;
}

/** The levels the daemon accepts, in the order the picker shows them. */
export const EFFORTS = ["low", "normal", "high"] as const;
export type Effort = (typeof EFFORTS)[number];

export function isEffort(value: unknown): value is Effort {
  return value === "low" || value === "normal" || value === "high";
}

const EFFORT_LABEL: Record<Effort, string> = { low: "Low", normal: "Normal", high: "High" };

interface Props {
  client: ChainClient;
  /** The active provider's account id, or null when none is configured. */
  provider: string | null;
  /** The model in use, if any. */
  model: string | null;
  onClose: () => void;
}

/**
 * The model picker as a bottom sheet, one tap from the conversation — the
 * reference apps let you switch mid-chat, not through a settings hike. The
 * list is the provider's own live /models answer, because a catalogue cannot
 * know what this key may call.
 */
export function ModelSheet({ client, provider, model, onClose }: Props): ReactElement {
  const [models, setModels] = useState<LiveModel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [effort, setEffort] = useState<Effort | null>(null);

  useEffect(() => {
    let alive = true;
    setModels(null);
    setError(null);
    setQuery("");
    if (provider === null) return;
    void (async () => {
      const answer = await client.request<{ models?: LiveModel[]; error?: string }>("models_list", {
        id: provider,
      });
      if (!alive) return;
      if (answer.error !== undefined) setError(answer.error);
      setModels(answer.models ?? []);
    })();
    return () => {
      alive = false;
    };
    // The sheet reloads whenever it opens for a (new) provider.
  }, [client, provider]);

  // How hard the model thinks is a setting of its own, not of one model.
  useEffect(() => {
    let alive = true;
    void client
      .request<{ effort?: string }>("effort")
      .then((answer) => {
        if (alive && isEffort(answer.effort)) setEffort(answer.effort);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [client]);

  function pickEffort(level: Effort): void {
    const previous = effort;
    setEffort(level);
    void client
      .request<{ ok?: boolean; error?: string }>("effort", { effort: level })
      .then((answer) => {
        if (answer.ok !== true) {
          setEffort(previous);
          setError(answer.error ?? "could not change the thinking effort");
        }
      })
      .catch(() => setEffort(previous));
  }

  const shown =
    models === null
      ? []
      : query.trim().length === 0
        ? models
        : models.filter((entry) => `${entry.id} ${entry.name}`.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className="sheet__wrap" role="dialog" aria-label="Select a model">
      <button type="button" className="sheet__scrim" aria-label="Close" onClick={onClose} />
      <div className="sheet">
        <div className="sheet__grip" aria-hidden="true" />
        <header className="sheet__head">
          <h2 className="sheet__title">Select a model</h2>
          <button type="button" className="sheet__close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>

        {provider === null ? (
          <div className="sheet__body">
            <p className="sheet__note">No provider yet — add one with its key in Settings first.</p>
          </div>
        ) : (
          <div className="sheet__body">
            <div
              className="sheet__effort"
              role="group"
              aria-label="Thinking effort"
              style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, fontSize: 13 }}
            >
              <span style={{ color: "var(--faint)" }}>Thinking effort</span>
              {EFFORTS.map((level) => (
                <button
                  key={level}
                  type="button"
                  aria-pressed={effort === level}
                  onClick={() => pickEffort(level)}
                  style={{
                    padding: "5px 12px",
                    border: "1px solid var(--line-soft)",
                    borderRadius: 999,
                    background: effort === level ? "rgba(126, 226, 184, 0.14)" : "transparent",
                    color: effort === level ? "var(--accent)" : "inherit",
                    cursor: "pointer",
                  }}
                >
                  {EFFORT_LABEL[level]}
                </button>
              ))}
            </div>
            <input
              className="sheet__search"
              placeholder="Search models"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
            {error !== null ? <p className="sheet__note sheet__note--bad">{error}</p> : null}
            {models === null ? <p className="sheet__note">Loading models…</p> : null}
            {models !== null && models.length === 0 && error === null ? (
              <p className="sheet__note">This provider lists no models.</p>
            ) : null}
            <ul className="sheet__list">
              {shown.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    className={entry.id === model ? "sheet__row sheet__row--active" : "sheet__row"}
                    disabled={busy}
                    onClick={() => {
                      if (provider === null) return;
                      setBusy(true);
                      void client
                        .request("provider_pick", { id: provider, model: entry.id })
                        .then(() => onClose())
                        .finally(() => setBusy(false));
                    }}
                  >
                    <span className="sheet__model">{entry.name}</span>
                    <span className="sheet__id">{entry.id}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
