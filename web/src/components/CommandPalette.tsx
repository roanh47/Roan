import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { cssVar, fonts, radii, space } from "../theme";

export interface CommandAction { id: string; label: string; hint?: string }

export interface CommandPaletteProps {
  /** Actions offered by the shell. Filtering happens here, the shell owns the list. */
  actions: readonly CommandAction[];
  /** Invoked with the id of the highlighted action when Enter is pressed. */
  onRun: (id: string) => void;
  /** Invoked after every close (backdrop, Escape, or running an action). */
  onClose?: () => void;
  placeholder?: string;
}

const backdrop: CSSProperties = {
  position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "flex-start",
  justifyContent: "center", padding: "12vh 16px 16px", background: "rgba(4, 6, 9, 0.62)",
};
const panel: CSSProperties = {
  display: "flex", flexDirection: "column", gap: space.sm, width: "100%", maxWidth: 520,
  padding: space.md, border: `1px solid ${cssVar("line")}`, borderRadius: radii.md,
  background: cssVar("surface"), color: cssVar("fg"), fontFamily: fonts.sans,
  boxShadow: "0 18px 48px rgba(0, 0, 0, 0.45)",
};
const inputStyle: CSSProperties = {
  padding: `${space.sm}px ${space.md}px`, border: `1px solid ${cssVar("lineSoft")}`,
  borderRadius: radii.sm, background: cssVar("surface2"), color: cssVar("fg"), font: "inherit", outline: "none",
};
const listStyle: CSSProperties = {
  display: "flex", flexDirection: "column", gap: 2, margin: 0, padding: 0, listStyle: "none", maxHeight: 320, overflowY: "auto",
};
const rowStyle: CSSProperties = {
  display: "flex", alignItems: "baseline", gap: space.sm,
  padding: `${space.sm}px ${space.md}px`, borderRadius: radii.sm, cursor: "pointer",
};
const rowActive: CSSProperties = { ...rowStyle, background: cssVar("lineSoft") };
const hintStyle: CSSProperties = {
  marginLeft: "auto", fontFamily: fonts.mono, fontSize: 11.5, color: cssVar("faint"),
};
const noteStyle: CSSProperties = {
  margin: 0, padding: `${space.lg}px ${space.md}px`, textAlign: "center", fontSize: 13, color: cssVar("faint"),
};
const footerStyle: CSSProperties = { margin: 0, fontSize: 11.5, color: cssVar("faint") };

export function CommandPalette({
  actions, onRun, onClose, placeholder = "Type a command…",
}: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return actions;
    return actions.filter((action): boolean =>
      `${action.id} ${action.label} ${action.hint ?? ""}`.toLowerCase().includes(needle),
    );
  }, [actions, query]);

  // One listener toggles the overlay and closes it from anywhere.
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent): void {
      if (event.defaultPrevented) return;
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (!event.repeat) { if (open) close(); else setOpen(true); }
      } else if (event.key === "Escape" && open) {
        event.preventDefault(); close();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return (): void => { window.removeEventListener("keydown", onKeyDown); };
  }, [open, onClose]);

  // Reopen clean, and hand focus back to whatever had it before.
  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    setQuery(""); setSelected(0);
    inputRef.current?.focus();
    return (): void => { restoreRef.current?.focus(); };
  }, [open]);

  // Keep the highlight inside the result set whenever the filter narrows it.
  useEffect(() => {
    setSelected((previous): number =>
      filtered.length === 0 ? 0 : Math.min(previous, filtered.length - 1),
    );
  }, [filtered.length]);

  if (!open) return null;

  function close(): void { setOpen(false); onClose?.(); }
  function choose(action: CommandAction): void { close(); onRun(action.id); }

  function step(delta: number): void {
    if (filtered.length === 0) return;
    setSelected((previous): number => (previous + delta + filtered.length) % filtered.length);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      step(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter") {
      const action = filtered[selected];
      if (action !== undefined) { event.preventDefault(); choose(action); }
    } else if (event.key === "Escape") { event.preventDefault(); close(); }
  }

  const active = filtered[selected];
  return (
    <div
      className="commandpalette"
      style={backdrop}
      onClick={(event): void => { if (event.target === event.currentTarget) close(); }}
    >
      <div style={panel} role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          ref={inputRef} className="commandpalette__query" type="text" style={inputStyle}
          value={query} placeholder={placeholder} aria-label="Search commands"
          role="combobox" aria-expanded="true" aria-controls="commandpalette-list"
          aria-activedescendant={active === undefined ? undefined : `commandpalette-option-${active.id}`}
          autoComplete="off" spellCheck={false}
          onChange={(event): void => { setQuery(event.target.value); setSelected(0); }}
          onKeyDown={onKeyDown}
        />

        {filtered.length === 0 ? (
          <p className="commandpalette__empty" style={noteStyle} role="status">
            No matching commands.
          </p>
        ) : (
          <ul className="commandpalette__list" id="commandpalette-list" role="listbox" style={listStyle}>
            {filtered.map((action, index) => (
              <li
                key={action.id} id={`commandpalette-option-${action.id}`}
                className="commandpalette__row" role="option" aria-selected={index === selected}
                style={index === selected ? rowActive : rowStyle}
                onMouseEnter={(): void => setSelected(index)}
                onClick={(): void => choose(action)}
              >
                <span style={{ fontSize: 13.5 }}>{action.label}</span>
                {action.hint === undefined ? null : <span style={hintStyle}>{action.hint}</span>}
              </li>
            ))}
          </ul>
        )}

        <p style={footerStyle}>↑↓ to move · Enter to run · Esc to close</p>
      </div>
    </div>
  );
}

export default CommandPalette;