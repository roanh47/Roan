import { useEffect, useState, type ReactElement } from "react";
import type { ConnectionStatus } from "../chain.js";

/**
 * The one honest line that the daemon is not answering.
 *
 * It is chrome, not a chat message: a compact banner pinned to the top of the
 * window, above the conversation, with the reason and the one thing the user
 * can do about it. Two rules keep it from becoming noise:
 *
 * - It does not blink. A reconnect loop flips the status several times a second,
 *   so every "down" status says the same thing: the text only changes when the
 *   situation really changes (down → open, or a different reason).
 * - It can be dismissed. Someone who has read it may close it, and it stays
 *   closed until the connection has actually been open again — a fresh failure
 *   is news, the same failure is not.
 */
export interface ConnectionBannerProps {
  status: ConnectionStatus;
  /** Why the connection is down, when the client can say more than the status. */
  reason?: string | null;
  onRetry: () => void;
}

/** The status in the words a reader needs, never the internal name. */
export function connectionDetail(status: ConnectionStatus): string {
  switch (status) {
    case "closed":
      return "the daemon closed the connection";
    case "open":
    case "idle":
      return "the daemon has not answered yet";
    default:
      // connecting and reconnecting are the same situation seen twice a second.
      return "the daemon on this device is not answering";
  }
}

export function ConnectionBanner({ status, reason, onRetry }: ConnectionBannerProps): ReactElement | null {
  const [dismissed, setDismissed] = useState(false);

  // A real connection clears the dismissal: the next failure is new news.
  useEffect(() => {
    if (status === "open") setDismissed(false);
  }, [status]);

  // `idle` is the first paint; `open` means there is nothing to say.
  if (status === "open" || status === "idle") return null;
  if (dismissed) return null;

  const detail = connectionDetail(status);
  const why = typeof reason === "string" && reason.trim().length > 0 ? reason.trim() : null;

  return (
    <div className="connbanner" role="status" aria-live="polite">
      <span className="connbanner__dot" aria-hidden="true" />
      <span className="connbanner__text">
        <strong className="connbanner__headline">Daemon not connected</strong>
        <span className="connbanner__detail">{why === null ? detail : `${detail} · ${why}`}</span>
      </span>
      <button type="button" className="connbanner__retry" onClick={onRetry}>
        Retry
      </button>
      <button
        type="button"
        className="connbanner__close"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
      >
        ×
      </button>
    </div>
  );
}
