import type { ReactElement } from "react";

import { cssVar, fonts, radii, space } from "../theme";

export interface ToolApprovalCardProps {
  /** Name of the tool that is asking for permission. */
  toolName: string;
  /** Files or directories the call would touch. Empty renders no list. */
  paths: readonly string[];
  /** One line explaining why the tool wants to run. */
  reason: string;
  /** A decision has been sent but not answered yet; every button is disabled. */
  pending?: boolean;
  onAllow: () => void;
  onAsk: () => void;
  onDeny: () => void;
}

const S = space;
const R = radii;

const styles = {
  card: {
    display: "flex",
    flexDirection: "column",
    gap: S.sm,
    padding: `${S.md}px ${S.lg}px`,
    border: `1px solid ${cssVar("line")}`,
    borderLeftWidth: 2,
    borderLeftStyle: "solid",
    borderLeftColor: cssVar("warn"),
    borderRadius: R.md,
    background: cssVar("surface"),
    color: cssVar("fg"),
    opacity: 1,
  },
  cardPending: {
    opacity: 0.7,
  },
  head: {
    display: "flex",
    alignItems: "baseline",
    gap: S.sm,
    minWidth: 0,
  },
  label: {
    color: cssVar("faint"),
    fontFamily: fonts.sans,
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    whiteSpace: "nowrap",
  },
  name: {
    color: cssVar("fg"),
    fontFamily: fonts.mono,
    fontSize: 13,
    fontWeight: 600,
    overflowWrap: "anywhere",
  },
  reason: {
    margin: 0,
    color: cssVar("muted"),
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 1.4,
    overflowWrap: "anywhere",
  },
  paths: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: S.xs,
  },
  path: {
    display: "block",
    padding: `${S.xs}px ${S.sm}px`,
    border: `1px solid ${cssVar("lineSoft")}`,
    borderRadius: R.sm,
    background: cssVar("surface2"),
    color: cssVar("muted"),
    fontFamily: fonts.mono,
    fontSize: 12,
    lineHeight: 1.4,
    overflowWrap: "anywhere",
  },
  actions: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: S.sm,
    marginTop: S.xs,
  },
  button: {
    font: "inherit",
    fontFamily: fonts.sans,
    fontSize: 12,
    fontWeight: 600,
    lineHeight: 1,
    padding: `${S.sm}px ${S.md}px`,
    borderRadius: R.pill,
    border: "1px solid transparent",
    background: "transparent",
    cursor: "pointer",
  },
  allow: {
    borderColor: cssVar("accent"),
    background: cssVar("accent"),
    color: cssVar("accentInk"),
  },
  ask: {
    borderColor: cssVar("line"),
    color: cssVar("warn"),
  },
  deny: {
    borderColor: cssVar("line"),
    color: cssVar("danger"),
  },
  disabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
  busy: {
    margin: 0,
    color: cssVar("faint"),
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 1.4,
  },
} as const;

/**
 * Permission prompt for a single tool call: what runs, why, and which paths it
 * touches. Presentational only — the caller owns the decision and its state.
 */
export function ToolApprovalCard({
  toolName,
  paths,
  reason,
  pending = false,
  onAllow,
  onAsk,
  onDeny,
}: ToolApprovalCardProps): ReactElement {
  const buttonStyle = {
    ...styles.button,
    ...(pending ? styles.disabled : null),
  };

  const actions = [
    { label: "Allow", style: styles.allow, onClick: onAllow },
    { label: "Ask first", style: styles.ask, onClick: onAsk },
    { label: "Deny", style: styles.deny, onClick: onDeny },
  ];

  return (
    <section
      className="tool-approval"
      aria-label={`Permission request for ${toolName}`}
      aria-busy={pending}
      style={{ ...styles.card, ...(pending ? styles.cardPending : null) }}
    >
      <div className="tool-approval__head" style={styles.head}>
        <span style={styles.label}>Tool</span>
        <span className="tool-approval__name" style={styles.name}>
          {toolName}
        </span>
      </div>

      <p className="tool-approval__reason" style={styles.reason}>
        {reason}
      </p>

      {paths.length > 0 ? (
        <ul className="tool-approval__paths" style={styles.paths}>
          {paths.map((path) => (
            <li key={path}>
              <code style={styles.path}>{path}</code>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="tool-approval__actions" style={styles.actions}>
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            className="tool-approval__button"
            style={{ ...buttonStyle, ...action.style }}
            disabled={pending}
            onClick={action.onClick}
          >
            {action.label}
          </button>
        ))}
        {pending ? (
          <p className="tool-approval__busy" style={styles.busy} role="status">
            Waiting for the decision…
          </p>
        ) : null}
      </div>
    </section>
  );
}

export default ToolApprovalCard;
