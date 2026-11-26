/**
 * The messages waiting for the current turn to end.
 *
 * Typing while Roan works does not send anything: it queues. This strip sits
 * directly above the composer and says what will go out next, in order, so a
 * queued message is visible rather than a silent hostage. Each row can be taken
 * back by index; the queue itself is not owned here — every prop is input, so
 * the strip renders the same wherever it is mounted and holds no state of its
 * own.
 */

import type { CSSProperties, ReactElement } from "react";

export interface QueueBarProps {
  /** Pending messages, oldest first; the array order is the send order. */
  readonly queued: readonly string[];
  /** Take back one message; the index is the position in `queued`. */
  readonly onRemove: (index: number) => void;
}

const WRAP: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  padding: "8px 10px",
  border: "1px solid var(--line-soft)",
  borderRadius: 10,
  background: "var(--surface-2)",
};

const HEAD: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 6,
  fontFamily: "var(--mono)",
  fontSize: 11,
  color: "var(--faint)",
};

const LIST: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  margin: 0,
  padding: 0,
  listStyle: "none",
};

const ROW: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 8,
  fontSize: 13,
  color: "var(--muted)",
};

const POSITION: CSSProperties = {
  flex: "none",
  fontFamily: "var(--mono)",
  fontSize: 11,
  color: "var(--faint)",
};

const TEXT: CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const REMOVE: CSSProperties = {
  flex: "none",
  padding: "0 4px",
  border: "none",
  background: "transparent",
  color: "var(--faint)",
  font: "inherit",
  cursor: "pointer",
};

export default function QueueBar({ queued, onRemove }: QueueBarProps): ReactElement | null {
  if (queued.length === 0) return null;

  return (
    <section className="queuebar" aria-label={`Queued messages (${String(queued.length)})`} style={WRAP}>
      <span className="queuebar__head" style={HEAD}>
        <span>Queued</span>
        <span aria-hidden="true">·</span>
        <span>
          {String(queued.length)} {queued.length === 1 ? "message" : "messages"} waiting for the turn to end
        </span>
      </span>
      <ol className="queuebar__list" style={LIST}>
        {queued.map((text, index) => (
          <li key={`${String(index)}:${text}`} className="queuebar__item" style={ROW}>
            <span className="queuebar__position" style={POSITION} aria-hidden="true">
              {String(index + 1)}
            </span>
            <span className="queuebar__text" style={TEXT} title={text}>
              {text}
            </span>
            <button
              type="button"
              className="queuebar__remove"
              style={REMOVE}
              data-index={index}
              aria-label={`Remove queued message ${String(index + 1)}`}
              onClick={() => onRemove(index)}
            >
              ×
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
