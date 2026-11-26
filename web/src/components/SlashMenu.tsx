import { useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { cssVar, fonts, radii, space } from "../theme";

/**
 * The slash menu: what `/` could mean, as the owner types it.
 *
 * Props only — the composer owns the text, the socket and the decision to show
 * this. The menu filters by the typed prefix, marks one row as highlighted and
 * hands a picked name back. With nothing to offer it renders nothing at all, so
 * the composer never has to ask whether to mount it.
 */

export interface SlashCommand {
  /** What is typed after the slash, without the slash. */
  readonly name: string;
  readonly description: string;
}

export interface SlashMenuProps {
  commands: readonly SlashCommand[];
  /** What the owner has typed after the slash; empty means "everything". */
  prefix: string;
  /**
   * Which row is highlighted. The menu keeps its own index when the shell does
   * not pass one, so both a controlled and a self-contained use work.
   */
  highlight?: number;
  onPick: (name: string) => void;
  /** Told the new index after an arrow key, so the shell can remember it. */
  onHighlightChange?: (index: number) => void;
}

const listStyle: CSSProperties = {
  display: "flex", flexDirection: "column", gap: 2, margin: 0, padding: space.xs,
  listStyle: "none", maxHeight: 280, overflowY: "auto",
  border: `1px solid ${cssVar("line")}`, borderRadius: radii.md,
  background: cssVar("surface"), color: cssVar("fg"), fontFamily: fonts.sans,
  boxShadow: "0 12px 32px rgba(0, 0, 0, 0.4)",
};
const rowStyle: CSSProperties = {
  display: "flex", alignItems: "baseline", gap: space.sm, width: "100%",
  padding: `${space.xs}px ${space.sm}px`, border: "1px solid transparent",
  borderRadius: radii.sm, background: "transparent", color: "inherit",
  font: "inherit", textAlign: "left", cursor: "pointer",
};
const rowActive: CSSProperties = {
  ...rowStyle, borderColor: cssVar("lineSoft"), background: cssVar("lineSoft"),
};
const nameStyle: CSSProperties = {
  fontFamily: fonts.mono, fontSize: 13, color: cssVar("accent"),
};
const descriptionStyle: CSSProperties = {
  fontSize: 12.5, color: cssVar("muted"), overflow: "hidden",
  textOverflow: "ellipsis", whiteSpace: "nowrap",
};

/**
 * The commands whose name starts with the prefix, case-insensitively. A leading
 * slash and surrounding padding are tolerated: the caller may hand over either
 * `re` or `/re` and get the same list.
 */
export function filterCommands(
  commands: readonly SlashCommand[],
  prefix: string,
): SlashCommand[] {
  const needle = prefix.trim().replace(/^\//, "").toLowerCase();
  if (needle === "") return [...commands];
  return commands.filter((command): boolean => command.name.toLowerCase().startsWith(needle));
}

/** Keeps a remembered index inside the list, however much the list shrank. */
export function clampHighlight(index: number, count: number): number {
  if (count <= 0) return 0;
  if (!Number.isFinite(index) || index < 0) return 0;
  return Math.min(Math.floor(index), count - 1);
}

/** Moves the highlight by `delta`, wrapping at both ends. */
export function stepHighlight(index: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  const next = (clampHighlight(index, count) + delta) % count;
  return next < 0 ? next + count : next;
}

/**
 * The command a pick would choose: the highlighted row of the filtered list, or
 * null when there is nothing to choose.
 */
export function highlightedCommand(
  commands: readonly SlashCommand[],
  prefix: string,
  index: number,
): SlashCommand | null {
  const filtered = filterCommands(commands, prefix);
  return filtered[clampHighlight(index, filtered.length)] ?? null;
}

export function SlashMenu({
  commands,
  prefix,
  highlight,
  onPick,
  onHighlightChange,
}: SlashMenuProps) {
  const [ownHighlight, setOwnHighlight] = useState(0);
  const filtered = filterCommands(commands, prefix);
  const active = clampHighlight(highlight ?? ownHighlight, filtered.length);

  if (filtered.length === 0) return null;

  function move(delta: number): void {
    const next = stepHighlight(active, delta, filtered.length);
    if (highlight === undefined) setOwnHighlight(next);
    onHighlightChange?.(next);
  }

  function pick(index: number): void {
    const command = filtered[clampHighlight(index, filtered.length)];
    if (command !== undefined) onPick(command.name);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      move(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      pick(active);
    }
  }

  return (
    // tabIndex lets the menu take the arrow keys when the shell focuses it;
    // otherwise it is a plain list the composer's own handler drives.
    <div
      className="slashmenu"
      role="listbox"
      aria-label="Slash commands"
      tabIndex={-1}
      style={listStyle}
      onKeyDown={onKeyDown}
    >
      {filtered.map((command, index) => (
        <button
          key={command.name}
          type="button"
          id={`slashmenu-option-${command.name}`}
          className="slashmenu__row"
          role="option"
          aria-selected={index === active}
          data-name={command.name}
          data-index={index}
          style={index === active ? rowActive : rowStyle}
          onMouseEnter={(): void => {
            if (index === active) return;
            if (highlight === undefined) setOwnHighlight(index);
            onHighlightChange?.(index);
          }}
          onClick={(): void => pick(index)}
        >
          <span className="slashmenu__name" style={nameStyle}>
            /{command.name}
          </span>
          <span className="slashmenu__description" style={descriptionStyle}>
            {command.description}
          </span>
        </button>
      ))}
    </div>
  );
}

export default SlashMenu;
