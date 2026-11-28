import { useEffect, useState, type ReactElement } from "react";
import type { ChainClient } from "../chain.js";

/**
 * Which model does which job.
 *
 * The model in the header answers the conversation. This page holds the rest:
 * how hard it thinks, what a turn retries on when a request fails, and the
 * helper models — one that looks at images, one for background work, one for
 * Mini Roans. An empty helper means the main model does that job.
 */

type Effort = "low" | "normal" | "high";
const EFFORTS: readonly Effort[] = ["low", "normal", "high"];
const EFFORT_LABEL: Record<Effort, string> = { low: "Low", normal: "Normal", high: "High" };

interface Helper {
  provider: string;
  model: string;
}

interface Account {
  id: string;
  label: string;
}

const HELPERS: readonly { slot: string; label: string; hint: string }[] = [
  {
    slot: "vision",
    label: "Vision",
    hint: "Looks at a photo you attach and describes it, for a main model that cannot see images.",
  },
  {
    slot: "background",
    label: "Background",
    hint: "Work you never read live, such as picking what to remember from a chat. A small model is enough.",
  },
  {
    slot: "mini",
    label: "Mini Roan",
    hint: "The model a Mini Roan runs on when Roan hands off a task.",
  },
];

function readHelper(value: unknown): Helper {
  if (typeof value !== "object" || value === null) return { provider: "", model: "" };
  const record = value as Record<string, unknown>;
  return {
    provider: typeof record["provider"] === "string" ? record["provider"] : "",
    model: typeof record["model"] === "string" ? record["model"] : "",
  };
}

export function ModelRolesPanel({ client }: { client: ChainClient }): ReactElement {
  const [effort, setEffort] = useState<Effort | null>(null);
  const [fallback, setFallback] = useState("");
  const [helpers, setHelpers] = useState<Record<string, Helper>>({});
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [effortAnswer, fallbackAnswer, helperAnswer, providerAnswer] = await Promise.all([
        client.request<{ effort?: string }>("effort"),
        client.request<{ model?: string }>("fallback_model"),
        client.request<{ auxiliary?: Record<string, unknown> }>("auxiliary"),
        client.request<{ accounts?: Account[] }>("providers_list"),
      ]);
      if (!alive) return;
      const level = effortAnswer.effort;
      if (level === "low" || level === "normal" || level === "high") setEffort(level);
      setFallback(fallbackAnswer.model ?? "");
      const loaded: Record<string, Helper> = {};
      for (const { slot } of HELPERS) loaded[slot] = readHelper(helperAnswer.auxiliary?.[slot]);
      setHelpers(loaded);
      setAccounts(providerAnswer.accounts ?? []);
    })().catch(() => {
      if (alive) setStatus("could not load the model settings");
    });
    return () => {
      alive = false;
    };
  }, [client]);

  function report(answer: { ok?: boolean; error?: string }, done: string): void {
    setStatus(answer.ok === true ? done : (answer.error ?? "that did not save"));
  }

  function pickEffort(level: Effort): void {
    setEffort(level);
    void client
      .request<{ ok?: boolean; error?: string }>("effort", { effort: level })
      .then((answer) => report(answer, `thinking effort: ${EFFORT_LABEL[level].toLowerCase()}`))
      .catch(() => setStatus("that did not save"));
  }

  function saveFallback(model: string): void {
    void client
      .request<{ ok?: boolean; error?: string; model?: string }>("fallback_model", { model })
      .then((answer) => {
        if (answer.ok === true) setFallback(answer.model ?? "");
        report(answer, model.trim().length > 0 ? "fallback model saved" : "fallback model cleared");
      })
      .catch(() => setStatus("that did not save"));
  }

  function saveHelper(slot: string, label: string, helper: Helper): void {
    void client
      .request<{ ok?: boolean; error?: string }>("auxiliary", { slot, provider: helper.provider, model: helper.model })
      .then((answer) => {
        if (answer.ok === true) setHelpers((current) => ({ ...current, [slot]: helper }));
        report(answer, helper.model.trim().length > 0 ? `${label} model saved` : `${label} model cleared`);
      })
      .catch(() => setStatus("that did not save"));
  }

  function editHelper(slot: string, patch: Partial<Helper>): void {
    setHelpers((current) => ({ ...current, [slot]: { ...(current[slot] ?? { provider: "", model: "" }), ...patch } }));
  }

  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">Model roles</h2>
      </header>
      {status !== null ? <p className="panel__status">{status}</p> : null}

      <div className="panel__form">
        <span className="panel__sub">Thinking effort</span>
        <div role="group" aria-label="Thinking effort" style={{ display: "flex", gap: 8 }}>
          {EFFORTS.map((level) => (
            <button
              key={level}
              type="button"
              className={effort === level ? "panel__primary" : "panel__secondary"}
              aria-pressed={effort === level}
              onClick={() => pickEffort(level)}
            >
              {EFFORT_LABEL[level]}
            </button>
          ))}
        </div>
      </div>

      <div className="panel__form">
        <span className="panel__sub">Fallback model — tried once when a request to the main model fails</span>
        <input
          className="panel__input"
          placeholder="Model id on the same provider; empty for none"
          value={fallback}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setFallback(event.target.value)}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="panel__primary" onClick={() => saveFallback(fallback)}>
            Save
          </button>
          <button type="button" className="panel__secondary" onClick={() => saveFallback("")}>
            Clear
          </button>
        </div>
      </div>

      {HELPERS.map(({ slot, label, hint }) => {
        const helper = helpers[slot] ?? { provider: "", model: "" };
        return (
          <div key={slot} className="panel__form">
            <span className="panel__path">{label} model</span>
            <span className="panel__sub">{hint}</span>
            <select
              className="panel__input"
              aria-label={`${label} provider`}
              value={helper.provider}
              onChange={(event) => editHelper(slot, { provider: event.target.value })}
            >
              <option value="">Same provider as the main model</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.label}
                </option>
              ))}
            </select>
            <input
              className="panel__input"
              aria-label={`${label} model id`}
              placeholder="Model id; empty means the main model does this"
              value={helper.model}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => editHelper(slot, { model: event.target.value })}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="panel__primary" onClick={() => saveHelper(slot, label, helper)}>
                Save
              </button>
              <button
                type="button"
                className="panel__secondary"
                onClick={() => saveHelper(slot, label, { provider: "", model: "" })}
              >
                Clear
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}

export default ModelRolesPanel;
