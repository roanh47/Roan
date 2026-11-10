import { useEffect, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { colors, cssVar, fonts, radii, space } from "../theme";

export interface EmptyStateProps {
  /** Seeds a new chain on this device. Omit to render the action disabled. */
  onCreateChain?: () => void;
  /** Adopts the chain offered by another device. Omit to render the action disabled. */
  onJoinChain?: () => void;
  /** Shown with a copy button when it is a non-empty string. */
  inviteCode?: string | null;
}

const REVERT_MS = 2000;

const section: CSSProperties = {
  display: "flex", flexDirection: "column", gap: space.md,
  padding: space.xl, border: `1px solid ${cssVar("line")}`,
  borderRadius: radii.lg, background: cssVar("surface"),
  color: cssVar("fg"), fontFamily: fonts.sans,
};
const title: CSSProperties = { margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em" };
const lede: CSSProperties = {
  margin: 0, maxWidth: 560, fontSize: 14, lineHeight: 1.5, color: cssVar("muted"),
};
const row: CSSProperties = { display: "flex", flexWrap: "wrap", gap: space.sm, marginTop: space.xs };
const button: CSSProperties = {
  padding: `${space.sm}px ${space.md}px`, border: `1px solid ${cssVar("line")}`,
  borderRadius: radii.sm, background: cssVar("surface2"), color: cssVar("fg"),
  font: "inherit", fontSize: 13, cursor: "pointer",
};
const primary: CSSProperties = {
  ...button, borderColor: cssVar("accent"), background: cssVar("accent"),
  color: cssVar("accentInk"), fontWeight: 600,
};
const hint: CSSProperties = { margin: 0, fontSize: 12, color: cssVar("faint") };
const codeBox: CSSProperties = {
  display: "flex", alignItems: "center", flexWrap: "wrap", gap: space.sm, padding: space.sm,
  border: `1px solid ${cssVar("lineSoft")}`, borderRadius: radii.sm, background: cssVar("surface2"),
};
const codeStyle: CSSProperties = {
  fontFamily: fonts.mono, fontSize: 13, letterSpacing: "0.04em", color: colors.fg,
  padding: `${space.xs}px ${space.sm}px`, wordBreak: "break-all",
};

/**
 * What the transcript shows when a chain has no events yet: start one here, or
 * join one that already exists. Pure props — the shell owns the socket.
 */
export function EmptyState({
  onCreateChain,
  onJoinChain,
  inviteCode,
}: EmptyStateProps): ReactElement {
  const [copied, setCopied] = useState(false);
  const invite = typeof inviteCode === "string" && inviteCode.length > 0 ? inviteCode : null;

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), REVERT_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async (): Promise<void> => {
    if (invite === null) return;
    try {
      await navigator.clipboard.writeText(invite);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section style={section} aria-labelledby="empty-state-title">
      <h2 style={title} id="empty-state-title">No events yet</h2>
      <p style={lede}>
        A new chain starts here, on this device — and a device you join adopts that chain&apos;s
        sessions exactly as they already are.
      </p>

      <div style={row}>
        <button
          type="button"
          style={primary}
          disabled={onCreateChain === undefined}
          aria-describedby={onCreateChain === undefined ? "empty-state-create-hint" : undefined}
          onClick={onCreateChain}
        >
          Create a new chain
        </button>
        <button
          type="button"
          style={button}
          disabled={onJoinChain === undefined}
          aria-describedby={onJoinChain === undefined ? "empty-state-join-hint" : undefined}
          onClick={onJoinChain}
        >
          Join with an invite
        </button>
      </div>

      {onCreateChain === undefined ? (
        <p style={hint} id="empty-state-create-hint">Creating a chain is not available in this view.</p>
      ) : null}
      {onJoinChain === undefined ? (
        <p style={hint} id="empty-state-join-hint">Joining with an invite is not available in this view.</p>
      ) : null}

      {invite !== null ? (
        <div style={codeBox}>
          <code style={codeStyle}>{invite}</code>
          <button type="button" style={button} onClick={() => void copy()}>
            {copied ? "Copied" : "Copy code"}
          </button>
          <span style={hint} role="status" aria-live="polite">
            {copied ? "Invite code copied to the clipboard." : ""}
          </span>
        </div>
      ) : null}
    </section>
  );
}