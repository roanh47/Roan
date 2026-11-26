import type { ReactElement } from "react";
import type { ConnectionStatus } from "../chain.js";

/**
 * The one honest line that the daemon is not answering.
 *
 * It is chrome, not a chat message: a compact banner pinned to the top of the
 * window, above the conversation, with the reason and the one thing the user
 * can do about it. The transcript and the composer keep their normal shape
 * underneath, so nothing looks as if the conversation was replaced by a
 * connection screen. As soon as the socket opens the banner renders nothing
 * at all — it never lingers to announce the recovery.
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
    case "connecting":
      return "looking for the daemon on this device";
    case "reconnecting":
      return "reconnecting to the daemon";
    case "closed":
      return "the connection to the daemon closed";
    default:
      return "the daemon has not answered yet";
  }
}

export function ConnectionBanner({ status, reason, onRetry }: ConnectionBannerProps): ReactElement | null {
  // `idle` is the first paint, before the client has started connecting:
  // showing a warning there would flash on every launch.
  if (status === "open" || status === "idle") return null;

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
    </div>
  );
}
