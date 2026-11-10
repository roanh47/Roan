import type { ReactElement } from "react";

import { cssVar, radii, space } from "../theme";

export interface UpdateBannerProps {
  /** Version string of the newer release, e.g. "0.4.2". Empty hides the banner. */
  version: string;
  /** Release notes page; the "What changed" link is rendered only when given. */
  notesHref?: string;
  /** Always called by the dismiss button — the banner has no internal state. */
  onDismiss: () => void;
  /** Starts the download; the "Download" button is rendered only when given. */
  onDownload?: () => void;
}

const S = space;
const R = radii;

const styles = {
  banner: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: S.md,
    padding: `${S.sm}px ${S.md}px`,
    border: `1px solid ${cssVar("line")}`,
    borderRadius: R.md,
    background: cssVar("surface2"),
    color: cssVar("fg"),
    fontFamily: "var(--font)",
    fontSize: 13,
  },
  message: {
    flex: "1 1 auto",
    margin: 0,
    minWidth: 0,
  },
  version: {
    color: cssVar("accent"),
    fontFamily: "var(--mono)",
  },
  actions: {
    display: "flex",
    alignItems: "center",
    gap: S.sm,
    flex: "0 0 auto",
  },
  link: {
    color: cssVar("accent"),
    fontSize: 12,
    textDecoration: "underline",
    textUnderlineOffset: 2,
  },
  download: {
    font: "inherit",
    fontSize: 12,
    fontWeight: 600,
    padding: `${S.xs}px ${S.md}px`,
    border: "none",
    borderRadius: R.pill,
    background: cssVar("accent"),
    color: cssVar("accentInk"),
    cursor: "pointer",
  },
  dismiss: {
    font: "inherit",
    fontSize: 15,
    lineHeight: 1,
    width: S.xl,
    height: S.xl,
    padding: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "none",
    borderRadius: R.pill,
    background: "transparent",
    color: cssVar("muted"),
    cursor: "pointer",
  },
} as const;

export function UpdateBanner({
  version,
  notesHref,
  onDismiss,
  onDownload,
}: UpdateBannerProps): ReactElement | null {
  const trimmed = version.trim();
  if (trimmed.length === 0) return null;

  return (
    <div className="update-banner" role="status" style={styles.banner}>
      <p className="update-banner__message" style={styles.message}>
        Version{" "}
        <span className="update-banner__version" style={styles.version}>
          {trimmed}
        </span>{" "}
        is available
      </p>

      <div className="update-banner__actions" style={styles.actions}>
        {notesHref ? (
          <a
            className="update-banner__notes"
            style={styles.link}
            href={notesHref}
            rel="noreferrer"
            target="_blank"
          >
            What changed
          </a>
        ) : null}

        {onDownload ? (
          <button
            type="button"
            className="update-banner__download"
            style={styles.download}
            aria-label={`Download version ${trimmed}`}
            onClick={onDownload}
          >
            Download
          </button>
        ) : null}

        <button
          type="button"
          className="update-banner__dismiss"
          style={styles.dismiss}
          aria-label="Dismiss update notice"
          onClick={onDismiss}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </div>
  );
}
