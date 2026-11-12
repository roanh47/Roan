import type { CSSProperties, ReactElement } from "react";

import { cssVar, fonts, radii, space } from "../theme";
import type { ColorToken } from "../theme";

export type StatusState = "live" | "syncing" | "offline";

export interface StatusBarProps {
  /** Drives the coloured state dot only; the bar never mutates data. */
  state: StatusState;
  /** Chain identifier, e.g. "roan-mainnet". */
  chainId: string;
  /** Chain head sequence number; negative or non-finite values read as 0. */
  headSeq: number;
  /** Connected peer count; negative or non-finite values read as 0. */
  peerCount: number;
  /** Active model name, e.g. "deepseek-v4.1-flash". */
  modelName: string;
}

const S = space;
const R = radii;
const stateMeta: Readonly<Record<StatusState, { readonly token: ColorToken; readonly label: string }>> = Object.freeze({
  live: { token: "accent", label: "Live" },
  syncing: { token: "warn", label: "Syncing" },
  offline: { token: "danger", label: "Offline" },
});

const styles = {
  bar: {
    display: "flex", alignItems: "center", gap: S.sm,
    padding: `${S.xs}px ${S.sm}px`, border: `1px solid ${cssVar("lineSoft")}`,
    borderRadius: R.sm, background: cssVar("surface2"), color: cssVar("muted"),
    fontFamily: fonts.mono, fontSize: 12, lineHeight: 1.5,
    whiteSpace: "nowrap", overflow: "hidden",
  },
  item: { display: "inline-flex", alignItems: "center", gap: S.xs, minWidth: 0 },
  dot: { flex: "0 0 auto", width: 7, height: 7, borderRadius: R.pill },
  strong: { color: cssVar("fg") },
  faint: { color: cssVar("faint") },
  ellipsis: { overflow: "hidden", textOverflow: "ellipsis", maxWidth: 160 },
  separator: { color: cssVar("line") },
} as const satisfies Record<string, CSSProperties>;

/** Coerces any input to a non-negative integer; bad input reads as 0. */
function safeCount(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

function text(value: string, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function Sep(): ReactElement {
  return (
    <span aria-hidden="true" style={styles.separator}>
      ·
    </span>
  );
}

/** Compact status readout: dot, chain id, head seq, peers, model. Presentational only. */
export default function StatusBar({
  state,
  chainId,
  headSeq,
  peerCount,
  modelName,
}: StatusBarProps): ReactElement {
  const head = safeCount(headSeq);
  const peers = safeCount(peerCount);
  const meta = stateMeta[state] ?? stateMeta.offline;
  const chain = text(chainId, "unknown");
  const model = text(modelName, "no model");
  const peerLabel = `${peers} ${peers === 1 ? "peer" : "peers"}`;

  return (
    <div
      className="status-bar"
      style={styles.bar}
      role="status"
      aria-live="polite"
      aria-label={`${meta.label}, chain ${chain}, head #${head}, ${peerLabel}, model ${model}`}
    >
      <span className="status-bar__state" style={styles.item}>
        <span aria-hidden="true" style={{ ...styles.dot, background: cssVar(meta.token) }} />
        <span style={{ color: cssVar(meta.token) }}>{meta.label}</span>
      </span>
      <Sep />
      <span
        className="status-bar__chain"
        style={{ ...styles.item, ...styles.strong, ...styles.ellipsis }}
        title={chain}
      >
        {chain}
      </span>
      <Sep />
      <span className="status-bar__head" style={{ ...styles.item, ...styles.strong }}>
        head #{head}
      </span>
      <Sep />
      <span className="status-bar__peers" style={styles.item}>
        {peerLabel}
      </span>
      <Sep />
      <span
        className="status-bar__model"
        style={{ ...styles.item, ...styles.faint, ...styles.ellipsis }}
        title={model}
      >
        {model}
      </span>
    </div>
  );
}
