import { useState, type ReactElement } from "react";

/** Where a goal stands; mirrors the `goal` event's status field. */
export type GoalStatus = "open" | "done" | "cancelled";

/** One standing order, as folded from the chain by `foldGoals`. */
export interface Goal {
  id: string;
  text: string;
  status: GoalStatus;
  createdAt: number;
  note?: string;
}

interface Props {
  goals: readonly Goal[];
  /** Close (mark done) one goal by id; the caller appends the event. */
  onClose: (id: string) => void;
  /** Add an order with this text; the caller appends the `goal` event. */
  onCreate: (text: string) => void;
}

const LABELS: Record<GoalStatus, string> = {
  open: "Open",
  done: "Done",
  cancelled: "Cancelled",
};

/**
 * Standing orders, newest last. The panel owns no fetching: the chain folds the
 * goals and hands them in, and a click leaves as a callback so the single
 * writer of the turn stays the only one appending events.
 */
export function GoalsPanel({ goals, onClose, onCreate }: Props): ReactElement {
  const [text, setText] = useState("");

  function submit(): void {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    onCreate(trimmed);
    setText("");
  }

  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">Standing orders</h2>
      </header>

      <ul className="panel__list">
        {goals.length === 0 ? <li className="panel__empty">No standing orders.</li> : null}
        {goals.map((goal) => (
          <li key={goal.id} className="panel__row panel__row--static">
            <div>
              <div className="panel__path">{goal.text}</div>
              <div className="panel__sub">
                {LABELS[goal.status]}
                {goal.note !== undefined && goal.note.length > 0 ? ` · ${goal.note}` : ""}
              </div>
            </div>
            <div className="panel__actions">
              <button
                type="button"
                className="rail__button"
                disabled={goal.status !== "open"}
                aria-label={`Close ${goal.text}`}
                onClick={() => onClose(goal.id)}
              >
                Close
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="panel__form">
        <input
          className="panel__input"
          placeholder="A standing order (e.g. keep the chain append-only)"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
        />
        <button type="button" className="panel__primary" onClick={submit}>
          Add order
        </button>
      </div>
    </section>
  );
}
