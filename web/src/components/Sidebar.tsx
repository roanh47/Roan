import { useId, useMemo, useState } from "react";
import type { ChangeEvent, CSSProperties, ReactElement } from "react";
import { cssVar, fonts, radii, space } from "../theme";

/** One entry in the sidebar. The host app owns the list; this file only draws it. */
export interface SessionSummary {
  id: string;
  title: string;
  /** Epoch milliseconds of the last event. Drives the newest-first order. */
  updatedAt: number;
  /** Last line of the transcript, shown under the title. */
  preview?: string;
  unread?: boolean;
}

export interface SidebarProps {
  sessions: readonly SessionSummary[];
  /** The open session, or null when nothing is selected. */
  activeId: string | null;
  onSelect: (id: string) => void;
  /** Omit to hide the new-session action. */
  onNewSession?: () => void;
  /** Injectable clock so relative times can be rendered in tests. */
  now?: number;
}

const nav: CSSProperties = {
  display: "flex", flexDirection: "column", gap: space.md, height: "100%", minHeight: 0,
  padding: space.lg, borderRight: `1px solid ${cssVar("line")}`,
  background: cssVar("surface"), color: cssVar("fg"), fontFamily: fonts.sans,
};
const head: CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: space.sm,
};
const heading: CSSProperties = {
  margin: 0, fontSize: 12, fontWeight: 600, letterSpacing: "0.08em",
  textTransform: "uppercase", color: cssVar("muted"),
};
const action: CSSProperties = {
  padding: `${space.xs}px ${space.sm}px`, border: `1px solid ${cssVar("line")}`,
  borderRadius: radii.sm, background: cssVar("surface2"), color: cssVar("fg"),
  font: "inherit", fontSize: 12, cursor: "pointer",
};
const input: CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: `${space.sm}px ${space.md}px`,
  border: `1px solid ${cssVar("line")}`, borderRadius: radii.sm,
  background: cssVar("surface2"), color: cssVar("fg"), font: "inherit", fontSize: 13,
};
const list: CSSProperties = {
  flex: 1, minHeight: 0, overflowY: "auto", margin: 0, padding: 0, listStyle: "none",
  display: "flex", flexDirection: "column", gap: 2,
};
const item: CSSProperties = {
  display: "flex", flexDirection: "column", gap: 2, width: "100%", boxSizing: "border-box",
  padding: `${space.sm}px ${space.md}px`, border: "1px solid transparent",
  borderLeft: "2px solid transparent", borderRadius: radii.sm, background: "transparent",
  color: "inherit", font: "inherit", textAlign: "left", cursor: "pointer",
};
const itemTitle: CSSProperties = {
  display: "flex", alignItems: "center", gap: space.xs, fontSize: 13, lineHeight: 1.3,
};
const ellipsis: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const meta: CSSProperties = {
  display: "flex", justifyContent: "space-between", gap: space.sm, fontSize: 11, color: cssVar("faint"),
};
const preview: CSSProperties = { ...ellipsis, flex: 1, minWidth: 0, color: cssVar("muted") };
const dot: CSSProperties = {
  flex: "0 0 auto", width: 6, height: 6, borderRadius: radii.pill, background: cssVar("accent"),
};
const empty: CSSProperties = { margin: 0, padding: space.sm, fontSize: 12, color: cssVar("faint") };

/** Compact relative time: seconds, minutes, hours, then a date past a week. */
function ago(then: number, now: number): string {
  const minutes = Math.round(Math.max(0, now - then) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Newest first, filtered on title and preview; ties fall back to the title. */
export function selectSessions(sessions: readonly SessionSummary[], query: string): SessionSummary[] {
  const needle = query.trim().toLowerCase();
  const hit = (session: SessionSummary): boolean =>
    needle.length === 0 || session.title.toLowerCase().includes(needle) ||
    (session.preview ?? "").toLowerCase().includes(needle);
  return sessions.filter(hit).sort((a, b) => b.updatedAt - a.updatedAt || a.title.localeCompare(b.title));
}

export function Sidebar({
  sessions,
  activeId,
  onSelect,
  onNewSession,
  now = Date.now(),
}: SidebarProps): ReactElement {
  const [query, setQuery] = useState("");
  const [hovered, setHovered] = useState<string | null>(null);
  const searchId = useId();

  // Newest first and filtered; see selectSessions.
  const visible = useMemo(() => selectSessions(sessions, query), [sessions, query]);

  function onChange(event: ChangeEvent<HTMLInputElement>): void {
    setQuery(event.target.value);
  }

  return (
    <nav style={nav} aria-label="Sessions">
      <div style={head}>
        <h2 style={heading}>Sessions <span aria-hidden="true">{sessions.length}</span></h2>
        {onNewSession === undefined ? null : (
          <button type="button" style={action} onClick={onNewSession}>New</button>
        )}
      </div>

      <label className="sr-only" htmlFor={searchId}>
        Search sessions
      </label>
      <input
        id={searchId}
        style={input}
        type="search"
        placeholder="Search sessions…"
        autoComplete="off" spellCheck={false}
        value={query}
        onChange={onChange}
      />

      {visible.length === 0 ? (
        <p style={empty} role="status">
          {sessions.length === 0 ? "No sessions yet." : `No sessions match “${query.trim()}”.`}
        </p>
      ) : (
        <ul style={list}>
          {visible.map((session) => {
            const selected = session.id === activeId;
            const unread = session.unread === true;
            return (
              <li key={session.id}>
                <button
                  type="button"
                  style={{
                    ...item,
                    borderColor: selected ? cssVar("line") : "transparent",
                    borderLeftColor: selected ? cssVar("accent") : "transparent",
                    background: selected ? cssVar("surface2") : hovered === session.id ? cssVar("lineSoft") : "transparent",
                  }}
                  aria-current={selected ? "page" : undefined}
                  onClick={() => onSelect(session.id)}
                  onMouseEnter={() => setHovered(session.id)}
                  onMouseLeave={() => setHovered((current) => (current === session.id ? null : current))}
                >
                  <span style={{ ...itemTitle, fontWeight: selected || unread ? 600 : 400 }}>
                    <span style={{ ...ellipsis, flex: 1, minWidth: 0 }}>{session.title}</span>
                    {unread ? <span style={dot} aria-hidden="true" /> : null}
                    {unread ? <span className="sr-only">Unread</span> : null}
                  </span>
                  <span style={meta}>
                    {session.preview ? <span style={preview}>{session.preview}</span> : null}
                    <time dateTime={new Date(session.updatedAt).toISOString()} style={{ flex: "0 0 auto" }}>
                      {ago(session.updatedAt, now)}
                    </time>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
