import { useState, type ReactElement } from "react";

/** One file discovery found; mirrors `DiscoveredFile` without importing the core. */
export interface ImportCandidate {
  path: string;
  kind: string;
  bytes: number;
}

/** One entry the plan would write. */
export interface ImportPlanFile {
  path: string;
  size?: number;
}

/** One entry the plan leaves alone. */
export interface ImportPlanConflict {
  path: string;
  reason?: string;
}

/** The shape `planImport` returns, as the panel reads it. */
export interface ImportPlanView {
  adds: readonly ImportPlanFile[];
  conflicts: readonly ImportPlanConflict[];
}

interface Props {
  /** Instruction files discovery found in the chosen folders. */
  candidates: readonly ImportCandidate[];
  /** What would be added and what collides; computed by the daemon. */
  plan: ImportPlanView;
  /** Called with the target names to import, only after the user confirms. */
  onImport: (paths: string[]) => void;
  /** Optional line from the parent, e.g. after an import ran. */
  status?: string | null;
}

function bytesLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.round(bytes / 1024)} kB`;
}

/**
 * Importing instructions another agent left behind.
 *
 * The panel owns no fetching and no writing: discovery and the plan are handed
 * in, and the button leaves through `onImport`. Conflicts are listed as skipped,
 * never offered as overwrites — replacing `AGENTS.md` takes an explicit edit,
 * not a side effect of importing.
 */
export function ImportPanel({ candidates, plan, onImport, status }: Props): ReactElement {
  const [confirmed, setConfirmed] = useState(false);
  const canImport = confirmed && plan.adds.length > 0;

  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">Import</h2>
      </header>

      <p className="panel__sub">
        {candidates.length === 0
          ? "No instruction files found in the chosen folders."
          : `${candidates.length} instruction ${candidates.length === 1 ? "file" : "files"} found.`}
      </p>

      <ul className="panel__list">
        {candidates.map((candidate) => (
          <li key={candidate.path} className="panel__row panel__row--static">
            <div>
              <div className="panel__path">{candidate.path}</div>
              <div className="panel__sub">
                {candidate.kind} · {bytesLabel(candidate.bytes)}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <h2 className="panel__title">Will be added</h2>
      <ul className="panel__list">
        {plan.adds.length === 0 ? (
          <li className="panel__empty">Nothing new to import.</li>
        ) : null}
        {plan.adds.map((entry) => (
          <li key={entry.path} className="panel__row panel__row--static">
            <div className="panel__path">{entry.path}</div>
            {entry.size !== undefined ? <div className="panel__sub">{bytesLabel(entry.size)}</div> : null}
          </li>
        ))}
      </ul>

      <h2 className="panel__title">Conflicts</h2>
      <ul className="panel__list">
        {plan.conflicts.length === 0 ? (
          <li className="panel__empty">No conflicts.</li>
        ) : null}
        {plan.conflicts.map((conflict) => (
          <li key={`${conflict.path}-${conflict.reason ?? "exists"}`} className="panel__row panel__row--static">
            <div className="panel__path">{conflict.path}</div>
            <div className="panel__sub">
              {conflict.reason === "duplicate" ? "already in this import" : "already exists"} · left untouched
            </div>
          </li>
        ))}
      </ul>

      {status !== undefined && status !== null ? <p className="panel__status">{status}</p> : null}

      <div className="panel__form">
        <label className="panel__sub">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />{" "}
          I reviewed this; existing files are not overwritten.
        </label>
        <button
          type="button"
          className="panel__primary"
          disabled={!canImport}
          onClick={() => onImport(plan.adds.map((entry) => entry.path))}
        >
          Import {plan.adds.length} {plan.adds.length === 1 ? "file" : "files"}
        </button>
      </div>
    </section>
  );
}
