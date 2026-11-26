import { useState, type CSSProperties, type ReactElement } from "react";

import { cssVar, fonts, radii, space } from "../theme.js";

/** Per-file line counts, mirroring `FileStat` without importing the core. */
export interface GitFileStat {
  readonly added: number;
  readonly removed: number;
  readonly binary?: boolean;
}

/** One changed path, mirroring `ChangedFile` from `src/gitpanel/status.ts`. */
export interface GitChangedFile {
  readonly path: string;
  readonly originalPath?: string;
  /** The porcelain code; shown in the row's tooltip, not as the badge text. */
  readonly code?: string;
  readonly staged: boolean;
  readonly unstaged: boolean;
  readonly untracked: boolean;
  readonly stat?: GitFileStat;
}

interface Props {
  /** Every changed path, in git's order. */
  files: readonly GitChangedFile[];
  /** Commit the trimmed message; the caller runs git and refreshes the list. */
  onCommit: (message: string) => void;
  /** A line from the parent, e.g. a git error after a failed commit. */
  status?: string | null;
  /** A message the parent restored, used once as the box's starting value. */
  draft?: string;
  /** Disables Commit while a commit is already running. */
  busy?: boolean;
}

const row: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: space.sm,
  minWidth: 0,
};

const meta: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: space.xs,
  flex: "0 0 auto",
};

const badge: CSSProperties = {
  padding: `1px ${String(space.xs)}px`,
  border: `1px solid ${cssVar("line")}`,
  borderRadius: radii.pill,
  color: cssVar("muted"),
  fontSize: 10,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};

const count: CSSProperties = {
  fontFamily: fonts.mono,
  fontSize: 11,
  color: cssVar("faint"),
  whiteSpace: "nowrap",
};

const name: CSSProperties = { minWidth: 0 };

const footer: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: space.sm,
};

const message = (text: string): CSSProperties => ({
  color: text.startsWith("+") ? cssVar("accent") : text.startsWith("−") ? cssVar("danger") : cssVar("muted"),
});

function statLabel(stat: GitFileStat): string {
  return stat.binary === true ? "binary" : `+${String(stat.added)} −${String(stat.removed)}`;
}

/**
 * The header line, matching `summarise` in `src/gitpanel/status.ts` — the panel
 * counts from the flat list it was handed rather than importing the core.
 */
function describe(files: readonly GitChangedFile[]): string {
  const staged = files.filter((file) => file.staged).length;
  const unstaged = files.filter((file) => file.unstaged).length;
  const untracked = files.filter((file) => file.untracked).length;
  const parts: string[] = [];
  if (staged > 0) parts.push(`${String(staged)} staged`);
  if (unstaged > 0) parts.push(`${String(unstaged)} unstaged`);
  if (untracked > 0) parts.push(`${String(untracked)} untracked`);
  return parts.length === 0 ? "No changes" : parts.join(", ");
}

/** Why Commit is off, or null when it is allowed; mirrors `commitBlocker`. */
function blocker(files: readonly GitChangedFile[], text: string, busy: boolean): string | null {
  if (text.trim().length === 0) return "Write a commit message first.";
  if (!files.some((file) => file.staged)) return "Nothing staged yet.";
  if (busy) return "Committing…";
  return null;
}

/**
 * Changed files, with their stage state and line counts, and the one action
 * that follows from reading them.
 *
 * Props only: the panel never runs git and never reads the disk. The list and
 * the callbacks come from the orchestrator, so the same panel works against a
 * local repository and one reached through a tool on another machine.
 */
export function GitPanel({ files, onCommit, status = null, draft = "", busy = false }: Props): ReactElement {
  const [text, setText] = useState(draft);
  const blockedBy = blocker(files, text, busy);

  function submit(): void {
    const trimmed = text.trim();
    if (trimmed.length === 0 || blockedBy !== null) return;
    onCommit(trimmed);
    setText("");
  }

  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">Changes</h2>
        <span className="panel__sub">{describe(files)}</span>
      </header>

      <ul className="panel__list">
        {files.length === 0 ? <li className="panel__empty">No changes.</li> : null}
        {files.map((file) => (
          <li
            key={`${file.path}:${file.code ?? ""}`}
            className="panel__row panel__row--static"
            title={file.code === undefined ? undefined : `git status ${file.code}`}
          >
            <div style={name}>
              <div className="panel__path">{file.path}</div>
              {file.originalPath === undefined ? null : (
                <div className="panel__sub">was {file.originalPath}</div>
              )}
            </div>
            <div style={meta}>
              {file.staged ? <span style={badge}>Staged</span> : null}
              {file.unstaged ? <span style={badge}>Unstaged</span> : null}
              {file.untracked ? <span style={badge}>Untracked</span> : null}
              {file.stat === undefined ? null : (
                <span style={{ ...count, ...message(statLabel(file.stat)) }}>{statLabel(file.stat)}</span>
              )}
            </div>
          </li>
        ))}
      </ul>

      <form
        className="panel__form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div style={row}>
          <input
            className="panel__input"
            aria-label="Commit message"
            placeholder="Commit message"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <button type="submit" className="panel__primary" disabled={blockedBy !== null}>
            Commit
          </button>
        </div>
        <div style={footer}>
          <span className="panel__hint">{blockedBy ?? "Ready to commit."}</span>
          {status === null || status.length === 0 ? null : (
            <span className="panel__hint" role="status">
              {status}
            </span>
          )}
        </div>
      </form>
    </section>
  );
}
