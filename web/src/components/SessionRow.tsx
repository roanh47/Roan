import type { CSSProperties, ReactElement } from "react";
import { cssVar, fonts, radii, space } from "../theme";

/**
 * One row of a session list: the name, how much is in it, what it is, and the
 * two things you can do with it.
 *
 * This file only draws. The host owns the list, the requests and the result:
 * `archived` and `ephemeral` come from the chain index, and a callback fires
 * only when the owner asked for that action. Nothing here fetches, and nothing
 * here decides that a session is gone — a tombstone in the chain does that.
 */
export interface SessionRowModel {
  id: string;
  title: string;
  /** User turns in the session, as the chain counts them. */
  messages: number;
  archived?: boolean;
  /** A temporary chat: listed while you are in it, never kept as history. */
  ephemeral?: boolean;
}

export interface SessionRowProps {
  session: SessionRowModel;
  /** The conversation that is open right now. */
  active?: boolean;
  /** Omit to show the title as plain text instead of an open action. */
  onSelect?: (id: string) => void;
  /** Omit to hide archiving. Reversible, so it needs no confirmation. */
  onArchive?: (id: string) => void;
  /** Omit to hide deletion. The host owns the "are you sure". */
  onDelete?: (id: string) => void;
  /** True while a request is in flight: the actions stay, disabled. */
  busy?: boolean;
}

const row: CSSProperties = {
  display: "flex", alignItems: "center", gap: space.sm,
  padding: `${space.sm}px ${space.md}px`, border: "1px solid transparent",
  borderLeft: "2px solid transparent", borderRadius: radii.sm,
  background: "transparent", color: cssVar("fg"), fontFamily: fonts.sans,
};
const open: CSSProperties = {
  display: "flex", flex: 1, minWidth: 0, padding: 0, border: 0, background: "transparent",
  color: "inherit", font: "inherit", fontSize: 13, lineHeight: 1.3, textAlign: "left", cursor: "pointer",
};
const ellipsis: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const meta: CSSProperties = { display: "flex", alignItems: "center", gap: space.xs, flex: "0 0 auto" };
const badge: CSSProperties = {
  padding: `1px ${space.xs}px`, border: `1px solid ${cssVar("line")}`, borderRadius: radii.pill,
  fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase", color: cssVar("muted"),
  whiteSpace: "nowrap",
};
const count: CSSProperties = { fontSize: 11, color: cssVar("faint"), whiteSpace: "nowrap" };
const actions: CSSProperties = { display: "flex", alignItems: "center", gap: space.xs, flex: "0 0 auto" };
const action: CSSProperties = {
  padding: `${space.xs}px ${space.sm}px`, border: `1px solid ${cssVar("line")}`,
  borderRadius: radii.sm, background: cssVar("surface2"), color: cssVar("fg"),
  font: "inherit", fontSize: 11, cursor: "pointer",
};

function messageCount(messages: number): string {
  return messages === 1 ? "1 message" : `${String(messages)} messages`;
}

/** A row belongs in a session `<ul>`; the host supplies keys and the list. */
export function SessionRow({
  session,
  active = false,
  onSelect,
  onArchive,
  onDelete,
  busy = false,
}: SessionRowProps): ReactElement {
  const { id, title, messages } = session;
  const archived = session.archived === true;
  const ephemeral = session.ephemeral === true;
  const name = (
    <span style={{ ...ellipsis, flex: 1, minWidth: 0, fontWeight: active ? 600 : 400 }}>{title}</span>
  );

  return (
    <li
      className="sessionrow"
      data-session={id}
      style={{
        ...row,
        borderColor: active ? cssVar("line") : "transparent",
        borderLeftColor: active ? cssVar("accent") : "transparent",
        background: active ? cssVar("surface2") : "transparent",
      }}
      aria-current={active ? "true" : undefined}
    >
      {onSelect === undefined ? (
        name
      ) : (
        <button type="button" style={open} title={`Open “${title}”`} onClick={() => onSelect(id)}>
          {name}
        </button>
      )}

      <span style={meta}>
        {archived ? <span style={badge}>Archived</span> : null}
        {ephemeral ? <span style={badge}>Temporary</span> : null}
        <span style={count}>{messageCount(messages)}</span>
      </span>

      {onArchive === undefined && onDelete === undefined ? null : (
        <span style={actions}>
          {onArchive === undefined ? null : (
            <button
              type="button"
              style={action}
              disabled={busy}
              aria-label={`${archived ? "Unarchive" : "Archive"} “${title}”`}
              onClick={() => onArchive(id)}
            >
              {archived ? "Unarchive" : "Archive"}
            </button>
          )}
          {onDelete === undefined ? null : (
            <button
              type="button"
              style={{ ...action, color: cssVar("danger") }}
              disabled={busy}
              aria-label={`Delete “${title}”`}
              onClick={() => onDelete(id)}
            >
              Delete
            </button>
          )}
        </span>
      )}
    </li>
  );
}
