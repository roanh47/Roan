import { useMemo, type ReactElement } from "react";
import { compactNumber, summariseUsage, type Totals, type UsageEventLike } from "../usage-totals.js";

/**
 * Usage: how much Roan has used, on all your devices together.
 *
 * Counted from the chain, so it is the same number on every device. Tokens
 * in are what Roan read (your messages, files, tool output); tokens out are
 * what it wrote.
 */
function Tile({ label, totals }: { label: string; totals: Totals }): ReactElement {
  return (
    <div className="panel__item" style={{ flex: "1 1 140px" }}>
      <span className="panel__sub">{label}</span>
      <span className="panel__path">{compactNumber(totals.input + totals.output)} tokens</span>
      <span className="panel__sub">
        {String(totals.turns)} {totals.turns === 1 ? "turn" : "turns"} · {compactNumber(totals.input)} in ·{" "}
        {compactNumber(totals.output)} out
      </span>
    </div>
  );
}

export function UsagePanel({ events }: { events: readonly UsageEventLike[] }): ReactElement {
  const summary = useMemo(() => summariseUsage(events), [events]);
  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">Usage</h2>
      </header>
      <p className="panel__sub">What Roan used across all your devices. Counted per finished turn.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Tile label="Today" totals={summary.today} />
        <Tile label="Last 7 days" totals={summary.week} />
        <Tile label="All time" totals={summary.all} />
      </div>
      <ul className="panel__list">
        {summary.days.slice(0, 30).map((day) => (
          <li key={day.day} className="panel__item">
            <span className="panel__path">{day.day}</span>
            <span className="panel__sub">
              {compactNumber(day.input + day.output)} tokens · {String(day.turns)} {day.turns === 1 ? "turn" : "turns"} ·{" "}
              {compactNumber(day.input)} in · {compactNumber(day.output)} out
            </span>
          </li>
        ))}
        {summary.days.length === 0 ? (
          <li className="panel__empty">Nothing counted yet. Some providers do not report usage.</li>
        ) : null}
      </ul>
    </section>
  );
}

export default UsagePanel;
