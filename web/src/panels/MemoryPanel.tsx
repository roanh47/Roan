import { useCallback, useEffect, useState, type ReactElement } from "react";
import type { ChainClient } from "../chain.js";

/**
 * Memory: what Roan keeps between conversations.
 *
 * Two lists. "About you" is who you are and how you like things done. "What
 * Roan learned" is facts about your machines and projects. Roan writes both
 * itself; here you read them, correct them and remove what is wrong. A wrong
 * memory is worse than none, so this page exists.
 */
type Target = "user" | "memory";

interface Entry {
  index: number;
  text: string;
}

interface Answer {
  ok?: boolean;
  error?: string;
  entries?: Entry[];
  budget?: { used: number; limit: number };
}

const TITLES: Record<Target, string> = { user: "About you", memory: "What Roan learned" };

function MemoryList({ client, target }: { client: ChainClient; target: Target }): ReactElement {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [budget, setBudget] = useState<{ used: number; limit: number } | null>(null);
  const [adding, setAdding] = useState("");
  const [editing, setEditing] = useState<{ index: number; text: string } | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const take = useCallback((answer: Answer): void => {
    if (answer.ok === true) {
      setEntries(answer.entries ?? []);
      setBudget(answer.budget ?? null);
      setStatus(null);
    } else setStatus(answer.error ?? "that did not work");
  }, []);

  const send = useCallback(
    (kind: "memory_view" | "memory_edit", data: Record<string, unknown> = {}): void => {
      void client
        .request<Answer>(kind, { target, ...data })
        .then(take)
        .catch((error: unknown) => setStatus(error instanceof Error ? error.message : "that did not work"));
    },
    [client, target, take],
  );

  useEffect(() => {
    send("memory_view");
  }, [send]);

  return (
    <div className="panel__form">
      <span className="panel__path">{TITLES[target]}</span>
      {budget !== null ? (
        <span className="panel__sub">
          {String(budget.used)} of {String(budget.limit)} characters used
        </span>
      ) : null}
      {status !== null ? <p className="panel__status">{status}</p> : null}
      <ul className="panel__list">
        {(entries ?? []).map((entry) => (
          <li key={entry.index} className="panel__item">
            {editing?.index === entry.index ? (
              <>
                <textarea
                  className="panel__input panel__textarea"
                  aria-label="Memory text"
                  value={editing.text}
                  onChange={(event) => setEditing({ index: entry.index, text: event.target.value })}
                />
                <span style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    className="panel__primary"
                    disabled={editing.text.trim().length === 0}
                    onClick={() => {
                      send("memory_edit", { action: "replace", index: entry.index, text: editing.text.trim() });
                      setEditing(null);
                    }}
                  >
                    Save
                  </button>
                  <button type="button" className="panel__secondary" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </span>
              </>
            ) : (
              <>
                <span className="panel__sub" style={{ whiteSpace: "pre-wrap" }}>
                  {entry.text}
                </span>
                <span style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    className="panel__secondary"
                    onClick={() => setEditing({ index: entry.index, text: entry.text })}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="panel__secondary"
                    onClick={() => send("memory_edit", { action: "remove", index: entry.index })}
                  >
                    Forget
                  </button>
                </span>
              </>
            )}
          </li>
        ))}
        {entries === null ? <li className="panel__empty">Loading…</li> : null}
        {entries !== null && entries.length === 0 ? <li className="panel__empty">Nothing yet.</li> : null}
      </ul>
      <input
        className="panel__input"
        aria-label={`Add to ${TITLES[target]}`}
        placeholder="Add a fact, as one sentence"
        value={adding}
        onChange={(event) => setAdding(event.target.value)}
      />
      <button
        type="button"
        className="panel__secondary"
        disabled={adding.trim().length === 0}
        onClick={() => {
          send("memory_edit", { action: "add", text: adding.trim() });
          setAdding("");
        }}
      >
        Add
      </button>
    </div>
  );
}

export function MemoryPanel({ client }: { client: ChainClient }): ReactElement {
  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">Memory</h2>
      </header>
      <p className="panel__sub">What Roan remembers between chats. Correct or remove anything that is wrong.</p>
      <MemoryList client={client} target="user" />
      <MemoryList client={client} target="memory" />
    </section>
  );
}

export default MemoryPanel;
