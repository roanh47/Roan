import type { CSSProperties, ReactElement } from "react";

import { cssVar, fonts, radii, space } from "../theme";
import type { ColorToken } from "../theme";

export type StatusState = "live" | "syncing" | "offline";

export interface StatusBarProps {
  /** Chain head sequence number. Negative or non-finite values render as 0. */
  headSeq: number;
  /** Connected peer count. Negative or non-finite values render as 0. */
  peerCount: number;
  /** Human label for the active transport, e.g. "iroh" or "local". */
  providerLabel: string;
  /** Drives the coloured state dot only — the bar never changes data itself. */
  state: StatusState;
  /** When given, a refresh button is rendered and calls this; when absent, no button. */
  onRefresh?: () => void;
}

const S = space;
const R = radii;

/** State -> (dot colour token, accessible label). */
const stateMeta: Readonly<
  Record<StatusState, { readonly token: ColorToken; readonly label: string }>
> = Object.freeze({
  live: { token: "accent", label: "Live" },
  syncing: { token: "warn", label: "Syncing" },
  offline: { token: "danger", label: "Offline" },
});

const styles = {
  bar: {
    display: "flex",
    alignItems: "center",
    gap: S.md,
    flexWrap: "nowrap",
    padding: `${S.xs}px ${S.sm}px`,
    border: `1px solid ${cssVar("lineSoft")}`,
    borderRadius: R.sm,
    background: cssVar("surface2"),
    color: cssVar("muted"),
    fontFamily: fonts.mono,
    fontSize: 12,
    lineHeight: 1.5,
    whiteSpace: "nowrap",
    overflow: "hidden",
  },
  item: {
    display: "inline-flex",
    alignItems: "center",
    gap: S.xs,
    minWidth: 0,
  },
  dot: {
    display: "inline-block",
    flex: "0 0 auto",
    width: 7,
    height: 7,
    borderRadius: R.pill,
  },
  head: {
    color: cssVar("fg"),
  },
  provider: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    color: cssVar("faint"),
  },
  separator: {
    color: cssVar("line"),
  },
  refresh: {
    marginLeft: "auto",
    flex: "0 0 auto",
    font: "inherit",
    fontSize: 12,
    lineHeight: 1,
    padding: `${S.xs}px ${S.sm}px`,
    border: `1px solid ${cssVar("line")}`,
    borderRadius: R.sm,
    background: "transparent",
    color: cssVar("fg"),
    cursor: "pointer",
  },
} as const satisfies Record<string, CSSProperties>;

/** Coerces any input to a non-negative integer; bad input reads as 0. */
function safeCount(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

function peersLabel(count: number): string {
  return `${count} ${count === 1 ? "peer" : "peers"}`;
}

/**
 * Compact single-row chain/peer/provider readout. Presentational only — the
 * shell owns the socket, the polling and the refresh action.
 */
export function StatusBar({
  headSeq,
  peerCount,
  providerLabel,
  state,
  onRefresh,
}: StatusBarProps): ReactElement {
  const head = safeCount(headSeq);
  const peers = safeCount(peerCount);
  const meta = stateMeta[state] ?? stateMeta.offline;
  const provider = typeof providerLabel === "string" && providerLabel.length > 0 ? providerLabel : "unknown";

  return (
    <div
      className="status-bar"
      style={styles.bar}
      role="status"
      aria-live="polite"
      aria-label={`Chain head #${head}, ${peersLabel(peers)}, provider ${provider}, ${meta.label}`}
    >
      <span className="status-bar__state" style={styles.item}>
        <span
          aria-hidden="true"
          style={{ ...styles.dot, background: cssVar(meta.token) }}
        />
        <span style={{ color: cssVar(meta.token) }}>{meta.label}</span>
      </span>

      <span aria-hidden="true" style={styles.separator}>
        ·
      </span>

      <span className="status-bar__head" style={{ ...styles.item, ...styles.head }}>
        head #{head}
      </span>

      <span aria-hidden="true" style={styles.separator}>
        ·
      </span>

      <span className="status-bar__peers" style={styles.item}>
        {peersLabel(peers)}
      </span>

      <span aria-hidden="true" style={styles.separator}>
        ·
      </span>

      <span className="status-bar__provider" style={{ ...styles.item, ...styles.provider }}>
        {provider}
      </span>

      {onRefresh !== undefined ? (
        <button
          type="button"
          className="status-bar__refresh"
          style={styles.refresh}
          aria-label="Refresh status"
          onClick={onRefresh}
        >
          Refresh
        </button>
      ) : null}
    </div>
  );
}

export default StatusBar;
