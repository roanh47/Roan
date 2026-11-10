import type { ReactElement } from "react";

import { cssVar, radii, space } from "../theme";
import type { ColorToken } from "../theme";

export type ToastTone = "info" | "warn" | "error";

export interface ToastItem {
  /** Stable identity for React keys and for `onDismiss`. */
  readonly id: string;
  readonly tone: ToastTone;
  /** One line the reader can act on. */
  readonly title: string;
  /** Optional second line; hidden when empty. */
  readonly body?: string;
}

export interface ToastProps {
  /**
   * Toasts to show, oldest first. The caller owns the list and its lifetime —
   * this component only renders it and asks for removal via `onDismiss`.
   */
  readonly items: readonly ToastItem[];
  /** Called with the id of the toast whose dismiss button was pressed. */
  readonly onDismiss: (id: string) => void;
}

const S = space;
const R = radii;

/** Tone -> border token. Info borrows the accent so it stays neutral-positive. */
const toneBorder: Readonly<Record<ToastTone, ColorToken>> = Object.freeze({
  info: "accent",
  warn: "warn",
  error: "danger",
});

const styles = {
  stack: {
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    gap: S.sm,
  },
  toast: {
    display: "flex",
    alignItems: "flex-start",
    gap: S.md,
    padding: `${S.sm}px ${S.sm}px ${S.sm}px ${S.md}px`,
    border: `1px solid ${cssVar("line")}`,
    borderLeftWidth: 2,
    borderLeftStyle: "solid",
    borderRadius: R.md,
    background: cssVar("surface2"),
    color: cssVar("fg"),
    fontFamily: "var(--font)",
    fontSize: 13,
  },
  body: {
    flex: "1 1 auto",
    minWidth: 0,
  },
  title: {
    margin: 0,
    fontWeight: 600,
    lineHeight: 1.35,
    overflowWrap: "anywhere",
  },
  detail: {
    margin: `${S.xs}px 0 0`,
    color: cssVar("muted"),
    fontSize: 12,
    lineHeight: 1.4,
    overflowWrap: "anywhere",
  },
  dismiss: {
    flex: "0 0 auto",
    font: "inherit",
    fontSize: 12,
    lineHeight: 1,
    padding: `${S.xs}px ${S.sm}px`,
    border: "none",
    borderRadius: R.pill,
    background: "transparent",
    color: cssVar("muted"),
    cursor: "pointer",
  },
} as const;

export function Toast({ items, onDismiss }: ToastProps): ReactElement | null {
  if (items.length === 0) return null;

  return (
    <div
      className="toast-stack"
      style={styles.stack}
      role="region"
      aria-label="Meldingen"
      aria-live="polite"
      aria-relevant="additions text"
      aria-atomic="false"
    >
      {items.map((item) => (
        <div
          key={item.id}
          className={`toast toast--${item.tone}`}
          style={{
            ...styles.toast,
            borderLeftColor: cssVar(toneBorder[item.tone]),
          }}
        >
          <div className="toast__body" style={styles.body}>
            <p className="toast__title" style={styles.title}>
              {item.title}
            </p>
            {item.body ? (
              <p className="toast__detail" style={styles.detail}>
                {item.body}
              </p>
            ) : null}
          </div>

          <button
            type="button"
            className="toast__dismiss"
            style={styles.dismiss}
            aria-label={`Sluiten: ${item.title}`}
            onClick={() => onDismiss(item.id)}
          >
            Sluiten
          </button>
        </div>
      ))}
    </div>
  );
}
