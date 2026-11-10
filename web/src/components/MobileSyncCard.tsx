import { useEffect, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { cssVar, fonts, radii, space } from "../theme";

export interface MobileSyncCardProps {
  /** Epoch ms of the phone's last successful sync, or null when it never synced. */
  lastSyncAt: number | null;
  /** Head sequence number of the chain as this device sees it. */
  headSeq: number;
  /** Head sequence number the phone reports, or null when it is not paired. */
  phoneHeadSeq: number | null;
  /** Shown with a copy button only when it is a non-empty string. */
  pairingCode?: string;
  /** Copy handler owned by the shell; the card never touches the clipboard itself. */
  onCopyCode?: () => void;
}

const TICK_MS = 30_000;

const section: CSSProperties = {
  display: "flex", flexDirection: "column", gap: space.md,
  padding: space.lg, border: `1px solid ${cssVar("line")}`,
  borderRadius: radii.lg, background: cssVar("surface"),
  color: cssVar("fg"), fontFamily: fonts.sans,
};
const title: CSSProperties = { margin: 0, fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em" };
const rows: CSSProperties = {
  display: "grid", gridTemplateColumns: "auto 1fr", gap: `${space.xs}px ${space.md}px`,
  margin: 0, fontSize: 13, alignItems: "baseline",
};
const key: CSSProperties = { margin: 0, color: cssVar("muted") };
const value: CSSProperties = { margin: 0, color: cssVar("fg") };
const codeBox: CSSProperties = {
  display: "flex", alignItems: "center", flexWrap: "wrap", gap: space.sm,
  padding: space.sm, border: `1px solid ${cssVar("lineSoft")}`,
  borderRadius: radii.sm, background: cssVar("surface2"),
};
const codeStyle: CSSProperties = {
  fontFamily: fonts.mono, fontSize: 13, letterSpacing: "0.04em", color: cssVar("fg"),
  padding: `${space.xs}px ${space.sm}px`, wordBreak: "break-all",
};
const button: CSSProperties = {
  padding: `${space.xs}px ${space.md}px`, border: `1px solid ${cssVar("line")}`,
  borderRadius: radii.sm, background: cssVar("surface2"), color: cssVar("fg"),
  font: "inherit", fontSize: 13, cursor: "pointer",
};
const hint: CSSProperties = { margin: 0, fontSize: 12, color: cssVar("faint") };

/**
 * Pure helper: a coarse, human relative time. `now` is injectable so callers
 * (and tests) never depend on the wall clock. Never negative — a clock skew
 * forward on the sender reads as "just now".
 */
export function relativeTime(then: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

type SyncState = "unpaired" | "ahead-of-phone" | "current";

function syncState(phoneHeadSeq: number | null, headSeq: number): SyncState {
  if (phoneHeadSeq === null) return "unpaired";
  return phoneHeadSeq < headSeq ? "ahead-of-phone" : "current";
}

function syncLabel(state: SyncState, phoneHeadSeq: number | null, headSeq: number): string {
  if (state === "unpaired" || phoneHeadSeq === null) return "not paired";
  const behind = headSeq - phoneHeadSeq;
  if (behind > 0) return `behind by ${behind} ${behind === 1 ? "event" : "events"}`;
  return "up to date";
}

/**
 * Whether the phone is keeping up with this chain. Presentational only — the
 * shell owns the socket, the timers and the clipboard.
 */
export function MobileSyncCard({
  lastSyncAt,
  headSeq,
  phoneHeadSeq,
  pairingCode,
  onCopyCode,
}: MobileSyncCardProps): ReactElement {
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const state = syncState(phoneHeadSeq, headSeq);
  const statusColor = state === "current" ? cssVar("accent") : cssVar("warn");
  const lastSync = lastSyncAt === null ? "never" : relativeTime(lastSyncAt);
  const code = typeof pairingCode === "string" && pairingCode.length > 0 ? pairingCode : null;

  return (
    <section style={section} aria-labelledby="mobile-sync-title">
      <h2 style={title} id="mobile-sync-title">
        Phone sync
      </h2>

      <dl style={rows}>
        <dt style={key}>Last sync</dt>
        <dd style={value}>{lastSync}</dd>

        <dt style={key}>Phone</dt>
        <dd style={{ ...value, color: statusColor }}>{syncLabel(state, phoneHeadSeq, headSeq)}</dd>

        <dt style={key}>Chain head</dt>
        <dd style={{ ...value, fontFamily: fonts.mono }}>#{headSeq}</dd>
      </dl>

      {state === "ahead-of-phone" && phoneHeadSeq !== null ? (
        <p style={hint}>
          The phone has {phoneHeadSeq} of {headSeq} events. It catches up the next time it comes
          online.
        </p>
      ) : null}

      {code !== null ? (
        <div style={codeBox}>
          <code style={codeStyle}>{code}</code>
          <button
            type="button"
            style={button}
            aria-label="Copy pairing code"
            disabled={onCopyCode === undefined}
            onClick={onCopyCode}
          >
            Copy
          </button>
        </div>
      ) : null}

      {code !== null && onCopyCode === undefined ? (
        <p style={hint}>
          Copying is not available in this view.
        </p>
      ) : null}
    </section>
  );
}

export default MobileSyncCard;
