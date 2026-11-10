import { useState } from "react";
import type { ReactElement } from "react";

interface ErrorBannerProps {
  /** Short, plain-English description of what went wrong. */
  message: string;
  /** Technical text, hidden until the reader asks for it. */
  detail?: string;
  onDismiss?: () => void;
  onRetry?: () => void;
}

export function ErrorBanner({
  message,
  detail,
  onDismiss,
  onRetry,
}: ErrorBannerProps): ReactElement {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="error-banner" role="alert">
      <div className="error-banner__body">
        <p className="error-banner__message">{message}</p>
        <p className="error-banner__hint">
          You can dismiss this and keep reading.
        </p>
      </div>

      <div className="error-banner__actions">
        {onRetry ? (
          <button type="button" className="error-banner__button" onClick={onRetry}>
            Try again
          </button>
        ) : null}
        {detail ? (
          <button
            type="button"
            className="error-banner__disclosure"
            aria-expanded={expanded}
            aria-controls="error-banner-detail"
            onClick={() => setExpanded((open) => !open)}
          >
            {expanded ? "Hide details" : "Show details"}
          </button>
        ) : null}
        {onDismiss ? (
          <button
            type="button"
            className="error-banner__dismiss"
            aria-label="Dismiss this error message"
            onClick={onDismiss}
          >
            <span aria-hidden="true">×</span>
          </button>
        ) : null}
      </div>

      {detail && expanded ? (
        <pre className="error-banner__detail" id="error-banner-detail">
          {detail}
        </pre>
      ) : null}
    </div>
  );
}
