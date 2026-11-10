import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ChangeEvent, KeyboardEvent, ReactElement } from "react";
import { cssVar, fonts, radii, space } from "../theme";

export interface CommandAction {
  id: string;
  label: string;
  hint?: string;
}

export interface CommandPaletteProps {
  /** Actions offered by the shell. Filtering happens here, the shell owns the list. */
  actions: readonly CommandAction[];
  /** Invoked with the id of the highlighted action when Enter is pressed. */
  onRun: (id: string) => void;
  /** Invoked on Escape. */
  onClose: () => void;
  /** Placeholder for the query input. */
  placeholder?: string;
}

const panel: CSSProperties = {
  display: "flex", flexDirection: "column", gap: space.sm,
  width: "100%", maxWidth: 520, padding: space.md,
  border: `1px solid ${cssVar("line")}`, borderRadius: radii.md,
  background: cssVar("surface"), color: cssVar("fg"),
  fontFamily: fonts.sans,
};
const input: CSSProperties = {
  padding: `${space.sm}px ${space.md}px`,
  border: `1px solid ${cssVar("lineSoft")}`, borderRadius: radii.sm,
  background: cssVar("surface2"), color: cssVar("fg"),
  font: "inherit", fontSize: 14, outline: "none",
};
const list: CSSProperties = {
  display: "flex", flexDirection: "column", gap: 2,
  margin: 0, padding: 0, listStyle: "none",
  maxHeight: 320, overflowY: "auto",
};
const rowBase: CSSProperties = {
  display: "flex", alignItems: "baseline", gap: space.sm,
  padding: `${space.sm}px ${space.md}px`, borderRadius: radii.sm,
  cursor: "pointer", background: "transparent",
};
const rowSelected: CSSProperties = {
  ...rowBase, background: cssVar("lineSoft"),
};
const labelStyle: CSSProperties = { fontSize: 13.5, color: cssVar("fg") };
const hintStyle: CSSProperties = {
  marginLeft: "auto", fontFamily: fonts.mono, fontSize: 11.5, color: cssVar("faint"),
};
const empty: CSSProperties = {
  margin: 0, padding: `${space.lg}px ${space.md}px`,
  textAlign: "center", fontSize: 13, color: cssVar("faint"),
};
const footer: CSSProperties = {
  display: "flex", gap: space.md, margin: 0,
  fontSize: 11.5, color: cssVar("faint"),
};

function matches(action: CommandAction, needle: string): boolean {
  if (needle.length === 0) return true;
  if (action.label.toLowerCase().includes(needle)) return true;
  return typeof action.hint === "string" && action.hint.toLowerCase().includes(needle);
}

/**
 * Filterable command list driven entirely by props — no sockets, no stores and
 * no global key listeners. The shell decides what an action does.
 */
export function CommandPalette({
  actions,
  onRun,
  onClose,
  placeholder = "Type a command…",
}: CommandPaletteProps): ReactElement {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);

  const needle = query.trim().toLowerCase();
  const filtered = useMemo(
    () => actions.filter((action): boolean => matches(action, needle)),
    [actions, needle],
  );

  // Keep the highlight inside the new result set whenever the filter narrows it.
  useEffect(() => {
    setSelected((previous): number => {
      if (filtered.length === 0) return 0;
      return Math.min(previous, filtered.length - 1);
    });
  }, [filtered.length]);

  function onQueryChange(event: ChangeEvent<HTMLInputElement>): void {
    setQuery(event.target.value);
    setSelected(0);
  }

  function step(delta: number): void {
    if (filtered.length === 0) return;
    setSelected((previous): number => (previous + delta + filtered.length) % filtered.length);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      step(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      step(-1);
      return;
    }
    if (event.key === "Enter") {
      const action = filtered[selected];
      if (action === undefined) return;
      event.preventDefault();
      onRun(action.id);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  return (
    <div className="commandpalette" style={panel} role="dialog" aria-modal="true" aria-label="Command palette">
      <input
        className="commandpalette__query"
        type="text"
        style={input}
        value={query}
        placeholder={placeholder}
        aria-label="Search commands"
        aria-controls="commandpalette-list"
        aria-activedescendant={
          filtered.length > 0 ? `commandpalette-option-${filtered[selected]?.id ?? ""}` : undefined
        }
        autoComplete="off"
        spellCheck={false}
        autoFocus
        onChange={onQueryChange}
        onKeyDown={onKeyDown}
      />

      {filtered.length === 0 ? (
        <p className="commandpalette__empty" style={empty} role="status">
          No matching commands.
        </p>
      ) : (
        <ul className="commandpalette__list" id="commandpalette-list" role="listbox" aria-label="Commands" style={list}>
          {filtered.map((action, index): ReactElement => {
            const active = index === selected;
            return (
              <li
                key={action.id}
                id={`commandpalette-option-${action.id}`}
                className="commandpalette__row"
                role="option"
                aria-selected={active}
                style={active ? rowSelected : rowBase}
                onMouseEnter={(): void => setSelected(index)}
                onClick={(): void => onRun(action.id)}
              >
                <span style={labelStyle}>{action.label}</span>
                {action.hint === undefined ? null : <span style={hintStyle}>{action.hint}</span>}
              </li>
            );
          })}
        </ul>
      )}

      <p style={footer}>
        <span>↑↓ to move</span>
        <span>Enter to run</span>
        <span>Esc to close</span>
      </p>
    </div>
  );
}

export default CommandPalette;
