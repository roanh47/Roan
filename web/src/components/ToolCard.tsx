import { useState } from "react";
import type { ReactElement } from "react";

export interface ToolCardProps {
  name: string;
  status: "running" | "ok" | "error";
  input: string;
  output?: string;
  durationMs?: number;
  defaultOpen?: boolean;
}

const LIMIT = 4000;

const OUTCOME: Record<ToolCardProps["status"], string> = {
  running: "running",
  ok: "ok",
  error: "failed",
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 1000)}s`;
}

function Block({
  label,
  text,
  empty,
}: {
  label: string;
  text: string;
  empty: string;
}): ReactElement {
  const [showAll, setShowAll] = useState(false);
  const long = text.length > LIMIT;
  const body = long && !showAll ? `${text.slice(0, LIMIT)}…` : text;

  return (
    <section className="toolcard__block">
      <div className="toolcard__blockHead">
        <span className="toolcard__blockLabel">{label}</span>
        {long ? (
          <button
            type="button"
            className="toolcard__more"
            aria-expanded={showAll}
            onClick={() => setShowAll(!showAll)}
          >
            {showAll ? "show less" : `show all ${text.length.toLocaleString()} chars`}
          </button>
        ) : null}
      </div>
      <pre className="toolcard__pre" style={{ maxHeight: 240 }} tabIndex={0}>
        {text.length > 0 ? body : empty}
      </pre>
    </section>
  );
}

export function ToolCard({
  name,
  status,
  input,
  output,
  durationMs,
  defaultOpen = false,
}: ToolCardProps): ReactElement {
  const [open, setOpen] = useState(defaultOpen);
  const duration = typeof durationMs === "number" ? formatDuration(durationMs) : null;

  return (
    <article className={`toolcard toolcard--${status}`}>
      <button
        type="button"
        className="toolcard__head"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className={`toolcard__dot toolcard__dot--${status}`} aria-hidden="true" />
        <span className="toolcard__name">{name}</span>
        <span className="toolcard__outcome">
          {OUTCOME[status]}
          {duration ? ` · ${duration}` : ""}
        </span>
        <span className="toolcard__chev" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open ? (
        <div className="toolcard__body">
          <Block label="input" text={input} empty="no input" />
          {output !== undefined ? (
            <Block label="output" text={output} empty={status === "running" ? "waiting for output" : "no output"} />
          ) : status === "running" ? (
            <p className="toolcard__note">Waiting for output…</p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
