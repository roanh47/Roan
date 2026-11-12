import type { CSSProperties, ReactElement } from "react";

import { cssVar, fonts, radii, space } from "../theme";

export type ToolStatus = "running" | "ok" | "error";

export interface ToolTimelineEntry {
  /** Stable id from the chain event; used as the React key. */
  id: string;
  name: string;
  /** Raw arguments the model emitted, usually a JSON object. */
  args: string;
  status: ToolStatus;
  output?: string;
  durationMs?: number;
}

export interface ToolTimelineProps {
  calls: readonly ToolTimelineEntry[];
  /** Shown when there is nothing to list. */
  emptyLabel?: string;
}

const S = space;
const OUTPUT_LIMIT = 4000;
const SUMMARY_LIMIT = 76;

const LABEL: Record<ToolStatus, string> = { running: "running", ok: "done", error: "failed" };

const DOT: Record<ToolStatus, CSSProperties> = {
  running: { background: cssVar("warn"), boxShadow: "0 0 0 3px rgba(240, 198, 116, 0.18)" },
  ok: { background: cssVar("accent") },
  error: { background: cssVar("danger") },
};

function clip(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

/** One compact line: `path=src/a.ts · limit=20` for JSON, else the raw text. */
function summarizeArgs(args: string): string {
  const text = args.trim();
  if (text.length === 0) return "no arguments";
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      const parts: string[] = [];
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (parts.length === 3) break;
        const shown = typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
        parts.push(`${key}=${clip(shown, 28)}`);
      }
      if (parts.length === 0) return "no arguments";
      return clip(parts.join(" · "), SUMMARY_LIMIT);
    }
  } catch {
    // Not JSON — fall through and show the raw argument text.
  }
  return clip(text, SUMMARY_LIMIT);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 1000)}s`;
}

const styles = {
  list: { display: "flex", flexDirection: "column", margin: 0, padding: 0, listStyle: "none" },
  item: { position: "relative", minWidth: 0, paddingLeft: S.xl, paddingBottom: S.lg },
  rail: { position: "absolute", left: 0, top: 4, bottom: 0, width: 9 },
  dot: { position: "absolute", left: 0, top: 0, width: 9, height: 9, borderRadius: "50%", background: cssVar("surface2") },
  line: { position: "absolute", left: 4, top: S.md, bottom: 0, width: 1, background: cssVar("lineSoft") },
  head: { display: "flex", alignItems: "baseline", gap: S.sm, minWidth: 0 },
  name: { color: cssVar("fg"), fontFamily: fonts.mono, fontSize: 13, fontWeight: 600, overflowWrap: "anywhere" },
  meta: { marginLeft: "auto", flex: "none", color: cssVar("faint"), fontFamily: fonts.sans, fontSize: 11 },
  args: { margin: `${S.xs}px 0 0`, color: cssVar("muted"), fontFamily: fonts.mono, fontSize: 12, lineHeight: 1.45, overflowWrap: "anywhere" },
  details: { marginTop: S.sm },
  summary: { color: cssVar("faint"), fontFamily: fonts.sans, fontSize: 11, letterSpacing: 0.3, textTransform: "uppercase", cursor: "pointer" },
  pre: {
    maxHeight: 220,
    margin: `${S.xs}px 0 0`,
    padding: `${S.sm}px ${S.md}px`,
    border: `1px solid ${cssVar("lineSoft")}`,
    borderRadius: radii.sm,
    background: cssVar("surface2"),
    color: cssVar("muted"),
    fontFamily: fonts.mono,
    fontSize: 12,
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
    overflow: "auto",
    overflowWrap: "anywhere",
  },
  note: { margin: `${S.xs}px 0 0`, color: cssVar("faint"), fontFamily: fonts.sans, fontSize: 11 },
  empty: { margin: 0, color: cssVar("faint"), fontFamily: fonts.sans, fontSize: 12 },
} as const;

/**
 * Vertical run of tool calls: a status dot per call, the tool name, a one-line
 * argument summary and an output that opens on demand. Presentational only.
 */
export function ToolTimeline({ calls, emptyLabel = "No tool calls yet" }: ToolTimelineProps): ReactElement {
  if (calls.length === 0) {
    return <p className="tool-timeline__empty" style={styles.empty}>{emptyLabel}</p>;
  }

  return (
    <ol className="tool-timeline" style={styles.list} aria-label="Tool calls">
      {calls.map((call, index) => {
        const output = call.output;
        const body = output === undefined ? "" : output.length > OUTPUT_LIMIT ? `${output.slice(0, OUTPUT_LIMIT)}…` : output;
        const duration = typeof call.durationMs === "number" ? ` · ${formatDuration(call.durationMs)}` : "";

        return (
          <li key={call.id} className={`tool-timeline__item tool-timeline__item--${call.status}`} style={styles.item}>
            <span style={styles.rail} aria-hidden="true">
              {index === calls.length - 1 ? null : <span style={styles.line} />}
              <span style={{ ...styles.dot, ...DOT[call.status] }} />
            </span>

            <div style={styles.head}>
              <code style={styles.name}>{call.name}</code>
              <span style={styles.meta}>{LABEL[call.status]}{duration}</span>
            </div>

            <p style={styles.args} title={call.args}>{summarizeArgs(call.args)}</p>

            {output !== undefined ? (
              <details style={styles.details}>
                <summary style={styles.summary}>{`Output · ${output.length.toLocaleString()} chars`}</summary>
                <pre style={styles.pre} tabIndex={0}>{body.length > 0 ? body : "(empty)"}</pre>
                {output.length > OUTPUT_LIMIT ? (
                  <p style={styles.note}>{`Showing the first ${OUTPUT_LIMIT.toLocaleString()} characters.`}</p>
                ) : null}
              </details>
            ) : call.status === "running" ? (
              <p style={styles.note} role="status">Waiting for output…</p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export default ToolTimeline;
