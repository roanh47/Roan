import { useEffect, useState } from "react";
import type { ReactElement } from "react";

export interface InviteCardProps {
  code: string;
  onCopy?: () => void;
  expiresAt?: string | null;
}

type CopyState = "idle" | "copied" | "failed";

const REVERT_MS = 2000;

function expiryLabel(expiresAt: string | null | undefined): string | null {
  if (!expiresAt) return null;
  const when = new Date(expiresAt);
  if (Number.isNaN(when.getTime())) return null;
  return when.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Shows a pairing code so another device can join the same chain.
 * The code is never logged; it only leaves this component through the
 * clipboard or through what the user reads on screen.
 */
export function InviteCard({
  code,
  onCopy,
  expiresAt,
}: InviteCardProps): ReactElement {
  const [copy, setCopy] = useState<CopyState>("idle");

  useEffect(() => {
    if (copy === "idle") return;
    const timer = setTimeout(() => setCopy("idle"), REVERT_MS);
    return () => clearTimeout(timer);
  }, [copy]);

  const handleCopy = async (): Promise<void> => {
    try {
      if (!navigator.clipboard?.writeText) {
        setCopy("failed");
        return;
      }
      await navigator.clipboard.writeText(code);
      setCopy("copied");
      onCopy?.();
    } catch {
      setCopy("failed");
    }
  };

  const expires = expiryLabel(expiresAt);

  return (
    <section className="invite" aria-labelledby="invite-title">
      <h2 className="invite__title" id="invite-title">
        Invite another device
      </h2>

      <p className="invite__code">
        <code>{code}</code>
      </p>

      <div className="invite__actions">
        <button
          type="button"
          className="invite__copy"
          onClick={() => void handleCopy()}
        >
          {copy === "copied" ? "Copied" : "Copy code"}
        </button>
        <span className="invite__state" role="status" aria-live="polite">
          {copy === "copied" ? "Copied to the clipboard." : ""}
        </span>
      </div>

      {copy === "failed" ? (
        <p className="invite__fallback" role="alert">
          This browser will not let the page copy for you. Select the code above
          and copy it by hand.
        </p>
      ) : null}

      <p className="invite__hint muted">
        Open Roan on the other device, choose Join, and type this code.
      </p>

      {expires ? (
        <p className="invite__expiry muted">This code stops working {expires}.</p>
      ) : null}
    </section>
  );
}
